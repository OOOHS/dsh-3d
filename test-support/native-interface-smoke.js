import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [hostArg, evidenceArg] = process.argv.slice(2)
const directory = resolve(evidenceArg)
await mkdir(directory, { recursive: true })
Object.assign(process.env, { DSH_HOME: join(directory, 'home'), DSH_AGENTS_HOME: join(directory, 'agents'), DSH_TELEMETRY_DISABLED: '1' })
const require = createRequire(join(resolve(hostArg), 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
const { default: PresetRegistry } = await load('@deepseek-ai/dsh-agent-preset-registry')
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm')
const { defineTool } = await load('@deepseek-ai/dsh-tools')
const { apply } = await import('../index.js')
const { presetDefinitions, NATIVE_MODELER_PRESET, MODELER_PRESET } = await import('../lib/agent-config.js')
const { NATIVE_TOOLS } = await import('../lib/native-modeling.js')
const patch = join(directory, 'check.patch.yml')
await writeFile(patch, '- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- id: session-title-llm\n  disabled: true\n')
const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_TELEMETRY_DISABLED: '1' } }])
const { ctx } = await runProfile({ environment, profile: 'headless', patchFiles: [patch], args: [] })
const config = { blenderExecutable: process.env.BLENDER_EXECUTABLE ?? 'blender', analysisPythonExecutable: '', timeoutMs: 60000,
  helperTimeoutMs: 60000, maxOutputChars: 20000, restrictToWorkspace: true, enablePython: true, registerSkill: true, registerAgentPresets: false,
  modelerAgent: { provider: 'native-guard-check', model: 'builder' } }
let requestTools
class Adapter extends LlmAdapter {
  providerInfo(id) { return { id, name: 'Native interface check' } }
  async resolveModel(provider, id) { return { provider, id, name: id, inputModalities: ['text', 'image'], contextWindow: 1000000,
    defaultMaxTokens: 65536, reasoning: { efforts: [{ id: 'high', name: 'High' }] } } }
  async *stream(options) {
    requestTools = options.tools.map(t => t.name)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Native interface ready.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
let native, mixed
try {
  apply(ctx, config)
  ctx.llm.registerAdapter(['native-guard-check'], new Adapter())
  const fiber = ctx.plugin(PresetRegistry, { default: MODELER_PRESET })
  await fiber.inertia
  for (const definition of presetDefinitions(config)) {
    definition.plugins.at(-1).name = new URL('../lib/agent-role.js', import.meta.url).href
    await ctx.agentPresets.register(definition)
  }
  native = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: directory },
    setup: c => ctx.agentPresets.mount(c, NATIVE_MODELER_PRESET).then(() => {}) })
  mixed = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: directory },
    setup: c => ctx.agentPresets.mount(c, MODELER_PRESET).then(() => {}) })
  const names = ctx.tools.schemas(native.agent).map(t => t.name)
  assert.ok(ctx.tools.schemas(native.agent).filter(t => ['blender_scene', 'blender_sculpt'].includes(t.name)).every(t => !/Python|project tools|references\//u.test(t.description)))
  assert.ok(names.includes('blender_edit'))
  assert.ok(names.includes('blender_sculpt'))
  assert.ok(names.includes('inspect_image'))
  assert.ok(names.every(n => NATIVE_TOOLS.includes(n)), 'Unexpected native capability: ' + names)
  const mixedNames = ctx.tools.schemas(mixed.agent).map(t => t.name)
  assert.ok(mixedNames.includes('blender_execute'))
  assert.ok(mixedNames.includes('bash'))
  const denied = []
  for (const [name, args] of [['blender_execute', { script: 'raise RuntimeError("escape")' }], ['bash', { command: 'touch SHOULD_NOT_EXIST' }],
    ['write', { path: join(directory, 'SHOULD_NOT_EXIST'), content: 'escape' }], ['skill', { name: 'create-3d-model' }]]) {
    const result = await ctx.tools.execute({ callId: randomUUID(), name, arguments: args, agent: native.agent, signal: new AbortController().signal })
    assert.equal(result.isError, true, name + ' must be rejected by dispatch')
    denied.push({ name, denied: true })
  }
  const ordinary = await ctx.tools.execute({ callId: randomUUID(), name: 'blender_scene', arguments: { action: 'status' }, agent: mixed.agent, signal: new AbortController().signal })
  assert.equal(ordinary.isError, false)
  // A native UI capability may finish loading after the role mounts.
  if (!ctx.tools.get('present')) ctx.tools.register(defineTool({ name: 'present', description: 'Local late-registration check.', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: async () => ({}) }))
  native.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check the available native interface.' }], source: { kind: 'user' } }))
  await native.agent.whenIdle()
  assert.ok(requestTools.includes('present'), 'Late capability missing: ' + JSON.stringify({ requestTools, visible: ctx.tools.schemas(native.agent).map(t => t.name), globals: ctx.tools.schemas().map(t => t.name) }))
  assert.ok(requestTools.every(name => NATIVE_TOOLS.includes(name)))
  const report = { passed: true, nativePreset: NATIVE_MODELER_PRESET, nativeTools: names.sort(), mixedTools: mixedNames.sort(),
    requestTools, lateCapabilityRefresh: true, denied, isolatedPerAgent: true, modelApiCalls: 0 }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await native?.dispose(); await mixed?.dispose(); await ctx.fiber.dispose() }
