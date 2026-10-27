import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {internals} from '../index.js'

test('persisted fingerprints survive reload and still detect material curve modifier and animation edits', {
  skip:process.env.RUN_BLENDER_TESTS!=='1',timeout:60000,
},async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'dsh-fingerprints-'))
 const config={blenderExecutable:process.env.BLENDER_BIN??'blender',timeoutMs:60000,maxOutputChars:20000}
 const scripts=fileURLToPath(new URL('../scripts',import.meta.url))
 const result=await internals.runBlender(config,{signal:new AbortController().signal},'execute',{
  workspace,output_path:join(workspace,'verified.blend'),script:`
import sys,json
sys.path.insert(0,${JSON.stringify(scripts)})
from scene_fingerprint import object_details
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
o=bpy.context.object;o.name='Box'
o.modifiers.new('Bevel','BEVEL').width=.1
m=bpy.data.materials.new('Mat');m.use_nodes=True;o.data.materials.append(m)
o.keyframe_insert(data_path='location',frame=1)
o.location.x=1;o.keyframe_insert(data_path='location',frame=10)
c=bpy.data.curves.new('Curve','CURVE');c.dimensions='3D'
s=c.splines.new('POLY');s.points.add(1);s.points[1].co=(1,0,0,1)
bpy.context.collection.objects.link(bpy.data.objects.new('Curve',c))
bpy.context.view_layer.update()
canonical=lambda:{o.name:object_details(o) for o in bpy.context.scene.objects}
uid=bpy.data.materials['Mat'].node_tree.session_uid
before=canonical()
bpy.ops.wm.save_as_mainfile(filepath=workspace+'/reopen.blend',check_existing=False)
bpy.ops.wm.open_mainfile(filepath=workspace+'/reopen.blend',load_ui=False)
bpy.context.view_layer.update()
after=canonical()
assert before==after,'A reload changed persistent fingerprints'
assert uid!=bpy.data.materials['Mat'].node_tree.session_uid,'Probe requires a changed runtime ID'
changed=[]
bpy.data.materials['Mat'].node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.2
assert before['Box']!=canonical()['Box'];changed.append('material');before=canonical()
bpy.data.objects['Box'].modifiers['Bevel'].width=.3
assert before['Box']!=canonical()['Box'];changed.append('modifier');before=canonical()
bpy.data.curves['Curve'].splines[0].points[1].co.y=.5
assert before['Curve']!=canonical()['Curve'];changed.append('curve');before=canonical()
o=bpy.data.objects['Box'];o.location.x=2;o.keyframe_insert(data_path='location',frame=10)
assert before['Box']!=canonical()['Box'];changed.append('animation')
dsh_result={'reload_stable':True,'runtime_id_changed':True,'changes_detected':changed}
`})
 assert.equal(result.script_result.reload_stable,true)
 assert.deepEqual(result.script_result.changes_detected,['material','modifier','curve','animation'])
})
