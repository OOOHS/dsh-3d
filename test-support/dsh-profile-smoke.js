import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const script = fileURLToPath(import.meta.url)
const profile = 'blender-smoke'

async function runtime(host, reportPath) {
  const require = createRequire(join(host, 'package.json'))
  const load = (name) => import(pathToFileURL(require.resolve(name)).href)
  const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
  const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
  const environment = createLaunchEnvironmentSnapshot([{
    source: 'process', values: { DSH_TELEMETRY_DISABLED: '1' },
  }])
  const { ctx } = await runProfile({ environment, profile, patchFiles: [], args: [] })
  try {
    const tools = ctx.tools.schemas().map((tool) => tool.name).filter((name) => name.startsWith('blender_') || name === 'review_reconstruction')
    assert.equal(tools.length, 5)
    const workspace = await mkdtemp(join(process.env.DSH_HOME, 'workspace-'))
    const skills = (await ctx.skills.list({ cwd: workspace })).filter((skill) => skill.provider === 'dsh-3d')
    assert.equal(skills.length, 1)
    const skill = await ctx.skills.get('create-3d-model', { cwd: workspace })
    assert.match(skill.content, /blender_scene/u)
    const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: workspace } })
    try {
      const executed = []
      const run = async (name, args) => {
        const result = await ctx.tools.execute({
          callId: randomUUID(), name, arguments: args, agent: handle.agent,
          signal: new AbortController().signal,
        })
        assert.equal(result.isError, false, JSON.stringify(result))
        executed.push(name)
        return result.value
      }
      const created = await run('blender_execute', {script: `
bpy.ops.mesh.primitive_cube_add()
bpy.context.object.name='DSH-Smoke-Cube'
bpy.ops.object.camera_add(location=(4,-6,3))
cam=bpy.context.object
cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene.camera=cam
bpy.context.scene.render.engine='BLENDER_WORKBENCH'
dsh_result={'created':'DSH-Smoke-Cube'}
`})
      assert.ok(created.pid)
      const scene = await run('blender_scene', {action:'inspect',object_names:['DSH-Smoke-Cube']})
      assert.equal(scene.objects[0].name,'DSH-Smoke-Cube')
      const preview = await run('blender_view',{kind:'render',output_path:'preview.png',width:160,height:160,samples:4})
      assert.ok(preview.view.attachment)
      await run('blender_scene',{action:'save',save_path:'cube.blend'})
      await run('blender_execute',{script:"bpy.ops.export_scene.gltf(filepath=workspace+'/cube.glb',export_format='GLB')",observe:false})
      assert.ok((await stat(join(workspace,'cube.glb'))).size>0)
      const escaped=await ctx.tools.execute({callId:randomUUID(),name:'blender_execute',arguments:{tool_path:'../escape.py'},agent:handle.agent,signal:new AbortController().signal})
      assert.equal(escaped.isError,true)
      assert.match(escaped.error.message,/must stay inside/u)
      const status=await run('blender_scene',{action:'status'})
      await run('blender_scene',{action:'close'})
      await writeFile(reportPath, JSON.stringify({
        tools: tools.length, skills: skills.length,
        executed, pathGuard: 'passed', blender: status.blender_version,
      }, null, 2) + '\n')
    } finally {
      await handle.dispose()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

async function smoke(host, packageTarget, evidenceRoot) {
  const require = createRequire(join(host, 'package.json'))
  const cli = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  const version = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version
  await mkdir(evidenceRoot, { recursive: true })
  const dir = await mkdtemp(join(evidenceRoot, `dsh-${version}-`))
  const env = {
    ...process.env, DSH_HOME: join(dir, 'home'), DSH_AGENTS_HOME: join(dir, 'agents'),
    DSH_TELEMETRY_DISABLED: '1', npm_config_registry: 'https://registry.npmjs.org',
  }
  const run = async (label, args) => {
    const output = []
    let timer
    const code = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      timer = setTimeout(() => child.kill('SIGTERM'), 300000)
      child.stdout.on('data', (chunk) => output.push(chunk))
      child.stderr.on('data', (chunk) => output.push(chunk))
      child.once('error', rejectPromise)
      child.once('close', resolvePromise)
    }).finally(() => clearTimeout(timer))
    const text = Buffer.concat(output).toString('utf8')
    await writeFile(join(dir, `${label}.log`), text)
    assert.equal(code, 0, `${label} failed; see ${join(dir, `${label}.log`)}\n${text}`)
    return text
  }
  const plugin = (args) => [cli, 'plugin', '--profile', profile, ...args]
  const profileDir = join(env.DSH_HOME, 'profiles', profile)
  const manifest = async () => JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  console.log(`DSH ${version}: evidence ${dir}`)
  await run('install', plugin(['add', packageTarget]))
  assert.ok((await manifest()).dsh.profile.bundles.includes('dsh-3d'))
  const dump = await run('config', [cli, '--profile', profile, '--dump-config'])
  assert.match(dump, /id: dsh-3d/u)
  await run('setup', plugin(['exec', 'dsh-3d-setup']))
  await run('runtime', [script, '--runtime', host, join(dir, 'runtime.json')])
  await run('uninstall', plugin(['remove', 'dsh-3d']))
  const removed = await manifest()
  assert.equal(removed.dsh.profile.bundles.includes('dsh-3d'), false)
  assert.equal(Object.hasOwn(removed.dependencies ?? {}, 'dsh-3d'), false)
  await assert.rejects(stat(join(profileDir, 'node_modules', 'dsh-3d')), { code: 'ENOENT' })
  const cleanDump = await run('config-after-uninstall', [cli, '--profile', profile, '--dump-config'])
  assert.doesNotMatch(cleanDump, /id: dsh-3d/u)
  const report = {
    dsh: version, node: process.version, system: `${process.platform}-${process.arch}`,
    checkedAt: new Date().toISOString(), install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
    runtime: JSON.parse(await readFile(join(dir, 'runtime.json'), 'utf8')),
  }
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[2] === '--runtime') {
  await runtime(resolve(process.argv[3]), resolve(process.argv[4]))
} else {
  const [host, packageTarget, evidenceRoot] = process.argv.slice(2)
  assert.ok(host && packageTarget, 'Usage: pnpm test:dsh <DSH host directory> <package or tarball> [evidence directory]')
  await smoke(resolve(host), packageTarget, resolve(evidenceRoot ?? tmpdir()))
}
