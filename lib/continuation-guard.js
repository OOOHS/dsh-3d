import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

const digest = value => createHash('sha256').update(value).digest('hex')
const stable = value => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !['request_id', 'edit_id', 'view_id'].includes(key)).map(key => [key, stable(value[key])]))
  return value
}
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return undefined } }
const textOf = message => message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''

/** Observe public tool events and saved bytes; prose alone leaves the work unchanged. */
export class ContinuationGuard {
  constructor() { this.records = new Map() }
  reset(agent) {
    this.records.set(agent.session.header.id, { cursor: agent.session.snapshotEvents?.().length ?? 0,
      pending: new Map(), seen: new Set(), idleStops: 0, checkpoint: null })
  }
  delete(id) { this.records.delete(id) }
  clear() { this.records.clear() }
  async observe(agent, checkpoint, signal) {
    const id = agent.session.header.id
    if (!this.records.has(id)) this.reset(agent)
    const record = this.records.get(id), events = agent.session.snapshotEvents?.() ?? []
    let progress = false
    const remember = key => {
      if (record.seen.has(key)) return
      record.seen.add(key)
      if (record.seen.size > 512) record.seen.delete(record.seen.values().next().value)
      progress = true
    }
    for (const event of events.slice(record.cursor)) {
      if (event.type === 'tool/call') record.pending.set(event.data.callId, event.data)
      if (event.type !== 'tool/result') continue
      const message = event.data.message, call = record.pending.get(message.toolCallId)
      record.pending.delete(message.toolCallId)
      if (!call || message.isError) continue
      const args = parse(call.arguments) ?? {}, value = parse(textOf(message))
      if (['blender_status', 'blender_helper_catalog'].includes(call.name)) continue
      if (call.name === 'review_reconstruction') {
        if (value?.status === 'reviewed' && value.artifact) remember(digest(JSON.stringify([
          'review', value.artifact.sha256, value.files?.map(file => file.sha256),
        ])))
        continue
      }
      if (call.name === 'blender_sculpt' && args.action === 'status') continue
      // Geometry and image identities let repeated strokes or observations count when their evidence changes.
      const evidence = JSON.stringify(value ?? message.content).match(/(?:sha256:)?[a-f0-9]{64}/gu) ?? []
      remember(digest(JSON.stringify([call.name, stable(args), evidence])))
    }
    record.cursor = events.length
    if (checkpoint) {
      try {
        signal?.throwIfAborted()
        const info = await stat(checkpoint), stamp = `${checkpoint}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
        if (stamp !== record.checkpoint?.stamp) {
          const sha256 = digest(await readFile(checkpoint, { signal }))
          record.checkpoint = { stamp, sha256 }
          remember(`scene:${sha256}`)
        }
      } catch (error) { if (signal?.aborted) throw error }
    }
    record.idleStops = progress ? 0 : record.idleStops + 1
    return { progress, idleStops: record.idleStops }
  }
}
