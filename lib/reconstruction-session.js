import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

const SOURCE = 'dsh-3d-reconstruction'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const copy = (value) => JSON.parse(JSON.stringify(value))
const humanSequence = (agent) => {
  const events = agent.session.snapshotEvents?.() ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'user/message' && events[i].data.source?.kind === 'user') return events[i].seq ?? i
  }
  return -1
}

/** Plugin-owned task state; continuation uses only the public stop-boundary hook. */
export class ReconstructionSessions {
  constructor(ctx, config, paths, sculpt) {
    this.config = config
    this.paths = paths
    this.sculpt = sculpt
    this.states = new Map()
    this.disposed = false
    ctx.on?.('agent/turn-stopping', (event) => this.stopping(event))
    ctx.on?.('agent/disposed', ({ agent }) => this.states.delete(agent.session.header.id))
    ctx.on?.('session/event', (session, event) => {
      if (event.type === 'turn/start') {
        const state = this.states.get(session.header.id)
        if (state) { state.phase = 'paused'; state.reason = 'new-turn' }
      }
      if (event.type === 'turn/end' && event.data.reason?.kind !== 'completed') {
        const state = this.states.get(session.header.id)
        if (state) { state.phase = 'paused'; state.reason = event.data.reason.kind }
      }
    })
    ctx.effect?.(() => () => { this.disposed = true; this.states.clear() })
  }

  state(agent) {
    const id = agent.session.header.id
    if (!this.states.has(id)) {
      // Context sources survive resume/fork with the ordinary session log.
      // Restored work stays paused until an explicit begin/review call.
      const events = agent.session.snapshotEvents?.() ?? []
      for (let i = events.length - 1; i >= 0; i--) {
        const source = events[i].type === 'user/message' ? events[i].data.source : undefined
        const previous = source?.kind === SOURCE ? source.state : undefined
        if (previous?.version === 1 && previous.session_id === id && (previous.reference?.path || previous.sculpted)) {
          this.states.set(id, { ...copy(previous), phase: 'paused', reason: 'session-resumed',
            resume_after: previous.human_sequence ?? -1 })
          break
        }
      }
    }
    return this.states.get(id)
  }

  message(state, text) {
    return { id: randomUUID(), role: 'user', content: [{ type: 'text', text }],
      source: { kind: SOURCE, form: 'notice', summary: `3D reconstruction: ${state.phase}`,
        state: copy(state) } }
  }

  announce(state, exec, text) {
    exec.deferContext?.(this.message(state, text ?? this.describe(state)))
  }

  describe(state) {
    return `Modeling state: ${state.phase}. Reference: ${JSON.stringify(state.reference?.path ?? 'text-described model')}.\n` +
      (state.checkpoint ? `Current editable scene: ${JSON.stringify(state.checkpoint)}. Continue scene edits from this checkpoint and preserve its local changes.\n` : '') +
      (state.sculpted ? 'This scene includes native brush edits. Continue Python edits with blend_path set to the current scene.\n' : '') +
      (state.reason ? `Status detail: ${state.reason}.\n` : '') +
      (state.review ? `Latest independent review: ${state.review.report_path}; approved=${state.review.approved}. ${state.review.summary}\n` : '')
  }

