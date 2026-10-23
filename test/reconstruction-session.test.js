import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ReconstructionSessions } from '../lib/reconstruction-session.js'
import { internals } from '../index.js'

async function fixture(config = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-reconstruction-'))
  for (const file of ['reference.png', 'front.png', 'scene.blend', 'sculpt.blend']) await writeFile(join(workspace, file), file)
  const events = [{ type: 'user/message', data: { source: { kind: 'user' } } }]
  const listeners = new Map(), cleanup = [], steered = []
  const ctx = { on(name, callback) { listeners.set(name, callback) }, effect(callback) { cleanup.push(callback()) } }
  const agent = { session: { header: { id: 'session', cwd: workspace }, snapshotEvents() { return events } },
    inbox: { nextTurn: [] }, steer(message) { steered.push(message); events.push({ type: 'user/message', data: message }) } }
  const exec = { agent, signal: new AbortController().signal, deferContext(message) { events.push({ type: 'user/message', data: message }) } }
  const sculpt = { sessions: new Map() }
  const manager = new ReconstructionSessions(ctx, { restrictToWorkspace: true, ...config }, { resolve: internals.resolveWorkspacePath }, sculpt)
  const begin = () => manager.begin({ reference_path: 'reference.png', blend_path: 'scene.blend' }, exec)
  const fingerprint = async (file) => { const bytes = await readFile(join(workspace, file)); return { path: join(workspace, file), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }
  const review = async (approved = true, status = 'reviewed') => ({ review_id: 'review', report_path: 'review.json', status, approved,
    summary: approved ? 'Accepted' : 'Shape needs refinement', files: [await fingerprint('reference.png'), await fingerprint('front.png')], artifact: await fingerprint('scene.blend') })
  const stop = (signal = exec.signal) => listeners.get('agent/turn-stopping')({ agent, turn: 1, signal })
  return { manager, agent, events, steered, exec, workspace, sculpt, listeners, cleanup, begin, review, stop }
}

test('registered tasks continue through missing/rejected reviews and finish only with unchanged approved evidence', async () => {
  const f = await fixture()
  await f.stop(); assert.equal(f.steered.length, 0)
  await f.begin()
  await f.stop(); assert.equal(f.steered.length, 1)
  f.manager.reviewed(await f.review(false), f.exec)
  for (let i = 0; i < 12; i++) {
    await writeFile(join(f.workspace, 'scene.blend'), `productive revision ${i}`)
    await f.stop()
  }
  assert.equal(f.steered.length, 13)
  assert.equal(f.steered[0].source.kind, 'dsh-3d-reconstruction')
  assert.equal(f.steered[0].source.state.continuations, 1)
  f.manager.reviewed(await f.review(), f.exec)
  await f.stop(); assert.equal(f.steered.length, 13)
  await writeFile(join(f.workspace, 'scene.blend'), 'altered scene')
  await f.stop(); assert.equal(f.steered.length, 14)
  assert.equal((await f.manager.status(f.exec)).status, 'active')
})

test('missing review evidence and live brush edits each keep acceptance pending', async () => {
  const f = await fixture(); await f.begin()
  f.manager.reviewed(await f.review(), f.exec)
  await writeFile(join(f.workspace, 'front.png'), 'changed render')
  await f.stop(); assert.equal(f.steered.length, 1)
  f.manager.reviewed(await f.review(), f.exec)
  f.sculpt.sessions.set('session', { id: 'edit' })
  await f.stop(); assert.equal(f.steered.length, 2)
  await assert.rejects(f.manager.prepareReview({ reference_path: 'reference.png', blend_path: 'scene.blend' }, f.exec), /Commit or discard/u)
})

test('cancellation, queued human input and disposal yield control without restarting work', async () => {
  const f = await fixture(); await f.begin()
  const abort = new AbortController(); abort.abort()
  await f.stop(abort.signal); assert.equal(f.steered.length, 0)
  f.listeners.get('session/event')(f.agent.session, { type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  await f.stop(); assert.equal(f.steered.length, 0)
  await f.begin()
  f.agent.inbox.nextTurn.push({ source: { kind: 'user' } })
  await f.stop(); assert.equal(f.steered.length, 0)
  assert.equal((await f.manager.status(f.exec)).status, 'paused')
  f.agent.inbox.nextTurn.length = 0
  await f.begin(); for (const dispose of f.cleanup) dispose()
  await f.stop(); assert.equal(f.steered.length, 0)
})

test('explicit time budgets require human continuation; review outages allow another assessment', async () => {
  const f = await fixture({ reviewContinuationBudgetMs: 1 }); await f.begin()
  f.manager.state(f.agent).started_at = 0
  await f.stop(); assert.equal(f.steered.length, 1)
  assert.equal((await f.manager.status(f.exec)).status, 'paused')
  await assert.rejects(f.begin(), /direct user continuation/u)
  f.events.push({ type: 'user/message', data: { source: { kind: 'user' } } })
  await f.begin()
  f.manager.reviewed(await f.review(false, 'error'), f.exec)
  await f.stop(); assert.equal(f.steered.length, 1)
  assert.equal((await f.manager.status(f.exec)).status, 'awaiting-review')
  await f.manager.prepareReview({ reference_path: 'reference.png', blend_path: 'scene.blend' }, f.exec)
  assert.equal((await f.manager.status(f.exec)).status, 'active')
})

test('restored sessions preserve checkpoints and resume only after fresh human input', async () => {
  const f = await fixture(); await f.begin()
  f.manager.changed('blender_sculpt', { action: 'commit' }, { saved_path: join(f.workspace, 'sculpt.blend') }, f.exec)
  const restored = new ReconstructionSessions({}, { restrictToWorkspace: true }, { resolve: internals.resolveWorkspacePath })
  const state = await restored.status(f.exec)
  assert.equal(state.status, 'paused'); assert.equal(state.reconstruction.checkpoint, join(f.workspace, 'sculpt.blend'))
  await assert.rejects(restored.begin({ reference_path: 'reference.png' }, f.exec), /direct user continuation/u)
  f.events.push({ type: 'user/message', data: { source: { kind: 'user' } } })
  await restored.begin({ reference_path: 'reference.png' }, f.exec)
  assert.equal((await restored.status(f.exec)).status, 'active')
  const other = { ...f.agent, session: { ...f.agent.session, header: { ...f.agent.session.header, id: 'other' } } }
  assert.equal((await restored.status({ ...f.exec, agent: other })).status, 'inactive')
})

test('brush candidates can be revisited and selected for review without locking exploration to the latest edit', async () => {
  const f = await fixture(); await f.begin()
  f.manager.changed('blender_sculpt', { action: 'commit' }, { saved_path: join(f.workspace, 'sculpt.blend') }, f.exec)
  await f.manager.prepareReview({ reference_path: 'reference.png', blend_path: 'scene.blend' }, f.exec)
  assert.equal(f.manager.state(f.agent).checkpoint, join(f.workspace, 'scene.blend'))
  await f.manager.begin({ reference_path: 'reference.png', blend_path: 'sculpt.blend' }, f.exec)
  f.manager.changed('blender_checkpoint', { action: 'restore' }, { blendPath: join(f.workspace, 'scene.blend') }, f.exec)
  assert.equal(f.manager.state(f.agent).checkpoint, join(f.workspace, 'scene.blend'))
  assert.equal(f.manager.state(f.agent).sculpted, false)
})

test('reference identity and current scene are bound before an independent review', async () => {
  const f = await fixture(); await f.begin()
  await assert.rejects(f.manager.prepareReview({ reference_path: 'reference.png' }, f.exec), /requires blend_path/u)
  await writeFile(join(f.workspace, 'reference.png'), 'different reference')
  await assert.rejects(f.manager.prepareReview({ reference_path: 'reference.png', blend_path: 'scene.blend' }, f.exec), /registered reference changed/u)
  await assert.rejects(f.begin(), /direct user reference change/u)
})

test('approval of an older candidate cannot finish a different current checkpoint', async () => {
  const f = await fixture(); await f.begin()
  const report = await f.review()
  f.manager.changed('blender_python', {}, { blendPath: join(f.workspace, 'sculpt.blend') }, f.exec)
  f.manager.reviewed(report, f.exec)
  await f.stop()
  assert.equal(f.steered.length, 1)
  assert.equal((await f.manager.status(f.exec)).reconstruction.reason, 'current-scene-needs-review')
})

test('unchanged endings recover once then pause, with a durable checkpoint and a human resume fence', async () => {
  const f = await fixture(); let recoveries = 0
  f.agent.ctx = { get: () => ({ async compactIfNeeded(_agent, trigger) { assert.equal(trigger, 'pressure'); recoveries++; return { summarySeq: 10 } } }) }
  await f.begin()
  for (let i = 0; i < 10; i++) {
    f.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '会话预算耗尽。' }] } } })
    await f.stop()
  }
  const state = (await f.manager.status(f.exec)).reconstruction
  assert.equal(state.phase, 'paused'); assert.equal(state.reason, 'stalled')
  assert.equal(state.checkpoint, join(f.workspace, 'scene.blend'))
  assert.equal(recoveries, 1); assert.equal(f.steered.length, 4)
  assert.ok(f.steered.some(message => message.source.state.continuation_health?.recovery?.status === 'compacted'))
  await assert.rejects(f.begin(), /direct user continuation/u)
  f.events.push({ type: 'user/message', data: { source: { kind: 'user' } } })
  await f.begin(); assert.equal((await f.manager.status(f.exec)).status, 'active')
})

