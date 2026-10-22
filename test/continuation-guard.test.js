import assert from 'node:assert/strict'
import test from 'node:test'
import { ContinuationGuard } from '../lib/continuation-guard.js'

function fixture() {
  const events = [], guard = new ContinuationGuard()
  const agent = { session: { header: { id: 'one' }, snapshotEvents: () => events } }
  guard.reset(agent)
  let id = 0
  function complete(name, args, value = {}, isError = false) {
    const callId = `c-${id++}`
    events.push({ type: 'tool/call', data: { name, callId, arguments: JSON.stringify(args) } })
    const result = { type: 'tool/result', data: { message: { toolCallId: callId, isError,
      content: [{ type: 'text', text: JSON.stringify(value) }] } } }
    events.push(result)
    return result
  }
  return { events, guard, agent, complete, observe: () => guard.observe(agent) }
}

test('actual stroke geometry advances even when coordinates repeat; stale views and replayed results stay idle', async () => {
  const f = fixture(), args = { action: 'stroke', brush: 'grab', points: [[0.5, 0.5], [0.6, 0.5]], view_id: 'v1' }
  const result = f.complete('blender_sculpt', args, { geometry_hash: 'a'.repeat(64) })
  assert.equal((await f.observe()).progress, true)
  f.events.push(result)
  assert.equal((await f.observe()).idleStops, 1)
  f.complete('blender_sculpt', { ...args, view_id: 'v2', request_id: 'another' }, { geometry_hash: 'a'.repeat(64) })
  assert.equal((await f.observe()).idleStops, 2)
  f.complete('blender_sculpt', args, { geometry_hash: 'b'.repeat(64) })
  assert.equal((await f.observe()).idleStops, 0)
})

test('new observations count; repeated failures and unchanged review evidence stay idle', async () => {
  const f = fixture()
  f.complete('inspect_image', { image: 'ref.png', region: [0, 0, 0.5, 0.5] })
  assert.equal((await f.observe()).progress, true)
  f.complete('inspect_image', { image: 'ref.png', region: [0.5, 0.5, 1, 1] })
  assert.equal((await f.observe()).progress, true)
  f.complete('blender_python', { script: 'invalid' }, {}, true)
  assert.equal((await f.observe()).idleStops, 1)
  const value = { status: 'reviewed', artifact: { sha256: 'scene' }, files: [{ sha256: 'render' }] }
  f.complete('review_reconstruction', {}, value)
  assert.equal((await f.observe()).progress, true)
  f.complete('review_reconstruction', { report_path: 'new.json' }, { ...value, review_id: 'new' })
  assert.equal((await f.observe()).idleStops, 1)
})
