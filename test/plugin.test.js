import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, internals } from '../index.js'

const config = {
  blenderExecutable: 'blender',
  analysisPythonExecutable: '',
  timeoutMs: 180000,
  helperTimeoutMs: 120000,
  maxOutputChars: 20000,
  restrictToWorkspace: true,
  enablePython: true,
  enableHelpers: true,
  enableMaintenanceHelpers: false,
  registerSkill: true,
  registerModuleSkills: false,
}

test('registers one default skill and shared-workspace and asset tools', () => {
  const tools = []
  const skills = []
  apply({
    tools: { register(tool) { tools.push(tool) } },
    skills: { register(skill) { skills.push(skill) } },
  }, config)

  assert.deepEqual(tools.map((tool) => tool.name), [
    'blender_status',
    'blender_import',
    'blender_preview',
    'blender_render_frames',
    'blender_export',
    'blender_validate_scene',
    'blender_validate_export',
    'blender_helper_catalog',
    'blender_helper_run',
    'blender_scene',
    'blender_execute',
    'blender_edit',
    'blender_checkpoint',
    'blender_sculpt',
    'blender_view',
    'review_reconstruction',
    'inspect_image',
    'modeling_notes_read',
    'modeling_notes_write',
  ])
  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'create-3d-model')
  assert.equal(skills[0].provider, 'dsh-3d')
  assert.match(skills[0].content, /blender_scene/u)
  assert.equal(skills[0].resourceBase.kind, 'directory')
  assert.deepEqual(skills.map((skill) => skill.name), ['create-3d-model'])
})

test('legacy module registration remains an explicit opt-in', () => {
  const skills = []
  apply({ tools: { register() {} }, skills: { register(skill) { skills.push(skill) } } }, { ...config, registerModuleSkills: true })
  assert.equal(skills.length, 30)
  assert.ok(skills.some((skill) => skill.name === 'blender-modeling'))
})

test('can disable the arbitrary Blender Python tool and bundled skill', () => {
  const tools = []
  const skills = []
  apply({
    tools: { register(tool) { tools.push(tool) } },
    skills: { register(skill) { skills.push(skill) } },
  }, { ...config, enablePython: false, registerSkill: false })

  assert.equal(tools.some((tool) => tool.name === 'blender_execute'), false)
  assert.equal(skills.length, 0)
})

test('can expose only the top-level skill and disable helper tools', () => {
  const tools = []
  const skills = []
  apply({
    tools: { register(tool) { tools.push(tool) } },
    skills: { register(skill) { skills.push(skill) } },
  }, { ...config, enableSharedScene: false, exposeLegacyTools: true, enableHelpers: false, registerModuleSkills: false })

  assert.equal(skills.length, 1)
  assert.equal(tools.some((tool) => tool.name === 'blender_helper_run'), false)
  assert.equal(tools.some((tool) => tool.name === 'blender_validate_export'), true)
})

test('workspace path guard accepts local paths and rejects traversal', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-blender-path-test-'))
  const exec = { agent: { session: { header: { cwd: workspace } } } }
  const local = await internals.resolveWorkspacePath('artifacts/model.blend', exec, config, { kind: 'save_path' })
  assert.equal(local, join(workspace, 'artifacts', 'model.blend'))
  await assert.rejects(
    internals.resolveWorkspacePath('../escape.blend', exec, config, { kind: 'save_path' }),
    /must stay inside/u,
  )
})

test('workspace path guard rejects a symlinked output parent that escapes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-blender-symlink-workspace-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-blender-symlink-outside-'))
  await mkdir(join(workspace, 'artifacts'))
  await symlink(await realpath(outside), join(workspace, 'artifacts', 'escape'))
  const exec = { agent: { session: { header: { cwd: workspace } } } }
  await assert.rejects(
    internals.resolveWorkspacePath('artifacts/escape/model.blend', exec, config, { kind: 'save_path' }),
    /resolves through a path outside/u,
  )
})

test('lossless JSON normalization removes negative zero recursively', () => {
  const normalized = internals.normalizeLosslessJson({
    scalar: -0,
    nested: [-0, { value: -0 }],
  })
  assert.equal(Object.is(normalized.scalar, -0), false)
  assert.equal(Object.is(normalized.nested[0], -0), false)
  assert.equal(Object.is(normalized.nested[1].value, -0), false)
})

test('asset capabilities survive default transport and compatibility registration stays unique', () => {
  for (const options of [{}, {exposeLegacyTools:true}, {enableSharedScene:false}]) {
    const tools=[]
    apply({tools:{register(t){tools.push(t)}}}, {...config,registerSkill:false,...options})
    const names=tools.map(t=>t.name)
    assert.equal(new Set(names).size,names.length)
    for(const name of ['blender_import','blender_export','blender_validate_scene','blender_validate_export','blender_preview','blender_render_frames','blender_helper_catalog','blender_helper_run'])assert.ok(names.includes(name))
  }
  const tools=[]
  apply({tools:{register(t){tools.push(t)}}},{...config,registerSkill:false,enableHelpers:false})
  assert.equal(tools.some(t=>t.name.startsWith('blender_helper_')),false)
  assert.ok(tools.some(t=>t.name==='blender_export'))
})
