import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('native editing feedback: aiming, visible picking, actual deltas, comparison, partial delivery and editable topology', {
  skip: process.env.RUN_FEEDBACK_TESTS !== '1', timeout: 300000,
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-feedback-'))
  const tools = new Map(), disposers = [], evidence = []
  apply({ tools: { register(tool) { tools.set(tool.name, tool) } }, skills: { register() {} },
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose) },
    get(name) { if (name === 'attachments') return { async saveImage({ data, mediaType }) {
      return { attachmentId: randomUUID(), mediaType, bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    } } },
  }, { blenderExecutable: process.env.BLENDER_EXECUTABLE, analysisPythonExecutable: '', timeoutMs: 60000,
    helperTimeoutMs: 60000, maxOutputChars: 20000, restrictToWorkspace: true, enablePython: true,
    enableSharedScene: true, registerSkill: false, registerAgentPresets: false })
  const exec = { agent: { session: { header: { id: randomUUID(), cwd: workspace } } }, signal: new AbortController().signal }
  const run = async (name, args, id = randomUUID()) => {
    const value = await tools.get(name).execute(args, { ...exec, callId: id })
    evidence.push({ name, args, value })
    return value
  }
  try {
    await run('blender_scene', { action:'new' })
    await run('blender_edit', { action:'create', primitive:'sphere', name:'Head', dimensions:[2,1.4,2], color:[.3,.55,.9,1] })
    let value = await run('blender_sculpt', { action:'begin', object_name:'Head', preset:'front', highlight:false })
    value = await run('blender_sculpt', { action:'configure', brush:'grab', radius:.12, strength:.7, symmetry:'' })
    const p = value.view.target.surface_samples[0].point, points=[p,[p[0]+.14,p[1]-.08]]
    const before = { hash:value.geometry_hash, revision:value.revision, brush:value.editor.brush, depth:value.undo_depth }
    value = await run('blender_sculpt', { action:'preview', view_id:value.view.view_id, points })
    assert.equal(value.geometry_hash,before.hash)
    assert.equal(value.revision,before.revision)
    assert.equal(value.undo_depth,before.depth)
    assert.deepEqual(value.editor.brush,before.brush)
    assert.equal(value.preview.start_on_target,true)
    assert.equal(value.feedback.purpose,'aiming_preview')
    assert.equal(tools.get('blender_sculpt').output.render({},value).filter(b=>b.type==='image').length,2)
    value = await run('blender_sculpt', { action:'stroke', view_id:value.view.view_id, points })
    assert.equal(value.effect,'geometry')
    assert.ok(value.displacement.world.max_distance>.1)
    assert.ok(value.displacement.mean_screen_delta[0]>0)
    assert.ok(value.displacement.mean_screen_delta[1]<0)
    assert.equal(value.feedback.purpose,'before_after_detail')
    assert.equal(value.feedback.after_view_id,value.view.view_id)
    assert.ok(tools.get('blender_sculpt').output.render({action:'stroke'},value)[0].text.length<8192)
    assert.ok((await readFile(value.feedback.path)).length>1000)
    const completed=value
    value=await run('blender_sculpt',{action:'undo'})
    assert.equal(value.geometry_hash,before.hash)

    const fields=await run('blender_sculpt',{action:'settings',group:'unified',query:'unprojected'})
    const field=fields.settings.find(f=>f.property==='unprojected_size'||f.property==='unprojected_radius').property
    await run('blender_sculpt',{action:'configure',settings:{unified:{use_unified_size:true,use_locked_size:'SCENE',[field]:.5}}})
    value=await run('blender_view',{projection:'PERSP'})
    const perspectivePoint=value.view.target.surface_samples[0].point
    value=await run('blender_sculpt',{action:'preview',view_id:value.view.view_id,points:[perspectivePoint,perspectivePoint]})
    assert.match(value.preview.brush.footprint,/initial hit depth/)
    assert.ok(value.preview.brush.radius>0 && value.preview.brush.radius<1)
    await run('blender_sculpt',{action:'configure',radius:.12})
    await run('blender_view',{projection:'ORTHO'})

    // A missing feedback image after a committed stroke preserves mutation evidence.
    await run('blender_execute',{script:'import editing_feedback\nediting_feedback.pixels=lambda path: (_ for _ in ()).throw(RuntimeError("test image failure"))',observe:false})
    value=await run('blender_view',{})
    const command={action:'stroke',view_id:value.view.view_id,points}
    const id=randomUUID()
    value=await run('blender_sculpt',command,id)
    assert.equal(value.effect,'geometry')
    assert.match(value.observation_error,/test image failure/)
    const revision=value.revision
    value=await run('blender_sculpt',command,id)
    assert.equal(value.revision,revision)
    await run('blender_execute',{script:'import importlib, editing_feedback\nimportlib.reload(editing_feedback)',observe:false})
    await run('blender_sculpt',{action:'undo'})

    // Image-free edits invalidate old images; GUI-equivalent geometry changes do too.
    value=await run('blender_view',{})
    const old=value.view.view_id
    await run('blender_sculpt',{action:'stroke',view_id:old,points,observe:false})
    await assert.rejects(run('blender_sculpt',{action:'stroke',view_id:old,points}),/Stale view/)
    await run('blender_sculpt',{action:'undo'})
    await run('blender_sculpt',{action:'commit'})

    // Visible occluders are reported; hidden viewport objects stop occluding picks.
    await run('blender_edit',{action:'create',primitive:'cube',name:'Cover',density:'base',dimensions:[3,.2,3],location:[0,-2,0]})
    await run('blender_edit',{action:'select',object_name:'Head'})
    value=await run('blender_view',{preset:'front',frame:true,probe_points:[[.5,.5]],highlight:false})
    assert.equal(value.probes[0].object_name,'Cover')
    await run('blender_edit',{action:'visibility',object_name:'Cover',visible:false})
    await run('blender_edit',{action:'select',object_name:'Head'})
    value=await run('blender_view',{probe_points:[[.5,.5]]})
    assert.equal(value.probes[0].object_name,'Head')
    assert.equal(value.probes[0].target,true)

    // Actual native viewport display is discoverable and independent of render settings.
    const render=value.editor.render
    value=await run('blender_view',{shading:{type:'SOLID',light:'FLAT',show_cavity:false,show_shadows:false}})
    assert.equal(value.view.shading.light,'FLAT')
    assert.deepEqual(value.editor.render,render)

    // A base plane retains its four vertices and supports selected-face extrusion.
    value=await run('blender_edit',{action:'create',primitive:'plane',name:'Surface',density:'base',location:[4,0,0]})
    assert.equal(value.vertices,4)
    value=await run('blender_edit',{action:'mesh_select',selection_mode:'FACE',selection_action:'all'})
    assert.equal(value.mode,'EDIT')
    assert.equal(value.selection.faces,1)
    value=await run('blender_edit',{action:'mesh_extrude',translation:[0,0,1]})
    assert.equal(value.mode,'EDIT')
    assert.equal(value.vertices,8)
    assert.equal(value.faces,6)
    const extruded=value.geometry_hash
    value=await run('blender_edit',{action:'undo'})
    assert.equal(value.vertices,4)
    value=await run('blender_edit',{action:'redo'})
    assert.equal(value.geometry_hash,extruded)

    // Visible box selection and proportional deformation keep the scene and selection.
    await run('blender_edit',{action:'select',object_name:'Head'})
    value=await run('blender_view',{preset:'front',frame:true})
    const b=value.view.target.screen_bounds
    const box=[.48,Math.max(0,b[1]+.02),.52,Math.max(0,b[1]+.07)]
    value=await run('blender_edit',{action:'mesh_select',view_id:value.view.view_id,selection_mode:'VERT',selection_box:box,select_through:true})
    assert.ok(value.selection.vertices>0 && value.selection.vertices<value.vertices)
    const xrayCount=value.selection.vertices
    value=await run('blender_edit',{action:'mesh_select',view_id:value.view.view_id,selection_mode:'VERT',selection_box:box,select_through:false})
    assert.ok(value.selection.vertices>0 && value.selection.vertices<xrayCount)
    const hash=value.geometry_hash
    value=await run('blender_edit',{action:'mesh_transform',translation:[.25,0,.15],proportional_radius:.6,falloff:'SMOOTH'})
    assert.notEqual(value.geometry_hash,hash)
    assert.ok(value.displacement.moved_vertices>value.selection.vertices)
    assert.equal(value.feedback.purpose,'before_after_detail')
    assert.equal(value.mode,'EDIT')
    assert.ok(value.selection.vertices>0)
    await run('blender_scene',{action:'save',save_path:'edited.blend'})
    console.log(JSON.stringify({workspace,comparison:completed.feedback.path,after:completed.view.path}))
  } finally {
    await writeFile(join(workspace,'evidence.json'),JSON.stringify(evidence,null,2))
    for (const dispose of disposers) await dispose()
    console.log('Editing feedback evidence: '+workspace)
  }
})
