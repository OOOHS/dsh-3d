import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('asset import, live editing, animation observation, helpers and export round trip', {
  skip: process.env.RUN_SCENE_TESTS !== '1', timeout: 300000,
}, async () => {
  const workspace = await mkdtemp(join(process.env.SCENE_TEST_OUTPUT ?? tmpdir(), 'dsh-assets-'))
  const tools = new Map(), disposers = [], evidence = []
  apply({ tools: { register(t) { tools.set(t.name,t) } }, skills: { register() {} },
    effect(fn) { const dispose=fn(); if(dispose) disposers.push(dispose) },
    get(name) { if(name==='attachments') return { async saveImage({data,mediaType}) {
      return { attachmentId:randomUUID(),mediaType,bytes:data.length,width:data.readUInt32BE(16),height:data.readUInt32BE(20) }
    } } },
  }, { blenderExecutable:process.env.BLENDER_EXECUTABLE??'blender',
    analysisPythonExecutable:process.env.ANALYSIS_PYTHON??'',
    timeoutMs:120000,helperTimeoutMs:60000,maxOutputChars:20000,restrictToWorkspace:true,
    enablePython:true,enableSharedScene:true,registerSkill:false,registerAgentPresets:false })
  const exec={agent:{session:{header:{id:randomUUID(),cwd:workspace}}},signal:new AbortController().signal}
  const run=async(name,args)=>{const value=await tools.get(name).execute(args,{...exec,callId:randomUUID()});evidence.push({name,args,value});return value}
  try {
    // An independent portable asset is imported through the real public tool.
    await writeFile(join(workspace,'source.obj'), 'o Asset\nv -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nv 0 0 2\nf 1 4 3 2\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5\n')
    await run('blender_scene',{action:'new'})
    const imported=await run('blender_import',{source_path:'source.obj',save_path:'imported.blend'})
    assert.equal((await run('blender_scene',{action:'inspect'})).object_count,0)
    assert.equal(imported.scene.objectCount,1)
    assert.deepEqual(imported.importedObjects,['Asset'])
    await run('blender_scene',{action:'open',blend_path:imported.blendPath})
    await run('blender_execute',{observe:false,script:`
obj=next(o for o in bpy.context.scene.objects if o.type=='MESH');obj.name='Asset'
obj.modifiers.new('Bevel','BEVEL').width=.12
obj.data.uv_layers.new(name='UV-Test')
obj.vertex_groups.new(name='Tip')
obj.shape_key_add(name='Basis');obj.shape_key_add(name='TipShape')
mat=bpy.data.materials.new('Blue');mat.use_nodes=True
mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.05,.3,.8,1)
obj.data.materials.append(mat)
obj.keyframe_insert(data_path='location',frame=1)
obj.location.x=1.5;obj.keyframe_insert(data_path='location',frame=10)
bpy.context.scene.frame_end=10;bpy.context.scene.frame_set(1)
bpy.ops.object.camera_add(location=(6,-8,5))
cam=bpy.context.object;cam.name='Camera';cam.rotation_euler=(mathutils.Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=7;bpy.context.scene.camera=cam
bpy.context.scene.render.engine='BLENDER_WORKBENCH'
bpy.context.view_layer.objects.active=obj;obj.select_set(True)
`})
    const detail=await run('blender_scene',{action:'inspect',object_names:['Asset','Missing'],detail:true})
    const d=detail.objects[0].detail
    assert.ok(d.evaluatedMesh.polygons>d.mesh.polygons)
    assert.ok(d.mesh.uvLayers.includes('UV-Test'));assert.deepEqual(d.vertexGroups,['Tip'])
    assert.deepEqual(d.mesh.shapeKeys,['Basis','TipShape']);assert.ok(d.animation.action)
    assert.deepEqual(detail.missing,['Missing'])
    const base=await run('blender_scene',{action:'inspect',object_names:['Asset'],detail:true,evaluated:false})
    assert.equal(base.objects[0].detail.evaluatedMesh,undefined)
    await run('blender_view',{kind:'viewport',time_frame:10})
    const at10=await run('blender_scene',{action:'inspect',object_names:['Asset']})
    assert.equal(at10.timeline.current,10);assert.equal(at10.objects[0].location[0],1.5)
    const rendered=await run('blender_view',{kind:'render',time_frame:1,transparent:true,output_path:'frame1.png',width:160,height:160,samples:4})
    assert.equal(rendered.view.time_frame,1);assert.ok(rendered.view.attachment)
    const state=await run('blender_execute',{observe:false,script:"dsh_result={'frame':bpy.context.scene.frame_current,'transparent':bpy.context.scene.render.film_transparent}"})
    assert.deepEqual(state.script_result,{frame:10,transparent:false})
    await assert.rejects(run('blender_view',{kind:'render',time_frame:1,camera:'Absent',width:160,height:160}),/camera/i)
    await assert.rejects(run('blender_view',{time_frame:1.5}),/integer/)
    assert.equal((await run('blender_scene',{action:'status'})).timeline.current,10)
    // Continue editing the imported component after observations.
    await run('blender_execute',{observe:false,script:"bpy.data.objects['Asset'].modifiers['Bevel'].width=.2"})
    await run('blender_scene',{action:'save',save_path:'edited.blend'})
    const checked=await run('blender_validate_scene',{blend_path:'edited.blend',profile:'animation'})
    assert.equal(checked.passed,true)
    const frames=await run('blender_render_frames',{blend_path:'edited.blend',output_dir:'frames',frames:[1,10],width:160,height:160,samples:4})
    assert.equal(frames.imagePaths.length,2)
    assert.notDeepEqual(await readFile(frames.imagePaths[0]),await readFile(frames.imagePaths[1]))
    const catalog=await run('blender_helper_catalog',{helper:'animation-contact-sheet'})
    assert.equal(catalog.helpers[0].available,true)
    assert.ok(catalog.helpers[0].arguments.some(a=>a.name==='frames'))
    await run('blender_helper_run',{helper:'animation-contact-sheet',arguments:{frames:frames.imagePaths,out_image:'contact.png',out_report:'contact.json'}})
    assert.ok((await readFile(join(workspace,'contact.png'))).length>0)
    const exported=await run('blender_export',{blend_path:'edited.blend',output_path:'edited.glb'})
    assert.ok(exported.bytes>0)
    const roundtrip=await run('blender_validate_export',{model_path:'edited.glb',profile:'animation'})
    assert.equal(roundtrip.validation.passed,true)
    assert.ok(roundtrip.importedObjects.includes('Asset'))
    const before=(await run('blender_scene',{action:'inspect',object_names:['Asset']})).objects[0]
    await run('blender_import',{source_path:'edited.glb',save_path:'roundtrip.blend'})
    assert.deepEqual((await run('blender_scene',{action:'inspect',object_names:['Asset']})).objects[0],before)
    await run('blender_scene',{action:'open',blend_path:'roundtrip.blend'})
    const after=await run('blender_scene',{action:'inspect',object_names:['Asset'],detail:true})
    assert.ok(after.objects[0].detail.mesh.uvLayers.length>0)
    assert.ok(after.objects[0].materials.includes('Blue'));assert.ok(after.objects[0].detail.animation.action)
    await run('blender_view',{time_frame:1})
    const p1=(await run('blender_scene',{action:'inspect',object_names:['Asset']})).objects[0].location
    await run('blender_view',{time_frame:10})
    const p10=(await run('blender_scene',{action:'inspect',object_names:['Asset']})).objects[0].location
    assert.notDeepEqual(p1,p10)
    await run('blender_execute',{observe:false,script:"bpy.data.objects['Asset'].scale.z=1.1"})
    await run('blender_scene',{action:'save',save_path:'continued.blend'})
  } finally {
    await writeFile(join(workspace,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Evidence:',workspace)
    for(const dispose of disposers.reverse())await dispose()
  }
})
