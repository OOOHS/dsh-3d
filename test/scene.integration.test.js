import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('shared native scene: code/brush/code, hot-edited tools, rollback, render, candidates and reopen', {
  skip: process.env.RUN_SCENE_TESTS !== '1', timeout: 240000,
}, async () => {
  const workspace = await mkdtemp(join(process.env.SCENE_TEST_OUTPUT ?? tmpdir(), 'dsh-native-scene-'))
  const tools = new Map(), disposers = [], evidence = []
  apply({ tools: { register(tool) { tools.set(tool.name, tool) } }, skills: { register() {} },
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose) },
    get(name) { if (name === 'attachments') return { async saveImage({ data, mediaType }) {
      return { attachmentId: randomUUID(), mediaType, bytes: data.length,
        width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    } } },
  }, { blenderExecutable: process.env.BLENDER_EXECUTABLE ?? 'blender', analysisPythonExecutable: '',
    timeoutMs: 60000, helperTimeoutMs: 60000, maxOutputChars: 20000, restrictToWorkspace: true,
    enablePython: true, enableSharedScene: true, registerSkill: false, registerAgentPresets: false })
  const exec = { agent: { session: { header: { id: randomUUID(), cwd: workspace } } }, signal: new AbortController().signal }
  const run = async (name, args, callId = randomUUID()) => {
    const value = await tools.get(name).execute(args, { ...exec, callId })
    evidence.push({ name, args, value })
    return value
  }
  try {
    assert.equal(tools.size, 7)
    const opened = await run('blender_scene', { action: 'new' })
    assert.equal(opened.object_count, 0)
    const pid = opened.pid
    assert.ok(opened.view.attachment)
    let value = await run('blender_execute', { script: `
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, location=(1,-2,.5))
bpy.context.object.name = 'HairVolume'
bpy.context.object.scale = (1.2,.8,1)
bpy.ops.object.shade_smooth()
dsh_result = {'created': bpy.context.object.name}
` })
    assert.equal(value.pid, pid)
    assert.deepEqual(value.changed_objects, ['HairVolume'])
    const original = value.geometry_hash
    value = await run('blender_sculpt', { action: 'begin', object_name: 'HairVolume', preset: 'front' })
    const sample = value.view.target.surface_samples[0].point
    value = await run('blender_sculpt', { action: 'stroke', brush: 'draw', view_id: value.view.view_id,
      points: [sample, sample, sample], strength: .65, radius: .12 })
    assert.equal(value.changed, true)
    const sculpted = value.geometry_hash
    assert.notEqual(sculpted, original)
    value = await run('blender_sculpt', { action: 'undo' })
    assert.equal(value.geometry_hash, original)
    value = await run('blender_sculpt', { action: 'redo' })
    assert.equal(value.geometry_hash, sculpted)
    value = await run('blender_execute', { script: `
bpy.ops.mesh.primitive_cube_add(size=.15, location=(1.8,-2,.2))
bpy.context.object.name='Clasp'
bpy.context.view_layer.objects.active=bpy.data.objects['HairVolume']
dsh_result={'hair_vertices':len(bpy.data.objects['HairVolume'].data.vertices)}
` })
    assert.equal(value.geometry_hash, sculpted)
    assert.equal(value.object_count, 2)
    assert.equal(value.pid, pid)
    await mkdir(join(workspace, 'tools'))
    const toolPath = join(workspace, 'tools', 'offset.py')
    await writeFile(toolPath, '"""Offset a component, first version."""\ndef run(params):\n    ob=bpy.data.objects[params["name"]]\n    ob.location.x += params["delta"]\n    return {"x":ob.location.x,"version":1}\n')
    const first = await run('blender_execute', { tool_path: 'tools/offset.py', params: { name: 'Clasp', delta: .2 }, observe: false })
    await writeFile(toolPath, '"""Offset a component, revised version."""\ndef run(params):\n    ob=bpy.data.objects[params["name"]]\n    ob.location.x += params["delta"]*2\n    return {"x":ob.location.x,"version":2}\n')
    const second = await run('blender_execute', { tool_path: 'tools/offset.py', params: { name: 'Clasp', delta: .2 }, observe: false })
    assert.equal(first.script_result.version, 1)
    assert.equal(second.script_result.version, 2)
    assert.notEqual(first.tool_sha256, second.tool_sha256)
    assert.ok(Math.abs(second.script_result.x - first.script_result.x - .4) < .00001)
    assert.equal(second.pid, pid)
    const status = await run('blender_scene', { action: 'status' })
    assert.equal(status.project_tools[0].description, 'Offset a component, revised version.')
    await assert.rejects(run('blender_execute', { script: "bpy.data.objects['Clasp'].location.x=99\nraise ValueError('intentional failure')" }), /scene restored/u)
    value = await run('blender_execute', { script: "dsh_result={'x':bpy.data.objects['Clasp'].location.x}", observe: false })
    assert.ok(Math.abs(value.script_result.x - second.script_result.x) < .00001)
    assert.equal(value.pid, pid)
    const callId = randomUUID(), args = { script: "bpy.data.objects['Clasp'].location.y += .2", observe: false }
    const done = await run('blender_execute', args, callId)
    assert.equal((await run('blender_execute', args, callId)).revision, done.revision)
    await assert.rejects(run('blender_scene', { action: 'inspect', scene_id: randomUUID() }), /another scene/u)
    await assert.rejects(run('blender_execute', { tool_path: '../outside.py' }), /must stay inside/u)
    await run('blender_execute', { script: `
bpy.ops.object.camera_add(location=(1,-7,2))
cam=bpy.context.object
cam.name='Front'
cam.rotation_euler=(mathutils.Vector((1,-2,.5))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO'
cam.data.ortho_scale=4
bpy.context.scene.camera=cam
bpy.context.scene.render.engine='BLENDER_WORKBENCH'
`, observe: false })
    const rendered = await run('blender_view', { kind: 'render', camera: 'Front', output_path: 'evidence/front.png', width: 320, height: 320, samples: 4 })
    assert.equal(rendered.view.kind, 'render')
    assert.ok(rendered.view.attachment)
    const provenance = JSON.parse(await readFile(join(workspace, 'evidence/front.png.json'), 'utf8'))
    assert.equal(provenance.scene_id, opened.scene_id)
    const snapshot = await run('blender_scene', { action: 'save', save_path: 'models/candidate.blend' })
    assert.equal(snapshot.pid, pid)
    await run('blender_checkpoint', { action: 'save', blend_path: 'models/candidate.blend', label: 'Code and brush candidate', evidence_paths: ['evidence/front.png'] })
    await run('blender_scene', { action: 'close' })
    const reopened = await run('blender_scene', { action: 'open', blend_path: 'models/candidate.blend' })
    assert.equal(reopened.object_count, 3)
    value = await run('blender_sculpt', { action: 'begin', object_name: 'HairVolume' })
    assert.equal(value.geometry_hash, sculpted)
    await run('blender_sculpt', { action: 'commit' })
    value = await run('blender_execute', { script: `
dsh.select('HairVolume', sculpt=True, preset='front', isolate=True)
v=dsh.view()
p=v['target']['surface_samples'][0]['point']
dsh_result=dsh.stroke(brush='inflate', view_id=v['view_id'], points=[p,p,p], radius=.12, strength=.5)
` })
    assert.equal(value.script_result.changed, true)
    assert.ok(value.brush_base_path)
    await run('blender_sculpt', { action: 'discard' })
    value = await run('blender_sculpt', { action: 'begin', object_name: 'HairVolume' })
    assert.equal(value.geometry_hash, sculpted)
    await run('blender_sculpt', { action: 'commit' })
    value = await run('blender_execute', { script: "dsh_result={'names':sorted(ob.name for ob in bpy.context.scene.objects)}", observe: false })
    assert.deepEqual(value.script_result.names, ['Clasp', 'Front', 'HairVolume'])
  } finally {
    await writeFile(join(workspace, 'evidence.json'), JSON.stringify(evidence, null, 2))
    for (const dispose of disposers) await dispose()
    console.log('Shared scene evidence: ' + workspace)
  }
})