test('status/begin calls and identical repeated operations preserve the stall counter', async () => {
  const f = await fixture(); await f.begin()
  let id = 0
  const completed = (name, args, value) => {
    const callId = `call-${id++}`
    f.events.push({ type: 'tool/call', data: { callId, name, arguments: JSON.stringify(args) } },
      { type: 'tool/result', data: { message: { toolCallId: callId, isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] } } })
  }
  for (let i = 0; i < 12; i++) {
    await f.begin()
    completed('review_reconstruction', { action: 'status' }, { status: 'active' })
    completed('blender_status', {}, { available: true })
    completed('read_image', { file_path: 'front.png' }, { attachmentId: 'same-image' })
    await f.stop()
    if ((await f.manager.status(f.exec)).status === 'paused') break
  }
  assert.equal((await f.manager.status(f.exec)).reconstruction.reason, 'stalled')
})

test('failed or unavailable context recovery stays bounded and retains incomplete acceptance', async () => {
  for (const service of [undefined, { async compactIfNeeded() { throw Error('Summary service unavailable') } }]) {
    const f = await fixture(); f.agent.ctx = { get: () => service }; await f.begin()
    for (let i = 0; i < 8; i++) await f.stop()
    assert.equal((await f.manager.status(f.exec)).reconstruction.reason, 'stalled')
    assert.equal(f.steered.length, 4)
  }
})

test('cancellation and queued user work during context recovery receive control immediately', async () => {
  for (const kind of ['cancel', 'human', 'dispose']) {
    const f = await fixture(), abort = new AbortController(); await f.begin()
    f.agent.ctx = { get: () => ({ async compactIfNeeded() {
      if (kind === 'cancel') abort.abort(new Error('Stopped'))
      if (kind === 'human') f.agent.inbox.nextTurn.push({ source: { kind: 'user' } })
      if (kind === 'dispose') for (const dispose of f.cleanup) dispose()
      return null
    } }) }
    await f.stop(abort.signal); await f.stop(abort.signal)
    const before = f.steered.length
    await f.stop(abort.signal)
    assert.equal(f.steered.length, before)
  }
})
