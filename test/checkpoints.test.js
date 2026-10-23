import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCheckpointTool } from '../lib/checkpoints.js'
import { internals } from '../index.js'

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-'))
  await writeFile(join(workspace, 'scene.blend'), 'first scene')
  await writeFile(join(workspace, 'front.png'), 'first render')
  const exec = { agent: { session: { header: { id: 'test', cwd: workspace } } }, signal: new AbortController().signal }
  const paths = { resolve: internals.resolveWorkspacePath, file: async () => {},
    writable: async (target, overwrite) => {
      if (!overwrite && await readFile(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) throw new Error('output exists')
    }, snapshot: (source, target) => copyFile(source, target) }
  const tool = createCheckpointTool({ restrictToWorkspace: true }, paths)
  return { workspace, exec, paths, tool, run: args => tool.execute(args, exec) }
}

test('candidates survive source changes, preserve evidence and restore an earlier branch across tool instances', async () => {
  const f = await fixture()
  assert.deepEqual(await f.run({ action: 'list' }), { checkpoints: [], total: 0 })
  const a = (await f.run({ action: 'save', blend_path: 'scene.blend', label: 'curves', method: 'curves first', evidence_paths: ['front.png'] })).checkpoint
  await writeFile(join(f.workspace, 'scene.blend'), 'second scene')
  await writeFile(join(f.workspace, 'front.png'), 'second render')
  const b = (await f.run({ action: 'save', blend_path: 'scene.blend', parent_id: a.checkpoint_id, note: 'try brushes before assembly' })).checkpoint
  assert.equal(b.parent_id, a.checkpoint_id)
  assert.equal(await readFile(a.scene.path, 'utf8'), 'first scene')
  assert.equal(await readFile(a.evidence[0].path, 'utf8'), 'first render')
  const secondTool = createCheckpointTool({ restrictToWorkspace: true }, f.paths)
  assert.equal((await secondTool.execute({ action: 'list' }, f.exec)).total, 2)
  const restored = await f.run({ action: 'restore', checkpoint_id: a.checkpoint_id, save_path: 'branch.blend' })
  assert.equal(restored.blendPath, join(f.workspace, 'branch.blend'))
  assert.equal(await readFile(restored.blendPath, 'utf8'), 'first scene')
  assert.equal(await readFile(join(f.workspace, 'scene.blend'), 'utf8'), 'second scene')
  await assert.rejects(f.run({ action: 'restore', checkpoint_id: b.checkpoint_id, save_path: 'branch.blend' }), /exists/u)
  assert.equal((await f.run({ action: 'get', checkpoint_id: a.checkpoint_id })).checkpoint.scene.sha256, a.scene.sha256)
})

test('tampered archives, traversal, symlink overwrites and invalid evidence are rejected', async () => {
  const f = await fixture()
  const a = (await f.run({ action: 'save', blend_path: 'scene.blend' })).checkpoint
  await assert.rejects(f.run({ action: 'get', checkpoint_id: '../scene' }), /checkpoint_id/u)
  await assert.rejects(f.run({ action: 'save', blend_path: '../scene.blend' }), /workspace/u)
  await symlink(a.scene.path, join(f.workspace, 'alias.blend'))
  await assert.rejects(f.run({ action: 'restore', checkpoint_id: a.checkpoint_id, save_path: 'alias.blend', allow_overwrite: true }), /outside the checkpoint archive/u)
  await writeFile(a.scene.path, 'changed')
  await assert.rejects(f.run({ action: 'restore', checkpoint_id: a.checkpoint_id, save_path: 'branch.blend' }), /bytes changed/u)
  await assert.rejects(f.run({ action: 'save', blend_path: 'scene.blend', evidence_paths: ['scene.blend'] }), /evidence/u)
  assert.equal((await f.run({ action: 'list' })).total, 1)
})

test('failed snapshots clean unpublished artifacts and cancellation keeps earlier candidates', async () => {
  const f = await fixture()
  const a = (await f.run({ action: 'save', blend_path: 'scene.blend' })).checkpoint
  const bad = createCheckpointTool({ restrictToWorkspace: true }, { ...f.paths, async snapshot(_source, target) { await writeFile(target, 'partial'); throw new Error('Blender failed') } })
  await assert.rejects(bad.execute({ action: 'save', blend_path: 'scene.blend' }, f.exec), /Blender failed/u)
  const dirs = await readdir(join(f.workspace, '.dsh-blender/checkpoints'))
  assert.deepEqual(dirs, [a.checkpoint_id])
  const abort = new AbortController(); abort.abort()
  await assert.rejects(f.tool.execute({ action: 'restore', checkpoint_id: a.checkpoint_id, save_path: 'branch.blend' }, { ...f.exec, signal: abort.signal }))
  assert.equal(await readFile(a.scene.path, 'utf8'), 'first scene')
})
