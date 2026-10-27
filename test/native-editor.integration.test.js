import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('native editor: effective radius, off-surface drag, persistent context, discovery, masks and undo', {
  skip: process.env.RUN_EDITOR_TESTS !== '1', timeout: 240000,
}, async () => {
  const workspace = await mkdtemp(join(process.env.SCENE_TEST_OUTPUT ?? tmpdir(), 'dsh-native-editor-'))
  const tools = new Map(), disposers = [], evidence = []
  apply({ tools: { register(tool) { tools.set(tool.name, tool) } }, skills: { register() {} },
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose) },
    get(name) { if (name === 'attachments') return { async saveImage({ data, mediaType }) {
      return { attachmentId: randomUUID(), mediaType, bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    } } },
  }, { blenderExecutable: process.env.BLENDER_EXECUTABLE ?? 'blender', analysisPythonExecutable: '',
    timeoutMs: 60000, helperTimeoutMs: 60000, maxOutputChars: 20000, restrictToWorkspace: true,
    enablePython: true, enableSharedScene: true, registerSkill: false, registerAgentPresets: false })
  const exec = { agent: { session: { header: { id: randomUUID(), cwd: workspace } } }, signal: new AbortController().signal }
  const run = async (name, args) => {
    const value = await tools.get(name).execute(args, { ...exec, callId: randomUUID() })
    evidence.push({ name, args, value })
    return value
  }
  try {
    let value = await run('blender_execute', { script: `
bpy.ops.mesh.primitive_uv_sphere_add(segments=128,ring_count=96)
bpy.context.object.name='Probe'
bpy.ops.object.shade_smooth()
` })
    const original = value.geometry_hash, pid = value.pid
    value = await run('blender_sculpt', { action: 'begin', object_name: 'Probe', preset: 'front', highlight: false })
    const all = await run('blender_sculpt', { action: 'brushes', limit: 100 })
    assert.ok(all.total > 14)
    const allSettings = await run('blender_sculpt', { action: 'settings', limit: 100 })
    assert.ok(allSettings.total > 100)
    const catalog = await run('blender_sculpt', { action: 'brushes', query: 'Pose' })
    assert.ok(catalog.brushes.some(b => b.name === 'Pose'))
    const settings = await run('blender_sculpt', { action: 'settings', query: 'falloff_shape', group: 'brush' })
    assert.ok(settings.settings.some(p => p.choices.includes('PROJECTED')))
    value = await run('blender_sculpt', { action: 'configure', brush: 'grab', radius: .04, strength: .8,
      symmetry: '', settings: { brush: { use_frontface: false, falloff_shape: 'SPHERE' }, unified: { use_unified_size: true } } })
    assert.equal(value.editor.brush.size_source, 'unified')
    assert.ok(Math.abs(value.editor.brush.radius-.04) < 1/value.editor.viewport_pixels[0])
    const p = value.view.target.surface_samples[0].point
    value = await run('blender_sculpt', { action: 'stroke', view_id: value.view.view_id,
      points: [p, [p[0]+.08,p[1]-.04]] })
    assert.equal(value.geometry_changed, true)
    const narrow = value.displacement
    await run('blender_sculpt', { action: 'undo' })
    value = await run('blender_sculpt', { action: 'configure', radius: .18 })
    assert.equal(value.editor.brush.name, 'Grab')
    assert.ok(Math.abs(value.editor.brush.strength-.8)<1e-6)
    value = await run('blender_sculpt', { action: 'stroke', view_id: value.view.view_id, points: [p, [p[0]+.08,p[1]-.04]] })
    const wide = value.displacement
    assert.ok(wide.moved_vertices > narrow.moved_vertices * 3, JSON.stringify({ narrow, wide }))
    const shaped = value.geometry_hash, depth = value.undo_depth
    value = await run('blender_execute', { script: 'dsh_result=dsh.editor()', observe: false })
    assert.equal(value.mode, 'SCULPT')
    assert.equal(value.script_result.mode, 'SCULPT')
    assert.equal(value.undo_depth, depth)
    assert.equal(value.geometry_hash, shaped)
    assert.ok(Math.abs(value.editor.brush.radius-.18)<1/value.editor.viewport_pixels[0])
    value = await run('blender_sculpt', { action: 'undo' })
    assert.equal(value.geometry_hash, original)
    value = await run('blender_execute', { script: 's=bpy.context.tool_settings.sculpt\ns.unified_paint_settings.size=300\ns.unified_paint_settings.use_unified_strength=True\ns.unified_paint_settings.strength=.6', observe: false })
    assert.equal(value.mode, 'SCULPT')
    assert.equal(value.editor.brush.native_size, 300)
    assert.equal(value.editor.brush.strength_source, 'unified')
    assert.ok(Math.abs(value.editor.brush.strength-.6)<1e-6)
    value = await run('blender_sculpt', { action: 'configure', radius: .18, strength: .8 })
    const endpoint = [.95, .2]
    value = await run('blender_view', { probe_points: [p, endpoint] })
    assert.equal(value.probes[0].target, true)
    assert.equal(value.probes[1].target, false)
    value = await run('blender_sculpt', { action: 'stroke', view_id: value.view.view_id, points: [p, endpoint] })
    assert.equal(value.surface_hits, 1)
    assert.ok(value.displacement.max_distance > .2, JSON.stringify(value.displacement))
    await run('blender_sculpt', { action: 'undo' })
    value = await run('blender_execute', { mode: 'OBJECT', script: "ob=bpy.context.object\nob.location=(1,-2,.5)\nob.scale=(1.2,.8,1)\nob.rotation_euler.z=.35", observe: false })
    value = await run('blender_scene', { action: 'configure', mode: 'SCULPT' })
    value = await run('blender_view', { preset: 'front', frame: true })
    const translatedStart=value.view.target.surface_samples[0].point
    value = await run('blender_sculpt', { action: 'stroke', brush: 'grab', view_id: value.view.view_id, points: [translatedStart,endpoint], radius: .18, strength: .8, symmetry: '' })
    assert.ok(value.displacement.max_distance>.2)
    await run('blender_sculpt', { action: 'undo' })
    value = await run('blender_sculpt', { action: 'configure', brush: 'Mask', radius: .12, strength: .8 })
    const maskPoint=value.view.target.surface_samples[0].point
    value = await run('blender_sculpt', { action: 'stroke', view_id: value.view.view_id, points: [maskPoint,maskPoint,maskPoint] })
    assert.equal(value.geometry_changed, false)
    assert.equal(value.attributes_changed, true)
    assert.ok(value.editor.mesh['.sculpt_mask'].max > 0)
    await run('blender_sculpt', { action: 'undo' })
    value = await run('blender_sculpt', { action: 'configure', brush: 'Pose', radius: .15 })
    assert.equal(value.editor.brush.name, 'Pose')
    value = await run('blender_scene', { action: 'configure', mode: 'EDIT' })
    assert.equal(value.mode, 'EDIT')
    value = await run('blender_execute', { script: 'dsh_result={"mode":bpy.context.object.mode}', observe: false })
    assert.equal(value.script_result.mode, 'EDIT')
    value = await run('blender_execute', { mode: 'OBJECT', script: 'bpy.context.object.location.x+=.1', observe: false })
    assert.equal(value.mode, 'OBJECT')
    assert.equal(value.pid, pid)
    await run('blender_scene', { action: 'save', save_path: 'native-editor.blend' })
  } finally {
    await writeFile(join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2))
    for (const dispose of disposers) await dispose()
    console.log('Native editor evidence: ' + workspace)
  }
})
