import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { agentSettings, modelOptions, REVIEWER_PRESET, REVIEWER_AGENT } from './agent-config.js'
import { apply as applyRole } from './agent-role.js'
import { createInspectImageTool } from './inspect-image.js'

const MEDIA = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const SEVERITIES = new Set(['minor', 'major', 'critical'])
export const REVIEW_POLICY = 'dsh-3d-visual-review-v3'
export const REVIEW_SYSTEM = REVIEWER_AGENT.instructions
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const message = (text, content = []) => ({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }, ...content],
  source: { kind: 'dsh-3d-review', form: 'notice', summary: 'Independent reconstruction review' } })
const textOutput = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }

/** Required judgment fields are checked; optional confidence preserves useful feedback. */
export function parseReview(text) {
  const value = typeof text === 'string' ? JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')) : text
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Submit a review object.')
  if (!['match', 'different', 'uncertain'].includes(value.verdict)) throw new Error('verdict must be match, different or uncertain.')
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 6000) throw new Error('summary requires a concise, non-empty assessment.')
  if (!Array.isArray(value.differences) || value.differences.length > 40) throw new Error('differences requires an array of at most 40 observations.')
  const differences = value.differences.map(item => {
    if (!item || !SEVERITIES.has(item.severity)) throw new Error('Each difference needs minor, major or critical severity.')
    const result = { severity: item.severity }
    for (const key of ['part', 'reference_evidence', 'render_evidence', 'suggestion']) {
      if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 4000) throw new Error(`Each difference needs a non-empty ${key}. Correct the field and submit again.`)
      result[key] = item[key]
    }
    return result
  })
  const limitations = value.limitations ?? []
  if (!Array.isArray(limitations) || limitations.length > 20 || limitations.some(item => typeof item !== 'string' || item.length > 4000)) throw new Error('limitations must be a list of short observations.')
  for (const key of ['same', 'approved']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`${key} must be a boolean when supplied.`)
  }
  const same = value.verdict === 'match' && value.same !== false
  const approved = same && value.approved !== false && differences.every(item => item.severity === 'minor')
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : undefined
  return { verdict: value.verdict, same, approved, summary: value.summary, differences, limitations,
    ...(confidence === undefined ? {} : { confidence }),
    ...(same && !approved ? { approval_rejected: 'Approval requires a faithful match with only minor remaining differences.' } : {}) }
}

export function createSubmitReviewTool(accept) {
  return defineTool({ name: 'submit_review',
    description: 'Submit the independent visual assessment and finish this review. match authorizes completion for a faithful result with minor remaining differences. different requests improvements; uncertain records insufficient evidence. Correct validation feedback and submit again. Confidence is optional.',
    parameters: {
      verdict: { type: 'string', required: true, enum: ['match', 'different', 'uncertain'] },
      summary: { type: 'string', required: true, description: 'Overall assessment in Chinese.' },
      differences: { type: 'array', required: true, items: { type: 'object', additionalProperties: false,
        properties: {
          part: { type: 'string', required: true }, severity: { type: 'string', required: true, enum: ['minor', 'major', 'critical'] },
          reference_evidence: { type: 'string', required: true }, render_evidence: { type: 'string', required: true }, suggestion: { type: 'string', required: true },
        } } },
      limitations: { type: 'array', items: { type: 'string' }, description: 'Uncertainty and hidden geometry.' },
      confidence: { type: 'number', description: 'Optional self-reported confidence from 0 to 1.' },
    }, output: textOutput,
    async execute(args, exec) { const decision = parseReview(args); await accept(decision, exec); return { status: 'accepted', ...decision } },
  })
}

function attachmentValue(ref) {
  return { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes,
    width: ref.width, height: ref.height, ...(ref.name ? { name: ref.name } : {}) }
}
async function assertEvidenceCurrent(files, artifact, signal) {
  for (const file of [...files, artifact]) {
    if (digest(await readFile(file.path, { signal })) !== file.sha256) throw new Error('The submitted scene or images changed during review. Render and review the current artifacts.')
  }
}

