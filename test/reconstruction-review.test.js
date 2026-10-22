import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createReviewTool, parseReview, REVIEW_SYSTEM } from '../lib/reconstruction-review.js'
import { internals } from '../index.js'

const accepted = { verdict: 'match', same: true, approved: true, confidence: 0.9, summary: '主体与参考一致。', differences: [], limitations: ['隐藏面仅检查连贯性。'] }
const difference = { part: '头发', severity: 'major', reference_evidence: '参考为长发', render_evidence: '结果为短发', suggestion: '延长发型' }

test('approval requires a consistent matching verdict, adequate confidence and no major defects', () => {
  assert.equal(parseReview(JSON.stringify(accepted)).approved, true)
  for (const patch of [{ verdict: 'different' }, { verdict: 'uncertain' }, { same: false }, { confidence: 0.6 }, { differences: [difference] }]) {
    assert.equal(parseReview(JSON.stringify({ ...accepted, ...patch })).approved, false)
  }
  for (const value of ['not json', '{}', JSON.stringify({ ...accepted, approved: 'yes' }), JSON.stringify({ ...accepted, confidence: null })]) {
    assert.throws(() => parseReview(value))
  }
})

async function fixture(t, { reply = JSON.stringify(accepted), finish = { kind: 'stop' }, modalities = ['text', 'image'], mutate } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-review-'))
  for (const name of ['reference.png', 'front.png', 'side.png', 'model.blend']) await writeFile(join(workspace, name), name)
  const config = { restrictToWorkspace: true, reviewProvider: 'critic-provider', reviewModel: 'critic-vision' }
  const exec = { agent: { session: { header: { cwd: workspace, id: randomUUID() } } }, signal: new AbortController().signal }
  let request
  const requests = []
  const ctx = { get(name) {
    if (name === 'attachments') return { async saveImage({ mediaType, name: filename, data }) {
      return { attachmentId: filename, mediaType, width: 1, height: 1, bytes: data.length }
    } }
    if (name === 'llm') return { async prepareCall(route, _signal, transform) {
      assert.equal(route.provider, 'critic-provider')
      const config = transform(route, { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } })
      return { config, inputModalities: modalities, async *stream(options) {
        request = options
        requests.push(options)
        if (mutate) await mutate(workspace)
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'finish', reason: finish }
      } }
    } }
  } }
  const tool = createReviewTool(ctx, config, { resolve: internals.resolveWorkspacePath, async writable(path) {
    await assert.rejects(readFile(path), { code: 'ENOENT' })
  } })
  const args = { reference_path: 'reference.png', render_paths: ['front.png', 'side.png'], render_views: ['reference-aligned', 'side'], blend_path: 'model.blend' }
  return { workspace, tool, args, exec, request: () => request, requests }
}

test('a fresh image-only context produces a hashed, durable approval report', async (t) => {
  const f = await fixture(t)
  const result = await f.tool.execute(f.args, f.exec)
  assert.equal(result.status, 'reviewed')
  assert.equal(result.same, true)
  assert.equal(result.approved, true)
  assert.equal(result.files.length, 3)
  assert.match(result.artifact.sha256, /^[a-f0-9]{64}$/u)
  const saved = JSON.parse(await readFile(result.report_path, 'utf8'))
  assert.deepEqual(saved.reviewer_system, REVIEW_SYSTEM)
  assert.equal(JSON.parse(saved.reviewer_raw_response).approved, true)
  const request = f.request()
  assert.equal(request.messages.length, 1)
  assert.equal(request.messages[0].role, 'user')
  assert.equal(request.messages[0].content.filter((x) => x.type === 'image').length, 3)
  assert.equal(request.tools, undefined)
  assert.equal(request.system, REVIEW_SYSTEM)
  assert.equal(request.reasoningEffort, 'low')
  assert.equal(result.route.reasoningEffort, 'low')
  const second = await f.tool.execute(f.args, f.exec)
  assert.notEqual(second.review_id, result.review_id)
  assert.equal(f.requests.length, 2)
  assert.notEqual(f.requests[1].messages, request.messages)
  assert.deepEqual(f.requests[1].messages, request.messages)
  assert.equal(f.requests[1].messages.length, 1)
})

for (const [label, options] of [
  ['malformed response', { reply: 'I approve!' }],
  ['truncated response', { finish: { kind: 'max-tokens' } }],
  ['failed model call', { finish: { kind: 'error', failure: { message: 'Service unavailable' } } }],
  ['text-only reviewer', { modalities: ['text'] }],
  ['artifact changed during review', { mutate: (workspace) => writeFile(join(workspace, 'model.blend'), 'changed') }],
]) test(`review fails closed on ${label}`, async (t) => {
  const f = await fixture(t, options)
  const result = await f.tool.execute(f.args, f.exec)
  assert.equal(result.approved, false)
  assert.equal(result.same, false)
  assert.equal(result.status, 'error')
  assert.ok(result.error)
  assert.equal(JSON.parse(await readFile(result.report_path, 'utf8')).approved, false)
})

test('input guard rejects traversal, reference masquerading as a render and invalid view lists', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.tool.execute({ ...f.args, reference_path: '../outside.png' }, f.exec), /inside/u)
  await assert.rejects(f.tool.execute({ ...f.args, render_paths: ['reference.png'], render_views: ['front'] }, f.exec), /identical/u)
  await assert.rejects(f.tool.execute({ ...f.args, render_views: ['front'] }, f.exec), /one short label/u)
  await assert.rejects(f.tool.execute({ ...f.args, report_path: '../report.json' }, f.exec), /inside/u)
})
