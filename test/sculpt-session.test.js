import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { SculptSessions, validateCommand, createSculptTools } from '../lib/sculpt-session.js'
import { internals } from '../index.js'

const config = { restrictToWorkspace: true, timeoutMs: 500 }
const exec = (cwd, id = 'owner') => ({ agent: { session: { header: { cwd, id } } }, signal: new AbortController().signal, callId: 'call' })
const paths = { resolve: internals.resolveWorkspacePath, writable: async () => {}, file: async () => {} }
function fixture(t) {
  const manager = new SculptSessions(config, paths, () => undefined)
  t.after(() => manager.dispose())
  return manager
}

test('brush coordinates and view parameters reject malformed or unbounded input', () => {
  const stroke = { action: 'stroke', brush: 'draw', view_id: 'view', points: [[0.5, 0.5], [0.6, 0.5, 1]] }
  assert.doesNotThrow(() => validateCommand(stroke))
  for (const patch of [{ points: [[1.2, 0], [0, 0]] }, { radius: Infinity }, { brush: 'execute' }, { view_id: '' }, { symmetry: 'yx' }]) {
    assert.throws(() => validateCommand({ ...stroke, ...patch }))
  }
  assert.throws(() => validateCommand({ action: 'view', rotation: [0, 0, 0, 0] }))
  assert.throws(() => validateCommand({ action: 'view', zoom: 0 }))
})

test('ownership, file locks and source-preserving commit retain the live session on validation errors', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-sculpt-owner-'))
  await writeFile(join(workspace, 'input.blend'), 'fixture')
  const manager = fixture(t)
  const session = { id: 'edit', owner: 'owner', source: await realpath(join(workspace, 'input.blend')) }
  manager.sessions.set('owner', session)
  await assert.rejects(manager.run({ action: 'status', edit_id: 'edit' }, exec(workspace, 'other')), /belongs/u)
  await assert.rejects(manager.guard('blender_scene_info', { blend_path: 'input.blend' }, exec(workspace)), /active/u)
  await assert.rejects(manager.guard('blender_python', { save_path: 'input.blend' }, exec(workspace, 'other')), /locked/u)
  await manager.guard('blender_status', {}, exec(workspace))
  await assert.rejects(manager.run({ action: 'commit', edit_id: 'edit', save_path: 'input.blend' }, exec(workspace)), /new .blend/u)
  await assert.rejects(manager.run({ action: 'commit', edit_id: 'edit', save_path: '../escape.blend' }, exec(workspace)), /inside/u)
  assert.equal(manager.sessions.get('owner'), session)
})

test('serialized mutations, idempotent retries and worker rejections preserve state', async (t) => {
  const manager = fixture(t)
  manager.sessions.set('owner', { id: 'edit', owner: 'owner' })
  let count = 0, running = 0, maxRunning = 0
  manager.send = async (_session, command) => {
    running++; maxRunning = Math.max(maxRunning, running)
    await delay(10)
    running--
    if (command.action === 'undo') return { ok: false, error: 'No undo step available' }
    return { ok: true, value: { revision: ++count } }
  }
  const command = { action: 'status', edit_id: 'edit', request_id: 'retry' }
  const [first, second] = await Promise.all([manager.run(command, exec('/tmp')), manager.run(command, exec('/tmp'))])
  assert.deepEqual(first, second)
  assert.equal(count, 1)
  await assert.rejects(manager.run({ ...command, action: 'undo' }, exec('/tmp')), /different arguments/u)
  await assert.rejects(manager.run({ action: 'undo', edit_id: 'edit' }, exec('/tmp')), /No undo/u)
  assert.equal(manager.sessions.size, 1)
  assert.equal(maxRunning, 1)
})

test('image attachments render as native image blocks and image delivery retries preserve a completed call', async (t) => {
  const manager = fixture(t)
  manager.sessions.set('owner', { id: 'edit', owner: 'owner' })
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sculpt-image-'))
  const path = join(directory, 'view.png')
  await writeFile(path, 'pixels')
  let calls = 0, uploads = 0
  manager.send = async () => ({ ok: true, value: { revision: ++calls, view: { path, rotation: [-0, 1, 0, 0] } } })
  manager.attachments = () => ({ async saveImage() {
    if (++uploads === 1) throw new Error('temporary upload failure')
    return { attachmentId: 'attachment', mediaType: 'image/png', width: 2, height: 2, bytes: 6 }
  } })
  const command = { action: 'status', edit_id: 'edit', request_id: 'same' }
  await assert.rejects(manager.run(command, exec(directory)), /upload/u)
  const value = await manager.run(command, exec(directory))
  assert.equal(Object.is(value.view.rotation[0], -0), false)
  assert.equal(calls, 1)
  const rendered = createSculptTools(manager)[0].output.render({}, value)
  assert.equal(rendered[1].type, 'image')
  assert.equal(rendered[1].attachment.attachmentId, 'attachment')
  assert.equal(manager.sessions.size, 1)
})

test('cancellation settles worker ownership and keeps recovery files', async (t) => {
  const manager = fixture(t)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sculpt-abort-'))
  const session = { id: 'edit', owner: 'owner', directory }
  await mkdir(join(directory, 'requests'))
  await writeFile(join(directory, 'recovery.blend'), 'recovery')
  manager.sessions.set('owner', session)
  let stopped = false
  manager.stop = async (s) => { assert.equal(s, session); stopped = true }
  const controller = new AbortController()
  const promise = manager.run({ action: 'status', edit_id: 'edit' }, { ...exec(directory), signal: controller.signal })
  setTimeout(() => controller.abort(), 30)
  await assert.rejects(promise, /cancelled/u)
  assert.equal(stopped, true)
  assert.equal(manager.sessions.size, 0)
  assert.equal(await readFile(join(directory, 'recovery.blend'), 'utf8'), 'recovery')
})