/** Each round owns a fresh native agent, a closed evidence set and its teardown. */
export async function runReviewer(ctx, config, paths, round, exec, lifetime) {
  const settings = agentSettings(config, 'reviewer')
  const agents = ctx.get?.('agents') ?? ctx.agents
  if (!agents?.create) throw new Error('Independent review requires the dsh agent runtime.')
  const signal = AbortSignal.any([...(exec.signal ? [exec.signal] : []), ...(lifetime ? [lifetime] : []), AbortSignal.timeout(settings.timeoutMs)])
  const agentId = `review-${randomUUID()}`, started = Date.now(), observations = []
  let handle, decision, recoveries = 0, steps = 0, formatRepairs = 0, budgetReason, failure, events = []
  const setup = async (agentCtx, agent) => {
    const presets = agentCtx.get?.('agentPresets')
    if (presets) await presets.mount(agentCtx, REVIEWER_PRESET)
    else applyRole(agentCtx, { role: 'reviewer', ...settings })
    const inspect = createInspectImageTool(ctx, config, paths, { resolve: async id => {
      const file = round.files.find(file => file.image_id === id)
      if (!file) throw new Error(`Choose an admitted image_id: ${round.files.map(file => file.image_id).join(', ')}`)
      return { ...file, path: file.snapshot_path }
    }, outputDirectory: join(round.directory, 'observations') })
    agentCtx.tools.register({ ...inspect, async execute(args, toolExec) {
      const value = await inspect.execute(args, toolExec)
      observations.push({ image_id: value.image_id, region: value.region, zoom: value.zoom,
        source_sha256: value.source_sha256, source_dimensions: value.source_dimensions,
        pixel_region: value.pixel_region, dimensions: value.dimensions, attachment: value.attachment })
      return value
    } })
    agentCtx.tools.register(createSubmitReviewTool(async value => {
      if (decision) throw new Error('This review already has an accepted submission.')
      await assertEvidenceCurrent(round.files, round.artifact, signal)
      decision = value
    }))
    agentCtx.on('agent/pre-step', async (_event, next) => {
      if (decision) return { kind: 'reject' }
      if (steps >= settings.maxSteps || Date.now() - started >= settings.timeoutMs) {
        budgetReason = 'The review observation budget ended before a valid submission.'
        return { kind: 'reject' }
      }
      steps++
      return next()
    })
    agentCtx.on('agent/turn-stopping', ({ signal: turnSignal }) => {
      if (decision || signal.aborted || turnSignal.aborted || budgetReason) return
      formatRepairs++
      agent.steer(message('Finish this review by calling submit_review. Use the tool schema, retain your visible evidence, and correct validation feedback. Confidence is optional.'))
    })
    agentCtx.on('agent/request-error', async ({ failure: problem, signal: turnSignal }) => {
      if (signal.aborted || turnSignal.aborted || recoveries >= settings.maxRecoveries || !['TIMEOUT', 'TRANSPORT', 'RATE_LIMIT', 'SERVER_ERROR'].includes(problem.code)) return undefined
      recoveries++
      return { kind: 'retry' }
    })
  }
  const cancel = () => handle?.agent.cancel(exec.signal?.aborted ? { kind: 'parent' } : { kind: 'hook', reason: 'review deadline or plugin disposal' })
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const presets = ctx.get?.('agentPresets')
    handle = await agents.create({ sessionId: agentId, parentAgent: exec.agent, signal,
      agentOptions: modelOptions(settings), meta: { cwd: exec.agent.session.header.cwd,
        parentSession: exec.agent.session.header.id, origin: 'subagent', ...(presets ? { agentPreset: REVIEWER_PRESET } : {}) }, setup })
    if (signal.aborted) cancel()
    const evidence = round.files.flatMap(file => [
      { type: 'text', text: `${file.image_id}: ${file.role}${file.view ? `; view=${JSON.stringify(file.view)}` : ''}` },
      { type: 'image', attachment: file.attachment },
    ])
    handle.agent.followup(message(`Review the current reconstruction. Use image IDs for inspect_image. The reference is the visual target and render labels identify candidate views. Assess the whole result and regions needing closer observation, then call submit_review.\nReview ID: ${round.id}`, evidence))
    await handle.agent.whenIdle()
    signal.throwIfAborted()
    events = handle.agent.session.snapshotEvents()
    const end = events.filter(e => e.type === 'turn/end').at(-1)?.data.reason
    if (!decision) throw new Error(budgetReason ?? end?.error?.message ?? 'The reviewer ended before submitting an assessment.')
    await assertEvidenceCurrent(round.files, round.artifact, signal)
  } catch (error) {
    failure = signal.aborted ? (exec.signal?.aborted ? 'Review cancelled with its parent task.' : 'Review unavailable within its execution budget.') : String(error.message ?? error).slice(0, 2000)
    decision = undefined
  } finally {
    signal.removeEventListener('abort', cancel)
    if (handle) {
      events = handle.agent.session.snapshotEvents()
      try { await writeFile(join(round.directory, 'agent-session.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n', { mode: 0o600 }) }
      finally { await handle.dispose() }
    }
  }
  return { decision, failure, agent_session_id: agentId, agent_preset: REVIEWER_PRESET, route: modelOptions(settings),
    steps, recoveries, format_repairs: formatRepairs, observations,
    transcript_path: join(round.directory, 'agent-session.jsonl'),
    tool_calls: events.filter(e => e.type === 'tool/call').map(e => ({ seq: e.seq, name: e.data.name, arguments: e.data.arguments })), elapsed_ms: Date.now() - started }
}

