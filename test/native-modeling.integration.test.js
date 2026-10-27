import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('native controls: dense primitive, sculpt, duplicate, scene undo/redo, assembly, remesh, render and atomic failure', {
  skip: process.env.RUN_NATIVE_MODELING_TESTS !== '1', timeout: 240000,
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-native-controls-'))
  const tools = new Map(), disposers = [], evidence = []
  apply({ tools: { register(tool) { tools.set(tool.name, tool) } }, skills: { register() {} },
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose) },
    get(name) { if (name === 'attachments') return { async saveImage({ data, mediaType }) {
      return { attachmentId: randomUUID(), mediaType, bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    } } },
  }, { blenderExecutable: process.env.BLENDER_EXECUTABLE, analysisPythonExecutable: '', timeoutMs: 60000,
    helperTimeoutMs: 60000, maxOutputChars: 20000, restrictToWorkspace: true, enablePython: false,
    enableSharedScene: true, registerSkill: false, registerAgentPresets: false })
  const exec = { agent: { session: { header: { id: randomUUID(), cwd: workspace } } }, signal: new AbortController().signal }
  const run = async (name, args, callId = randomUUID()) => {
    const value = await tools.get(name).execute(args, { ...exec, callId })
    evidence.push({ name, args, value }); console.log('PASS', name, args.action ?? args.kind)
    return value
  }
  const edit = args => run('blender_edit', args)
  try {
    assert.equal(tools.has('blender_execute'), false)
    await run('blender_scene', { action: 'new' })
    let value = await edit({ action: 'create', primitive: 'sphere', name: 'Volume', dimensions: [2, 1.6, 2], color: [.1, .3, .7, 1] })
    assert.ok(value.view.attachment)
    assert.ok(value.vertices > 4000)
    const initial = value.geometry_hash
    value = await run('blender_sculpt', { action: 'begin', object_name: 'Volume', preset: 'front' })
    const p = value.view.target.surface_samples.map(s => s.point).sort((a, b) => Math.hypot(a[0]-.5, a[1]-.5)-Math.hypot(b[0]-.5,b[1]-.5))[0]
    value = await run('blender_sculpt', { action: 'stroke', brush: 'draw', view_id: value.view.view_id,
      points: [p, p, p], radius: .15, strength: .65 })
    assert.equal(value.changed, true)
    const sculpted = value.geometry_hash
    assert.notEqual(sculpted, initial)
    await run('blender_sculpt', { action: 'commit' })
    value = await edit({ action: 'duplicate', name: 'Copy', location: [1.2, 0, 0], relative: true })
    assert.equal(value.object_count, 2)
    assert.equal(value.geometry_hash, sculpted)
    value = await edit({ action: 'undo' })
    assert.equal(value.object_count, 1)
    assert.equal(value.geometry_hash, sculpted)
    value = await edit({ action: 'redo' })
    assert.equal(value.object_count, 2)
    assert.equal(value.geometry_hash, sculpted)
    const retryId = randomUUID(), retryArgs = { action: 'transform', object_name: 'Copy', location: [.1, 0, 0], relative: true }
    const first = await run('blender_edit', retryArgs, retryId)
    assert.equal((await run('blender_edit', retryArgs, retryId)).revision, first.revision)
    await edit({ action: 'parent', object_names: ['Copy'], parent_name: 'Volume' })
    await edit({ action: 'unparent', object_name: 'Copy' })
    value = await edit({ action: 'join', object_names: ['Volume', 'Copy'], name: 'Joined' })
    assert.equal(value.object_count, 1)
    assert.equal(value.active_object, 'Joined')
    value = await edit({ action: 'remesh', object_name: 'Joined', voxel_size: .08 })
    assert.ok(value.vertices > 1000)
    const remeshed = value.geometry_hash
    await assert.rejects(edit({ action: 'create', primitive: 'sphere', name: 'Bad', color: [2, 0, 0, 1] }), /color values/u)
    value = await run('blender_scene', { action: 'inspect' })
    assert.equal(value.object_count, 1)
    assert.equal(value.objects[0].name, 'Joined')
    assert.equal(value.geometry_hash, remeshed)
    await assert.rejects(edit({ action: 'create', script: 'bpy.ops.wm.quit_blender()' }), /native editing|Native editing/u)
    await edit({ action: 'visibility', object_name: 'Joined', visible: false })
    value = await edit({ action: 'transform', object_name: 'Joined', location: [0, 0, .05], relative: true })
    assert.equal(value.objects.find(o => o.name === 'Joined').visible, false, 'Transform retains viewport hiding')
    await assert.rejects(edit({ action: 'transform', object_name: 'Joined', visible: false }), /action visibility/u)
    value = await edit({ action: 'duplicate', object_name: 'Joined', name: 'HiddenCopy' })
    assert.equal(value.objects.find(o => o.name === 'HiddenCopy').visible, false, 'Duplicate inherits source hiding')
    assert.equal(value.objects.find(o => o.name === 'Joined').visible, false)
    await edit({ action: 'delete', object_name: 'HiddenCopy' })
    await edit({ action: 'visibility', object_name: 'Joined', visible: true })
    for (const primitive of ['cube', 'cylinder', 'cone', 'torus', 'plane', 'icosphere']) {
      value = await edit({ action: 'create', primitive, name: primitive, density: 'coarse', location: [0, 0, -4] })
      assert.ok(value.vertices >= 200, primitive + ' has a dense mesh')
      await edit({ action: 'delete', object_name: primitive })
    }
    value = await edit({ action: 'environment', engine: 'BLENDER_EEVEE_NEXT' })
    assert.ok(['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'].includes(value.engine))
    value = await edit({ action: 'environment', engine: 'BLENDER_EEVEE' })
    assert.ok(['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'].includes(value.engine))
    await edit({ action: 'environment', engine: 'BLENDER_WORKBENCH', background: [1, 1, 1] })
    await edit({ action: 'camera', name: 'Front', preset: 'front', ortho_scale: 4, target: [.5, 0, 0] })
    await edit({ action: 'light', name: 'Key', location: [-3, -4, 6] })
    value = await run('blender_view', { kind: 'render', camera: 'Front', output_path: 'front.png', width: 320, height: 320, samples: 4 })
    assert.ok(value.view.attachment)
    const provenance = JSON.parse(await readFile(join(workspace, 'front.png.json')))
    assert.equal(provenance.camera, 'Front')
    await run('blender_scene', { action: 'save', save_path: 'result.blend' })
    await run('blender_scene', { action: 'close' })
    value = await run('blender_scene', { action: 'open', blend_path: 'result.blend' })
    assert.equal(value.object_count, 3)
    await run('blender_sculpt', { action: 'begin', object_name: 'Joined', preset: 'front' })
    value = await run('blender_sculpt', { action: 'status' })
    assert.equal(value.geometry_hash, remeshed)
  } finally {
    await writeFile(join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2))
    for (const dispose of disposers) await dispose()
    console.log('Native modeling evidence: ' + workspace)
  }
})
