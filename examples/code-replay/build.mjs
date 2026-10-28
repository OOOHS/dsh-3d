// Copy into the task workspace. Load with run_code and call run(tools, params).
export async function run(tools, { strength = 0.6 } = {}) {
  await tools.blender_scene({ action: 'new' });
  const shaped = await tools.blender_execute({
    params: { strength }, observe: false,
    script: `
dsh.edit('create', primitive='sphere', name='Volume', density='medium')
dsh.sculpt('begin', object_name='Volume', preset='front')
dsh.sculpt('configure', brush='draw', symmetry='')
target = dsh.project([[0,-1,0]], object_name='Volume')[0]
assert target['in_view'] and target['hit']['target'], target
p = target['point']
stroke = dsh.sculpt('stroke', points=[p,p,p], radius=.15, strength=params['strength'])
dsh.emit(stroke)
dsh.sculpt('commit')
dsh_result = {'changed':stroke['changed'], 'displacement':stroke['displacement']}
` });
  await tools.blender_scene({ action: 'save', save_path: 'model.blend', allow_overwrite: true });
  await tools.blender_export({ blend_path: 'model.blend', output_path: 'model.glb', allow_overwrite: true });
  return shaped.script_result;
}
