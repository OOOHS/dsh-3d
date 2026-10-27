import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('shared brush lifecycle: implicit binding, mode exit and discard boundaries', {
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
    await run('blender_edit',{action:'create',primitive:'sphere',name:'Volume',density:'medium'})
    let v=await run('blender_sculpt',{action:'begin',object_name:'Volume',isolate:true})
    const original=v.geometry_hash
    const p=v.view.target.surface_samples[0].point
    v=await run('blender_sculpt',{action:'stroke',view_id:v.view.view_id,points:[p,p,p],brush:'draw',radius:.15,strength:.6})
    const changed=v.geometry_hash
    assert.notEqual(changed,original)
    await run('blender_scene',{action:'configure',mode:'OBJECT'})
    v=await run('blender_sculpt',{action:'discard'})
    assert.equal(v.geometry_hash,changed)
    assert.equal(v.editor.mode,'OBJECT')
    v=await run('blender_sculpt',{action:'begin',object_name:'Volume'})
    const q=v.view.target.surface_samples[0].point
    v=await run('blender_sculpt',{action:'stroke',view_id:v.view.view_id,points:[q,q,q],brush:'draw',radius:.15,strength:.6})
    assert.notEqual(v.geometry_hash,changed)
    v=await run('blender_sculpt',{action:'discard',edit_id:v.view.view_id})
    assert.equal(v.geometry_hash,changed)
    await run('blender_sculpt',{action:'begin',object_name:'Volume',isolate:true})
    await run('blender_edit',{action:'delete',object_name:'Volume'})
    await run('blender_sculpt',{action:'discard'})
    v=await run('blender_scene',{action:'inspect'})
    assert.equal(v.object_count,0)
    await run('blender_edit',{action:'create',primitive:'cube',name:'Next'})
    v=await run('blender_sculpt',{action:'begin',object_name:'Next'})
    assert.equal(v.editor.active_object,'Next')
    await run('blender_sculpt',{action:'commit'})
  } finally { for(const dispose of disposers.reverse()) await dispose() }
})
