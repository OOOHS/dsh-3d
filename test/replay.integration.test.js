import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'
import { renderScene } from '../lib/scene-session.js'

test('code replay: native creation, projected brush strokes, explicit image feedback and revised recipe', {
  skip: process.env.RUN_SCENE_TESTS !== '1', timeout: 240000,
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-code-replay-'))
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
  const run = async (name, args) => {
    const value = await tools.get(name).execute(args, { ...exec, callId: randomUUID() })
    evidence.push({ name, args, value }); return value
  }
  const recipe = `
dsh.edit('create', primitive='sphere', name='Volume', density='medium')
dsh.sculpt('begin', object_name='Volume', preset='front')
dsh.sculpt('configure', brush='draw', symmetry='')
location = dsh.project([[0, -1, 0]], object_name='Volume')[0]
assert location['in_view'] and location['hit']['hit'], location
p=location['point']
stroke=dsh.sculpt('stroke', points=[p,p,p], radius=.15, strength=params['strength'])
dsh.emit(stroke)
dsh.sculpt('commit')
dsh.edit('transform', object_name='Volume', location=[.2,0,0], relative=True)
dsh_result={'changed':stroke['changed'], 'geometry':[list(v.co) for v in bpy.data.objects['Volume'].data.vertices], 'location':list(bpy.data.objects['Volume'].location)}
`
  try {
    const values=[]
    for (const strength of [.6,.6,.3]) {
      await run('blender_scene', { action:'new' })
      const value=await run('blender_execute', { script:recipe, params:{strength}, observe:false })
      assert.equal(value.script_result.changed,true)
      assert.equal(value.emitted_images.length,2)
      assert.ok(value.emitted_images.every(v=>v.attachment?.attachmentId))
      const detail=value.emitted_images[1]
      const before=await readFile(join(dirname(detail.path),'view-'+detail.before_view_id+'.png'))
      const after=await readFile(join(dirname(detail.path),'view-'+detail.after_view_id+'.png'))
      assert.notDeepEqual(before,after,'Synchronous brush feedback shows the updated geometry')
      const content=renderScene({},value)
      assert.equal(content.filter(v=>v.type==='image').length,2)
      assert.ok(Math.abs(value.script_result.location[0]-.2)<1e-6)
      values.push(value.script_result.geometry)
    }
    const maxDelta=(a,b)=>Math.max(...a.flatMap((p,i)=>p.map((v,j)=>Math.abs(v-b[i][j]))))
    assert.ok(maxDelta(values[0],values[1])<1e-6, 'Same recipe reproduces sculpt geometry')
    assert.ok(maxDelta(values[0],values[2])>1e-4, 'Changing brush strength changes replayed geometry')
    await run('blender_scene',{action:'save',save_path:'model.blend'})
    await assert.rejects(run('blender_scene',{action:'save',save_path:'model.blend'}),/already exists/)
    await run('blender_scene',{action:'save',save_path:'model.blend',allow_overwrite:true})
    await assert.rejects(run('blender_execute', {script:"dsh.emit(dsh.view())\nbpy.data.objects['Volume'].location.x=99\nraise ValueError('replay rollback')",observe:false}), /scene restored/)
    const clean=await run('blender_execute',{script:"dsh_result=list(bpy.data.objects['Volume'].location)",observe:false})
    assert.deepEqual(clean.emitted_images,[])
    assert.ok(Math.abs(clean.script_result[0]-.2)<1e-6)
    await assert.rejects(run('blender_execute',{script:"dsh.project([[0,0,0]],object_name='Missing')",observe:false}),/Object not found/)
    const renders=await run('blender_execute',{observe:false,script:`
dsh.edit('camera', name='Camera', preset='front', ortho_scale=4)
dsh.edit('environment', engine='BLENDER_WORKBENCH')
dsh.emit(dsh.render(output_path='repeat.png', width=64, height=64, samples=4))
bpy.data.objects['Volume'].location.x += 1
dsh.emit(dsh.render(output_path='repeat.png', width=64, height=64, samples=4))
`})
    assert.notEqual(renders.emitted_images[0].path,renders.emitted_images[1].path)
    assert.notDeepEqual(await readFile(renders.emitted_images[0].path),await readFile(renders.emitted_images[1].path), 'Emitting a reused render path preserves both observations')
  } finally {
    await writeFile(join(workspace,'evidence.json'),JSON.stringify(evidence,null,2))
    for (const dispose of disposers) await dispose()
    console.log('Replay evidence: '+workspace)
  }
})