export function createReviewTool(ctx, config, paths, reconstruction) {
  const lifetime = new AbortController()
  ctx.effect?.(() => () => lifetime.abort(new Error('Review plugin disposed.')))
  return defineTool({ name: 'review_reconstruction',
    description: 'Manage independent acceptance of an image reconstruction. begin registers its workspace reference; status returns the current checkpoint. review (default) creates a fresh review agent with frozen evidence, image inspection and structured submission tools. Returns approved, needs_changes or unavailable. Supply current blend_path and genuine comparable renders. Unavailable assessments retain a pending task and allow another review attempt.',
    parameters: {
      action: { type: 'string', enum: ['begin', 'status', 'review'] },
      reference_path: { type: 'string', description: 'begin/review: workspace reference PNG/JPEG/WebP.' },
      render_paths: { type: 'json', description: 'review: 1–6 render paths, closest reference view first.' },
      render_views: { type: 'json', description: 'Optional view labels, one per render.' },
      blend_path: { type: 'string', description: 'review: required current editable .blend; begin: optional scene to continue.' },
      report_path: { type: 'string', description: 'New JSON report path; defaults to a unique workspace review path.' },
    }, output: textOutput,
    async execute(args, exec) {
      const action = args.action ?? 'review'
      if (!['begin', 'status', 'review'].includes(action)) throw new Error('action must be begin, status or review.')
      if (action !== 'review') {
        if (!reconstruction) throw new Error('Reconstruction session service is unavailable.')
        return action === 'begin' ? reconstruction.begin(args, exec) : reconstruction.status(exec)
      }
      exec.signal?.throwIfAborted()
      await reconstruction?.prepareReview(args, exec)
      if (!Array.isArray(args.render_paths) || args.render_paths.length < 1 || args.render_paths.length > 6 || args.render_paths.some(path => typeof path !== 'string' || !path.trim())) throw new Error('render_paths requires 1–6 image paths.')
      const labels = args.render_views ?? args.render_paths.map((_p, i) => i ? `alternate-${i}` : 'reference-aligned')
      if (!Array.isArray(labels) || labels.length !== args.render_paths.length || labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100)) throw new Error('render_views requires one short label per render.')
      if (!args.blend_path) throw new Error('Review requires the current blend_path.')
      const attachments = ctx.get?.('attachments')
      if (!attachments?.saveImage) throw new Error('Independent review requires the attachments service.')
      const id = randomUUID()
      const reportPath = await paths.resolve(args.report_path ?? `.dsh-blender/reviews/${id}.json`, exec, config, { kind: 'report_path' })
      if (extname(reportPath).toLowerCase() !== '.json') throw new Error('report_path must end in .json.')
      await paths.writable(reportPath, false)
      const directory = join(dirname(reportPath), `reviewer-${id}`)
      await mkdir(join(directory, 'evidence'), { recursive: true, mode: 0o700 })
      const files = []
      let totalBytes = 0
      const inputs = [{ path: args.reference_path, role: 'reference', image_id: 'reference' },
        ...args.render_paths.map((path, i) => ({ path, role: 'render', image_id: `render_${i + 1}`, view: labels[i] }))]
      for (const input of inputs) {
        const path = await paths.resolve(input.path, exec, config, { mustExist: true, kind: input.role })
        const info = await stat(path), mediaType = MEDIA[extname(path).toLowerCase()]
        if (!info.isFile() || info.size > 20 * 1024 * 1024 || !mediaType) throw new Error('Review images must be regular PNG/JPEG/WebP files of at most 20 MiB.')
        const data = await readFile(path, { signal: exec.signal })
        totalBytes += data.length
        if (totalBytes > 40 * 1024 * 1024) throw new Error('Review inputs exceed 40 MiB.')
        const snapshot = join(directory, 'evidence', `${input.image_id}${extname(path).toLowerCase()}`)
        await writeFile(snapshot, data, { mode: 0o600 })
        files.push({ ...input, path, sha256: digest(data), bytes: data.length, snapshot_path: snapshot,
          attachment: attachmentValue(await attachments.saveImage({ data, mediaType, name: basename(path) })) })
      }
      if (files.some(file => file.role === 'render' && file.sha256 === files[0].sha256)) throw new Error('A render is identical to the reference. Submit actual model renders.')
      const blend = await paths.resolve(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
      const blendInfo = await stat(blend)
      if (!blendInfo.isFile() || extname(blend).toLowerCase() !== '.blend' || blendInfo.size > 512 * 1024 * 1024) throw new Error('blend_path must be a .blend file of at most 512 MiB.')
      const artifact = { path: blend, sha256: digest(await readFile(blend, { signal: exec.signal })), bytes: blendInfo.size }
      let result
      try { result = await runReviewer(ctx, config, paths, { id, directory, files, artifact }, exec, lifetime.signal) }
      catch (error) { result = { failure: String(error.message ?? error), elapsed_ms: 0 } }
      const { decision, failure, ...agent } = result
      const report = { review_id: id, policy: REVIEW_POLICY, created_at: new Date().toISOString(), session_id: exec.agent.session.header.id,
        status: failure ? 'unavailable' : 'reviewed', outcome: failure ? 'unavailable' : decision.approved ? 'approved' : 'needs_changes',
        same: decision?.same ?? false, approved: decision?.approved ?? false, ...(decision ?? {}), ...(failure ? { error: failure } : {}),
        ...agent, files, artifact, report_path: reportPath }
      const temp = `${reportPath}.${id}.tmp`
      await writeFile(temp, JSON.stringify({ ...report, reviewer_system: agentSettings(config, 'reviewer').instructions }, null, 2) + '\n', { mode: 0o600 })
      await rename(temp, reportPath)
      exec.signal?.throwIfAborted()
      reconstruction?.reviewed(report, exec)
      return report
    },
  })
}
