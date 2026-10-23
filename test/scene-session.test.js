import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SceneSessions } from '../lib/scene-session.js'
import { internals } from '../index.js'

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-scene-unit-'))
  const exec = { agent: { session: { header: { id: 'owner', cwd: workspace } } }, callId: 'call', signal: new AbortController().signal }
  const config = { restrictToWorkspace: true, enablePython: true }
  const manager = new SceneSessions(config, { resolve: internals.resolveWorkspacePath, file: async () => {}, writable: async () => {} }, () => ({}))
  manager.sessions.set('owner', { id: 'scene', shared: true, working: join(workspace, 'working.blend'), directory: workspace, exited: false })
  return { workspace, exec, manager }
}

test('project tools load the edited source, retain provenance and respect workspace boundaries', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.workspace, 'tools'))
    const path = join(f.workspace, 'tools', 'sample.py'), calls = []
    f.manager.request = async args => { calls.push(args); return args }
    await writeFile(path, '"""First tool."""\ndef run(params): return 1\n')
    const first = await f.manager.execute({ tool_path: 'tools/sample.py', params: { a: 1 } }, f.exec)
    await writeFile(path, '"""Revised tool."""\ndef run(params): return 2\n')
    const second = await f.manager.execute({ tool_path: 'tools/sample.py' }, f.exec)
    assert.notEqual(first.tool_sha256, second.tool_sha256)
    assert.match(second.tool_source, /return 2/u)
    assert.equal((await f.manager.projectTools(f.exec))[0].description, 'Revised tool.')
    await assert.rejects(f.manager.execute({ tool_path: '../outside.py' }, f.exec), /must stay inside/u)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-scene-outside-'))
    await writeFile(join(outside, 'outside.py'), 'secret')
    await symlink(join(outside, 'outside.py'), join(f.workspace, 'tools', 'escape.py'))
    await assert.rejects(f.manager.execute({ tool_path: 'tools/escape.py' }, f.exec), /outside/u)
    await assert.rejects(f.manager.execute({ script: 'pass', tool_path: path }, f.exec), /either/u)
    assert.equal(calls.length, 2)
  } finally { await f.manager.dispose() }
})

test('a completed mutation survives attachment retry; ownership and failed requests preserve the scene', async () => {
  const f = await fixture()
  let sent = 0, attachments = 0
  try {
    f.manager.send = async () => { sent++; return { ok: true, value: { revision: 2, mode: 'OBJECT', view: { path: 'view.png' } } } }
    f.manager.attach = async value => { if (++attachments === 1) throw Error('attachment transport'); return value }
    const command = { action: 'python', script: 'pass' }
    await assert.rejects(f.manager.request(command, f.exec), /attachment transport/u)
    assert.equal((await f.manager.request(command, f.exec)).revision, 2)
    assert.equal(sent, 1)
    await assert.rejects(f.manager.request({ ...command, script: 'different' }, f.exec), /different arguments/u)
    await assert.rejects(f.manager.request({ ...command, scene_id: 'foreign' }, { ...f.exec, callId: 'other' }), /another scene/u)
    f.manager.send = async () => ({ ok: false, error: 'Python failed; scene restored' })
    await assert.rejects(f.manager.request(command, { ...f.exec, callId: 'failure' }), /scene restored/u)
    assert.equal(f.manager.sessions.get('owner').exited, false)
    await assert.rejects(f.manager.scene({ action: 'open', blend_path: '../escape.blend' }, f.exec), /must stay inside/u)
    assert.equal(f.manager.sessions.get('owner').id, 'scene')
  } finally { await f.manager.dispose() }
})
