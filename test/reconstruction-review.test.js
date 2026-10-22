import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createReviewTool, parseReview, REVIEW_SYSTEM } from '../lib/reconstruction-review.js'
import { internals } from '../index.js'

const accepted = { verdict: 'match', summary: '主体与参考一致。', differences: [], limitations: ['隐藏面仅检查连贯性。'] }
const difference = { part: '头发', severity: 'major', reference_evidence: '参考为长发', render_evidence: '结果为短发', suggestion: '延长发型' }

test('approval uses the judgment and visible defects; confidence is optional metadata', () => {
  assert.equal(parseReview(JSON.stringify(accepted)).approved, true)
  for (const patch of [{ verdict: 'different' }, { verdict: 'uncertain' }, { same: false }, { approved: false }, { differences: [difference] }]) {
    assert.equal(parseReview({ ...accepted, ...patch }).approved, false)
  }
  for (const confidence of [undefined, null, 0.2, 2, 'high']) assert.equal(parseReview({ ...accepted, confidence }).approved, true)
  assert.equal(parseReview({ ...accepted, confidence: 2 }).confidence, undefined)
  assert.equal(parseReview({ ...accepted, confidence: 0.2 }).confidence, 0.2)
  for (const value of ['not json', '{}', { ...accepted, approved: 'yes' }, { ...accepted, summary: '' }, { ...accepted, differences: [{}] }]) assert.throws(() => parseReview(value))
})

async function fixture({ mutate, unavailable = false } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-review-'))
  for (const name of ['reference.png', 'front.png', 'side.png', 'model.blend']) await writeFile(join(workspace, name), name)
  const config = { restrictToWorkspace: true, reviewerAgent: { provider: 'critic-provider', model: 'critic-vision' } }
  const exec = { agent: { session: { header: { cwd: workspace, id: randomUUID() } } }, signal: new AbortController().signal }
  const rounds = [], live = new Set()
  const attachments = { async saveImage({ mediaType, name, data }) { return { attachmentId: name, mediaType, width: 1, height: 1, bytes: data.length } } }
  const ctx = { get(name) { return name === 'attachments' ? attachments : name === 'agents' ? ctx.agents : undefined },
    agents: { async create(options) {
      const tools = new Map(), listeners = new Map(), events = [], round = { options, tools, listeners, disposed: false }
      const agentCtx = { tools: { register(tool) { tools.set(tool.name, tool) }, restrict() {}, presentAs() {}, guard() {} },
        systemPrompt: { section(value) { round.prompt = value }, suppressRuntimeContext() {} },
        on(name, callback) { listeners.set(name, callback) }, get: ctx.get }
      const agent = { session: { header: { cwd: workspace }, snapshotEvents: () => events },
        followup(message) { round.message = message }, cancel() {}, async whenIdle() {
          if (unavailable) throw new Error('Service unavailable')
          if (mutate) await mutate(workspace)
          await tools.get('submit_review').execute(accepted, { agent, signal: exec.signal })
        } }
      await options.setup(agentCtx, agent)
      rounds.push(round); live.add(options.sessionId)
      return { agent, async dispose() { round.disposed = true; live.delete(options.sessionId) } }
    } } }
  const tool = createReviewTool(ctx, config, { resolve: internals.resolveWorkspacePath, async writable(path) {
    await assert.rejects(readFile(path), { code: 'ENOENT' })
  } })
  const args = { reference_path: 'reference.png', render_paths: ['front.png', 'side.png'], render_views: ['reference-aligned', 'side'], blend_path: 'model.blend' }
  return { workspace, tool, args, exec, rounds, live }
}

test('each review snapshots evidence, creates a fresh agent and archives then disposes it', async () => {
  const f = await fixture()
  const result = await f.tool.execute(f.args, f.exec)
  assert.equal(result.status, 'reviewed'); assert.equal(result.approved, true)
  assert.equal(result.files.length, 3); assert.match(result.artifact.sha256, /^[a-f0-9]{64}$/u)
  const saved = JSON.parse(await readFile(result.report_path, 'utf8'))
  assert.equal(saved.reviewer_system, REVIEW_SYSTEM)
  assert.equal(await readFile(result.files[0].snapshot_path, 'utf8'), 'reference.png')
  await readFile(result.transcript_path)
  const first = f.rounds[0]
  assert.deepEqual([...first.tools.keys()], ['inspect_image', 'submit_review'])
  assert.equal(first.options.parentAgent, f.exec.agent)
  assert.equal(first.options.agentOptions.reasoningEffort, 'low')
  assert.equal(first.prompt.complete, true)
  assert.equal(first.message.content.filter(block => block.type === 'image').length, 3)
  assert.equal(first.message.source.kind, 'dsh-3d-review')
  const second = await f.tool.execute(f.args, f.exec)
  assert.notEqual(second.agent_session_id, result.agent_session_id)
  assert.equal(f.rounds.length, 2); assert.equal(f.live.size, 0)
  assert.ok(f.rounds.every(round => round.disposed))
})

for (const [label, options] of [
  ['failed agent execution', { unavailable: true }],
  ['artifact changed during review', { mutate: workspace => writeFile(join(workspace, 'model.blend'), 'changed') }],
  ['reference changed during review', { mutate: workspace => writeFile(join(workspace, 'reference.png'), 'changed') }],
]) test(`review remains pending on ${label} and always releases its agent`, async () => {
  const f = await fixture(options)
  const result = await f.tool.execute(f.args, f.exec)
  assert.equal(result.approved, false); assert.equal(result.status, 'unavailable')
  assert.ok(result.error); assert.equal(f.live.size, 0)
  assert.equal(JSON.parse(await readFile(result.report_path, 'utf8')).approved, false)
})

test('input guard rejects traversal, reference masquerading as a render and invalid view lists', async () => {
  const f = await fixture()
  await assert.rejects(f.tool.execute({ ...f.args, reference_path: '../outside.png' }, f.exec), /inside/u)
  await assert.rejects(f.tool.execute({ ...f.args, render_paths: ['reference.png'], render_views: ['front'] }, f.exec), /identical/u)
  await assert.rejects(f.tool.execute({ ...f.args, render_views: ['front'] }, f.exec), /one short label/u)
  await assert.rejects(f.tool.execute({ ...f.args, report_path: '../report.json' }, f.exec), /inside/u)
  assert.equal(f.rounds.length, 0)
})
