import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

test('native sculpt: four brushes, fresh images, history, retry, commit and discard', {
  skip: process.env.RUN_SCULPT_TESTS !== '1', timeout: 180000,
}, async (t) => {
  const workspace = await mkdtemp(join(process.env.SCULPT_TEST_OUTPUT ?? tmpdir(), 'dsh-native-sculpt-'))
  const tools = new Map()
  let cleanup
  apply({
    tools: { register(tool) { tools.set(tool.name, tool) } },
    skills: { register() {} },
    effect(fn) { cleanup = fn() },
    get(name) {
      if (name === 'attachments') return { async saveImage({ data, mediaType, name: filename }) {
        return { attachmentId: randomUUID(), mediaType, name: filename, bytes: data.length,
          width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
      } }
    },
  }, {
    blenderExecutable: process.env.BLENDER_EXECUTABLE ?? 'blender', analysisPythonExecutable: '',
    timeoutMs: 60000, helperTimeoutMs: 60000, maxOutputChars: 20000, restrictToWorkspace: true,
    enablePython: true, enableHelpers: true, registerSkill: false,
  })
  const exec = { agent: { session: { header: { id: randomUUID(), cwd: workspace } } }, signal: new AbortController().signal }
  const evidence = []
  async function run(name, args) {
    const value = await tools.get(name).execute(args, { ...exec, callId: randomUUID() })
    evidence.push({ tool: name, args, value })
    return value
  }
  try {
    await run('blender_python', { save_path: 'sphere.blend', script: [
      "bpy.ops.object.select_all(action='SELECT')", 'bpy.ops.object.delete(use_global=False)',
      'bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48)',
      "bpy.context.object.name='SculptSphere'", 'bpy.context.object.location=(1,-2,.5)',
      'bpy.context.object.scale=(1.2,.8,1)', 'bpy.ops.object.shade_smooth()',
    ].join('\n') })
    const sourceHash = createHash('sha256').update(await readFile(join(workspace, 'sphere.blend'))).digest('hex')
    let value = await run('blender_sculpt', { action: 'begin', blend_path: 'sphere.blend', object_name: 'SculptSphere' })
    const { edit_id: editId, geometry_hash: base, pid } = value
    const baseImage = await readFile(value.view.path)
    assert.equal(tools.get('blender_sculpt').output.render({}, value)[1].type, 'image')
    value = await run('blender_sculpt', { action: 'stroke', edit_id: editId, brush: 'draw',
      view_id: value.view.view_id, points: [[0.5, 0.5], [0.51, 0.5], [0.53, 0.5]], radius: 0.1, strength: 0.6 })
    assert.equal(value.changed, true)
    assert.notDeepEqual(await readFile(value.view.path), baseImage, 'stroke image reflects changed geometry')
    const first = value.geometry_hash
    const staleView = value.view.view_id
    const secondRequest = { action: 'stroke', edit_id: editId, brush: 'inflate', view_id: value.view.view_id,
      points: [[0.5, 0.45], [0.52, 0.45]], radius: 0.12, strength: 0.5, request_id: 'second' }
    value = await run('blender_sculpt', secondRequest)
    assert.equal(value.changed, true)
    const second = value.geometry_hash
    assert.equal((await run('blender_sculpt', secondRequest)).revision, value.revision)
    value = await run('blender_view', { edit_id: editId, preset: 'right' })
    const rotation = value.view.rotation
    await assert.rejects(run('blender_sculpt', { action: 'stroke', edit_id: editId, brush: 'draw',
      view_id: staleView, points: [[0.5, 0.5], [0.51, 0.5]] }), /Stale/u)
    for (const [action, hash] of [['undo', first], ['undo', base], ['redo', first], ['redo', second]]) {
      value = await run('blender_sculpt', { action, edit_id: editId })
      assert.equal(value.geometry_hash, hash)
      assert.deepEqual(value.view.rotation, rotation, 'history preserves the current viewpoint')
    }
    for (const brush of ['grab', 'smooth']) {
      value = await run('blender_sculpt', { action: 'stroke', edit_id: editId, brush,
        view_id: value.view.view_id, points: [[0.5, 0.5], [0.55, 0.5], [0.6, 0.5]], radius: 0.2, strength: 0.8 })
      assert.equal(value.changed, true)
      assert.equal(value.vertices, 4514)
    }
    assert.equal(value.pid, pid)
    const finalHash = value.geometry_hash
    await assert.rejects(run('blender_scene_info', { blend_path: 'sphere.blend' }), /Editing session/u)
    await assert.rejects(tools.get('blender_sculpt').execute({ action: 'status', edit_id: editId }, {
      ...exec, agent: { session: { header: { id: randomUUID(), cwd: workspace } } },
    }), /belongs/u)
    await run('blender_sculpt', { action: 'commit', edit_id: editId, save_path: 'sculpted.blend' })
    const info = await run('blender_python', { blend_path: 'sculpted.blend', save_path: 'verified.blend', script: [
      'from array import array', 'import hashlib', "o=bpy.data.objects['SculptSphere']",
      "a=array('f',[0.0])*(len(o.data.vertices)*3)", "o.data.vertices.foreach_get('co',a)",
      "dsh_result={'hash':hashlib.sha256(a.tobytes()).hexdigest()}",
    ].join('\n') })
    assert.equal(info.scriptResult.hash, finalHash)
    value = await run('blender_sculpt', { action: 'begin', blend_path: 'sphere.blend', object_name: 'SculptSphere' })
    await run('blender_sculpt', { action: 'discard', edit_id: value.edit_id })
    assert.equal(createHash('sha256').update(await readFile(join(workspace, 'sphere.blend'))).digest('hex'), sourceHash)
    await writeFile(join(workspace, 'verification.json'), JSON.stringify({ passed: true, workspace, evidence }, null, 2))
    t.diagnostic(`Native evidence: ${workspace}`)
  } finally { await cleanup?.() }
})