  async begin(args, exec) {
    const path = await this.paths.resolve(args.reference_path, exec, this.config, { mustExist: true, kind: 'reference_path' })
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extname(path).toLowerCase())) throw new Error('Reference must be PNG, JPEG or WebP.')
    const info = await stat(path)
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Reference must be an image file of at most 20 MiB.')
    const sha256 = hash(await readFile(path, { signal: exec.signal }))
    const previous = this.state(exec.agent)
    if (previous?.phase === 'paused' && previous.resume_after !== undefined && humanSequence(exec.agent) <= previous.resume_after) {
      throw new Error(`Reconstruction is paused (${previous.reason}). A direct user continuation resumes this task.`)
    }
    if (previous?.reference && previous.reference.sha256 !== sha256 && humanSequence(exec.agent) <= (previous.human_sequence ?? -1)) {
      throw new Error(`The current task uses ${previous.reference.path}. A direct user reference change starts a new reconstruction.`)
    }
    let state
    if (previous?.reference?.sha256 === sha256) {
      state = copy(previous)
      state.reference.path = path
      if (state.phase === 'paused') state.started_at = Date.now()
      state.phase = 'active'
      delete state.reason
    } else {
      state = { version: 1, run_id: randomUUID(), session_id: exec.agent.session.header.id,
        phase: 'active', reference: { path, sha256 }, started_at: Date.now(), continuations: 0 }
    }
    if (args.blend_path) {
      const checkpoint = await this.paths.resolve(args.blend_path, exec, this.config, { mustExist: true, kind: 'blend_path' })
      if (extname(checkpoint).toLowerCase() !== '.blend' || !(await stat(checkpoint)).isFile()) throw new Error('blend_path must identify a .blend file.')
      if (state.sculpted && checkpoint !== state.checkpoint) throw new Error(`Continue from the brush-edited scene: ${state.checkpoint}`)
      state.checkpoint = checkpoint
    }
    state.human_sequence = humanSequence(exec.agent)
    delete state.resume_after
    this.states.set(state.session_id, state)
    this.announce(state, exec)
    return { status: state.phase, reconstruction: copy(state), continuation_enabled: this.config.continueUntilApproved !== false }
  }

  async prepareReview(args, exec) {
    if (this.sculpt?.sessions.get(exec.agent.session.header.id)) throw new Error('Commit or discard the active sculpt session before reviewing the saved scene.')
    let state = this.state(exec.agent)
    if (!state?.reference || state.phase === 'paused') {
      await this.begin(args, exec)
      state = this.state(exec.agent)
    }
    const reference = await this.paths.resolve(args.reference_path, exec, this.config, { mustExist: true, kind: 'reference_path' })
    if (reference !== state.reference.path || hash(await readFile(reference, { signal: exec.signal })) !== state.reference.sha256) {
      throw new Error('The registered reference changed. Begin a reconstruction with the intended reference before reviewing.')
    }
    if (!args.blend_path) throw new Error('Review requires blend_path for the current editable scene.')
    const candidate = await this.paths.resolve(args.blend_path, exec, this.config, { mustExist: true, kind: 'blend_path' })
    if (state.sculpted && candidate !== state.checkpoint) throw new Error(`Review the current brush-edited scene: ${state.checkpoint}`)
    state.checkpoint = candidate
    state.phase = 'active'
    return state
  }

  reviewed(report, exec) {
    const state = this.state(exec.agent)
    if (!state) return
    state.review = { review_id: report.review_id, report_path: report.report_path,
      approved: report.approved === true && !!report.artifact, status: report.status,
      summary: report.summary ?? report.error ?? '',
      files: report.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
      ...(report.artifact ? { artifact: report.artifact } : {}) }
    if (report.status === 'error') {
      state.phase = 'paused'; state.reason = 'review-error'; state.resume_after = humanSequence(exec.agent)
    }
    else { state.phase = state.review.approved ? 'approved' : 'active'; delete state.reason }
    this.announce(state, exec)
  }

  async fresh(state, exec) {
    if (state.phase !== 'approved' || !state.review?.artifact) return false
    if (state.checkpoint !== state.review.artifact.path) {
      state.phase = 'active'; state.reason = 'current-scene-needs-review'; return false
    }
    try {
      for (const file of [...state.review.files, state.review.artifact]) {
        const path = await this.paths.resolve(file.path, exec, this.config, { mustExist: true, kind: 'review evidence' })
        const info = await stat(path)
        if (!info.isFile() || info.size !== file.bytes || hash(await readFile(path, { signal: exec.signal })) !== file.sha256) {
          state.phase = 'active'; state.reason = 'reviewed-artifacts-changed'; return false
        }
      }
      return true
    } catch (error) {
      if (exec.signal?.aborted) throw error
      state.phase = 'active'; state.reason = 'reviewed-artifacts-unavailable'; return false
    }
  }

  async status(exec) {
    const state = this.state(exec.agent)
    if (!state) return { status: 'inactive', continuation_enabled: this.config.continueUntilApproved !== false }
    await this.fresh(state, exec)
    return { status: state.phase, reconstruction: copy(state), continuation_enabled: this.config.continueUntilApproved !== false }
  }

  async before(name, args, exec) {
    const state = this.state(exec.agent)
    if (!state?.sculpted || state.phase === 'paused' || !['blender_python', 'blender_sculpt', 'blender_helper_run'].includes(name)) return
    if (name === 'blender_sculpt' && args.action !== 'begin') return
    if (name === 'blender_helper_run' && !args.blend_path) return
    const input = args.blend_path ? await this.paths.resolve(args.blend_path, exec, this.config, { mustExist: true, kind: 'blend_path' }) : undefined
    if (input !== state.checkpoint) throw new Error(`Continue from ${state.checkpoint}. Set blend_path to this scene to preserve its native brush edits.`)
  }

  changed(name, args, result, exec) {
    const sculptCommit = name === 'blender_sculpt' && args.action === 'commit'
    let state = this.state(exec.agent)
    if (!state && sculptCommit) {
      state = { version: 1, run_id: randomUUID(), session_id: exec.agent.session.header.id,
        phase: 'editing', reference: null, started_at: Date.now(), continuations: 0 }
      this.states.set(state.session_id, state)
    }
    if (!state) return
    if (name === 'blender_status' && result.available === false && state.phase === 'active') {
      state.phase = 'paused'; state.reason = 'blender-unavailable'; state.resume_after = humanSequence(exec.agent)
      this.announce(state, exec)
      return
    }
    const checkpoint = sculptCommit ? result.saved_path : ['blender_python', 'blender_import', 'blender_helper_run'].includes(name) ? result.blendPath : undefined
    if (!checkpoint) return
    state.checkpoint = checkpoint
    if (sculptCommit) state.sculpted = true
    if (sculptCommit && state.phase === 'paused') state.phase = 'editing'
    else if (state.phase !== 'paused' && state.phase !== 'editing') state.phase = state.reference ? 'active' : 'editing'
    state.reason = 'scene-updated'
    this.announce(state, exec)
  }

  async stopping({ agent, signal }) {
    if (this.disposed || signal.aborted || this.config.continueUntilApproved === false) return
    const state = this.state(agent)
    if (!state || state.phase === 'paused' || state.phase === 'editing') return
    // Give queued human work the next ordinary turn and retain an incomplete task.
    if (agent.inbox?.nextTurn?.some((message) => message.source?.kind === 'user')) {
      state.phase = 'paused'; state.reason = 'human-followup'; return
    }
    const latest = agent.session.snapshotEvents?.().filter((event) => event.type === 'assistant/message').at(-1)
    const finish = latest?.data.stream?.filter((item) => item.chunk?.type === 'finish').at(-1)?.chunk.reason
    if (finish?.kind === 'max-tokens') { state.phase = 'paused'; state.reason = 'max-tokens'; return }
    const budget = this.config.reviewContinuationBudgetMs ?? 0
    if (budget > 0 && Date.now() - state.started_at >= budget) {
      state.phase = 'paused'; state.reason = 'continuation-budget'
      state.resume_after = humanSequence(agent)
      agent.steer(this.message(state, this.describe(state) + 'The configured continuation time budget has ended. Save progress and report the remaining work as incomplete.'))
      return
    }
    const editing = this.sculpt?.sessions.get(state.session_id)
    if (!editing && await this.fresh(state, { agent, signal })) return
    if (signal.aborted || this.disposed) return
    if (agent.inbox?.nextTurn?.some((message) => message.source?.kind === 'user')) {
      state.phase = 'paused'; state.reason = 'human-followup'; return
    }
    state.continuations++
    const text = this.describe(state) + (editing
      ? 'Finish the active brush edit with commit or discard, then inspect the saved scene and obtain independent review.'
      : 'This reconstruction remains active. Continue improving the current scene using the review feedback, inspect the result and submit the current artifacts for independent review. Choose the most effective native Blender method; brush shaping can help when repeated scripted adjustments stall. Preserve the reference\'s observed asymmetry and local changes.')
    agent.steer(this.message(state, text))
  }
}
