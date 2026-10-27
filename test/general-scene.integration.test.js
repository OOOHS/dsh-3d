import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('continuous curve modifier material animation and live checkpoint restore', {
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
    await run('blender_scene',{action:'new'})
    await run('blender_execute',{script:`
bpy.ops.mesh.primitive_cube_add()
bpy.context.object.name='Box'
bpy.context.object.modifiers.new('Bevel','BEVEL').width=.1
m=bpy.data.materials.new('Mat'); m.use_nodes=True
bpy.context.object.data.materials.append(m)
c=bpy.data.curves.new('CurveData','CURVE');c.dimensions='3D';c.bevel_depth=.1
sp=c.splines.new('POLY');sp.points.add(1);sp.points[1].co=(1,0,0,1)
o=bpy.data.objects.new('Curve',c);bpy.context.collection.objects.link(o)
b=bpy.data.objects['Box'];b.keyframe_insert(data_path='location',frame=1)
b.location.x=2;b.keyframe_insert(data_path='location',frame=10)
`})
    for (const [name,script] of [
      ['Curve',"bpy.data.curves['CurveData'].splines[0].points[1].co.y=1"],
      ['Box',"bpy.data.objects['Box'].modifiers['Bevel'].width=.3"],
      ['Box',"nt=bpy.data.materials['Mat'].node_tree; n=nt.nodes.new('ShaderNodeEmission'); nt.links.new(n.outputs[0],nt.nodes.get('Material Output').inputs['Surface'])"],
      ['Box',"b=bpy.data.objects['Box'];b.location.x=3;b.keyframe_insert(data_path='location',frame=10)"]]) {
        const v=await run('blender_execute',{script});assert.ok(v.changed_objects.includes(name),script)
    }
    const unchanged=await run('blender_execute',{script:'dsh_result=42'});assert.deepEqual(unchanged.changed_objects,[])
    await run('blender_scene',{action:'save',save_path:'saved.blend'})
    const checkpoint=await run('blender_checkpoint',{action:'save',blend_path:'saved.blend',label:'all domains'})
    console.log('checkpoint keys',Object.keys(checkpoint))
    await run('blender_execute',{script:"bpy.data.objects['Box'].modifiers['Bevel'].width=.7"})
    const restored=await run('blender_checkpoint',{action:'restore',checkpoint_id:checkpoint.checkpoint?.checkpoint_id??checkpoint.checkpoint_id,save_path:'restored.blend'})
    assert.equal(restored.activation,'live')
    const v=await run('blender_execute',{script:"b=bpy.data.objects['Box'];bpy.context.scene.frame_set(10);dsh_result={'width':b.modifiers['Bevel'].width,'curve_y':bpy.data.curves['CurveData'].splines[0].points[1].co.y,'x':b.location.x,'surface':bpy.data.materials['Mat'].node_tree.nodes.get('Material Output').inputs['Surface'].links[0].from_node.bl_idname}"})
    assert.ok(Math.abs(v.script_result.width-.3)<1e-5);assert.equal(v.script_result.curve_y,1);assert.equal(v.script_result.x,3)
    assert.equal(v.script_result.surface,'ShaderNodeEmission')
    for (const [name,script] of [
      ['Curve',"bpy.data.curves['CurveData'].splines[0].points[1].co.y=2"],
      ['Box',"bpy.data.objects['Box'].modifiers['Bevel'].width=.2"],
      ['Box',"bpy.data.materials['Mat'].node_tree.nodes.get('Emission').inputs['Strength'].default_value=2"],
      ['Box',"b=bpy.data.objects['Box'];b.location.x=4;b.keyframe_insert(data_path='location',frame=10)"]]) {
      const next=await run('blender_execute',{script});assert.ok(next.changed_objects.includes(name))
    }
    await writeFile(join(workspace,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Evidence:',workspace)
  } finally { for(const dispose of disposers.reverse()) await dispose() }
})
