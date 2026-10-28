// Async body for the host's run_code. Runs against an isolated test workspace.
const assert = (await import('node:assert/strict')).default;
const invoked = new Set<string>();
async function run(name: string, args: any) {
  const result = await tools[name](args);
  invoked.add(name);
  console.log('PASS', name, args.action ?? '');
  return result;
}
const skill = await run('skill', {name:'create-3d-model'});
assert.match(skill.content, /Replayable programs/);
assert.equal((await run('blender_status', {})).available, true);
await run('blender_scene', {action:'new'});
await run('blender_edit', {action:'create',primitive:'sphere',name:'Volume',density:'medium'});
let view = await run('blender_sculpt', {action:'begin',object_name:'Volume',preset:'front'});
const p = view.view.target.surface_samples[0].point;
const stroke = await run('blender_sculpt', {action:'stroke',brush:'draw',points:[p,p,p],view_id:view.view.view_id,radius:.15,strength:.6,symmetry:''});
assert.equal(stroke.changed, true);
await run('blender_sculpt', {action:'commit'});
const code = await run('blender_execute', {observe:false,script:`
dsh.edit('transform', object_name='Volume', location=[.2,0,0], relative=True)
dsh.emit(dsh.view())
dsh_result={'location':list(bpy.data.objects['Volume'].location)}
`});
assert.ok(code.emitted_images[0].attachment);
await run('blender_edit', {action:'camera',name:'Camera',preset:'front',ortho_scale:4});
await run('blender_edit', {action:'environment',engine:'BLENDER_WORKBENCH'});
await run('blender_view', {kind:'render',output_path:'render.png',width:160,height:160,samples:4});
await run('inspect_image', {image:'render.png',region:[.2,.2,.6,.6],zoom:2});
await run('blender_scene', {action:'save',save_path:'model.blend'});
const cp = await run('blender_checkpoint', {action:'save',blend_path:'model.blend',label:'Code replay',evidence_paths:['render.png']});
await run('blender_checkpoint', {action:'restore',checkpoint_id:cp.checkpoint.checkpoint_id,save_path:'restored.blend'});
await run('blender_export', {blend_path:'restored.blend',output_path:'model.glb'});
await run('blender_validate_scene', {blend_path:'restored.blend'});
await run('blender_validate_export', {model_path:'model.glb'});
await run('blender_import', {source_path:'model.glb',save_path:'imported.blend'});
await run('blender_preview', {blend_path:'restored.blend',output_path:'preview.png',width:160,height:160,samples:4});
const frames = await run('blender_render_frames', {blend_path:'restored.blend',output_dir:'frames',frames:[1,2],width:160,height:160,samples:4});
await run('blender_helper_catalog', {});
await run('blender_helper_run', {helper:'animation-contact-sheet',arguments:{frames:frames.imagePaths,out_image:'sheet.png',out_report:'sheet.json'}});
const notes = await run('modeling_notes_read', {});
const note = await run('modeling_notes_write', {action:'put',title:'Programmatic contract',content:'Native brush changed the current mesh in a replay program.',expected_revision:notes.revision});
assert.equal((await run('modeling_notes_read', {id:note.id})).entries.length,1);
await run('review_reconstruction', {action:'begin',reference_path:'render.png',blend_path:'restored.blend'});
await run('review_reconstruction', {action:'status'});
// Failed later calls preserve earlier effects and pass through the path guard.
await assert.rejects(run('blender_execute', {tool_path:'../escape.py',observe:false}), /must stay inside/);
assert.ok((await run('blender_scene', {action:'inspect'})).objects.some(o=>o.name==='Volume'));
await run('blender_scene', {action:'close'});
return {invoked:[...invoked],brushChanged:stroke.changed,explicitImages:code.emitted_images.length,pathGuard:true};
