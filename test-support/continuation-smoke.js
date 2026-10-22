import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [hostArg, evidenceArg] = process.argv.slice(2)
assert.ok(hostArg, 'Usage: node test-support/continuation-smoke.js <dsh-host-directory> [evidence-directory]')
const directory = resolve(evidenceArg ?? await mkdtemp(join(tmpdir(), 'dsh-continuation-')))
await mkdir(directory, { recursive: true })
Object.assign(process.env, { DSH_HOME: join(directory, 'home'), DSH_AGENTS_HOME: join(directory, 'agents'), DSH_TELEMETRY_DISABLED: '1' })
const require = createRequire(join(resolve(hostArg), 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm')
const { defineTool } = await load('@deepseek-ai/dsh-tools')
const { apply } = await import('../index.js')
const { apply: applyRole } = await import('../lib/agent-role.js')
const patch = join(directory, 'check.patch.yml')
await writeFile(patch, '- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- id: session-title-llm\n  disabled: true\n')
const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_TELEMETRY_DISABLED: '1' } }])
const { ctx } = await runProfile({ environment, profile: 'headless', patchFiles: [patch], args: [] })
const steps = new Map(), reviews = new Map()
const text = function* (value) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: value } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const call = function* (name, args) {
  const id = randomUUID(), json = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
class Adapter extends LlmAdapter {
  providerInfo(id) { return { id, name: 'Continuation regression check' } }
  async resolveModel(provider, id) { return { provider, id, name: id, inputModalities: ['text', 'image'], contextWindow: 1000000,
    defaultMaxTokens: 8192, reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] } } }
  async *stream(options) {
    const id = options.sessionId, step = (steps.get(id) ?? 0) + 1
    steps.set(id, step)
    assert.ok(step <= 20, 'Continuation loop exceeded its regression budget')
    if (options.model === 'critic') {
      const summary = options.messages[0].content.find(block => block.type === 'text')?.text ?? ''
      const workspace = summary.includes('unused') ? 'unused' : 'productive'
      const count = (reviews.get(workspace) ?? 0) + 1
      reviews.set(workspace, count)
      yield* call('submit_review', { verdict: count > 1 ? 'match' : 'different', summary: count > 1 ? 'Faithful current evidence' : 'Refine the current scene',
        differences: count > 1 ? [] : [{ part: 'shape', severity: 'major', reference_evidence: 'Rounded', render_evidence: 'Angular', suggestion: 'Reshape' }] })
      return
    }
    if (step === 1) { yield* call('review_reconstruction', { action: 'begin', reference_path: 'reference.png', blend_path: 'scene.blend' }); return }
    if (options.model === 'productive') {
      if ([3, 7].includes(step)) yield* call('review_reconstruction', { reference_path: 'reference.png', render_paths: ['front.png'], blend_path: 'scene.blend' })
      else if (step === 5) yield* call('change_scene', {})
      else yield* text(step === 8 ? 'Current evidence approved.' : 'The scene is ready.')
      return
    }
    const notices = options.messages.filter(m => m.role === 'user').flatMap(m => m.content).filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (notices.includes('Automatic continuation is paused')) { yield* text('Checkpoint retained; reconstruction remains incomplete.'); return }
    if (options.model === 'status' && step % 2 === 0) { yield* call('review_reconstruction', { action: 'status' }); return }
    yield* text('无法继续：会话预算耗尽。')
  }
}
const config = { blenderExecutable: 'blender', analysisPythonExecutable: '', timeoutMs: 180000, helperTimeoutMs: 120000, maxOutputChars: 20000,
  restrictToWorkspace: true, enablePython: true, enableSculpt: false, registerSkill: false, registerAgentPresets: false,
  reviewerAgent: { provider: 'continuation-check', model: 'critic' } }
const imageFixtures = {"reference.png": "iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAAvklEQVR4nO3SsREAIAwDscD+O8MK+V6qXf35zLxh5y53iNV4ViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViDW7H15OAGfth2TMAAAAABJRU5ErkJggg==", "front.png": "iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAAvUlEQVR4nO3SsREAIAwDscD+O8MK+V6qXf35vGHrrpeIVXhWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWIFYgViBWINbsfXs2AZ+BpEKpAAAAAElFTkSuQmCC"}
const reports = []
try {
  apply(ctx, config)
  ctx.llm.registerAdapter(['continuation-check'], new Adapter())
  ctx.tools.register(defineTool({ name: 'change_scene', description: 'Apply one real local scene-file revision for the regression.', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args, exec) { await writeFile(join(exec.agent.session.header.cwd, 'scene.blend'), 'revised scene'); return { changed: true } } }))
  for (const model of ['stall', 'status', 'productive']) {
    const cwd = join(directory, model)
    await mkdir(cwd, { recursive: true })
    for (const [file, base64] of Object.entries(imageFixtures)) await writeFile(join(cwd, file), Buffer.from(base64, 'base64'))
    await writeFile(join(cwd, 'scene.blend'), 'scene')
    const handle = await ctx.agents.create({ sessionId: randomUUID(), agentOptions: { provider: 'continuation-check', model }, meta: { cwd },
      setup(agentCtx) { applyRole(agentCtx, { role: 'modeler', provider: 'continuation-check', model, reasoningEffort: 'high', maxTokens: 8192, instructions: 'Local continuation check.' }) } })
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Reconstruct and obtain independent acceptance.' }], source: { kind: 'user' } }))
      await Promise.race([handle.agent.whenIdle(), new Promise((_, reject) => setTimeout(() => reject(Error('Continuation timeout')), 30000).unref())])
      const events = handle.agent.session.snapshotEvents(), notices = events.filter(e => e.type === 'user/message' && e.data.source?.kind === 'dsh-3d-reconstruction')
      const state = notices.at(-1).data.source.state
      const end = events.filter(e => e.type === 'turn/end')
      assert.equal(end.length, 1); assert.equal(end[0].data.reason.kind, 'completed')
      if (model === 'productive') { assert.equal(state.phase, 'approved'); assert.equal(steps.get(handle.agent.session.header.id), 8) }
      else {
        assert.equal(state.phase, 'paused'); assert.equal(state.reason, 'stalled'); assert.ok(steps.get(handle.agent.session.header.id) <= 10)
        assert.equal(notices.filter(e => e.data.source.state.continuation_health?.recovery).length, 1)
      }
      reports.push({ mode: model, steps: steps.get(handle.agent.session.header.id), phase: state.phase, reason: state.reason,
        health: state.continuation_health, toolErrors: events.filter(e => e.type === 'tool/result' && e.data.message.isError).length })
    } finally { await handle.dispose() }
  }
  const report = { passed: true, directory, modelApiCalls: 0, reports }
  await writeFile(join(directory, 'check-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await ctx.fiber.dispose() }
