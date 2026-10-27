import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { ContinuationGuard } from './continuation-guard.js'

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
    this.ctx = ctx
    this.paths = paths
    this.sculpt = sculpt
    this.states = new Map()
    this.disposed = false
    this.guard = new ContinuationGuard()
    this.recoveryAbort = new AbortController()
    ctx.on?.('agent/turn-stopping', (event) => this.stopping(event))
    ctx.on?.('agent/disposed', ({ agent }) => {
      this.states.delete(agent.session.header.id)
      this.guard.delete(agent.session.header.id)
    })
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
    ctx.effect?.(() => () => {
      this.disposed = true
      this.recoveryAbort.abort(new Error('Reconstruction plugin disposed.'))
      this.states.clear(); this.guard.clear()
    })
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
      (state.checkpoint ? `Selected editable scene: ${JSON.stringify(state.checkpoint)}. Use its blend_path to build on these changes, or select another saved candidate to explore a different approach.\n` : '') +
      (state.sculpted ? 'This scene includes native brush edits saved as editable mesh data.\n' : '') +
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
      if (checkpoint !== state.checkpoint) state.sculpted = false
      state.checkpoint = checkpoint
    }
    state.human_sequence = humanSequence(exec.agent)
    delete state.resume_after
    this.states.set(state.session_id, state)
    // begin/status calls preserve an existing watchdog; a direct continuation starts a fresh window.
    if (!previous || previous.phase === 'paused' || state.human_sequence > (previous.human_sequence ?? -1)) {
      this.guard.reset(exec.agent)
      delete state.continuation_health
    }
    this.announce(state, exec)
    return { status: state.phase, reconstruction: copy(state), continuation_enabled: this.config.continueUntilApproved !== false }
  }

  async prepareReview(args, exec) {
    const live = this.sculpt?.sessions.get(exec.agent.session.header.id)
    if (live && !live.exited && !live.shared) throw new Error('Commit or discard the active sculpt session before reviewing the saved scene.')
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
    if (candidate !== state.checkpoint) state.sculpted = false
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
    if (['error', 'unavailable'].includes(report.status)) {
      state.phase = 'awaiting-review'; state.reason = 'review-unavailable'; delete state.resume_after
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
    const checkpoint = sculptCommit ? result.saved_path : ['blender_python', 'blender_import', 'blender_helper_run', 'blender_checkpoint', 'blender_execute', 'blender_edit'].includes(name) ? result.blendPath
      : name === 'blender_scene' && ['new', 'open', 'save'].includes(args.action) ? (result.saved_path ?? result.blendPath) : undefined
    if (!checkpoint) return
    if (!sculptCommit && args.blend_path !== state.checkpoint) state.sculpted = false
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
    if (!state || ['paused', 'editing', 'awaiting-review'].includes(state.phase)) return
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
    const live = this.sculpt?.sessions.get(state.session_id)
    const editing = live && !live.exited && (!live.shared || live.brushActive)
    if ((!editing || live?.shared) && await this.fresh(state, { agent, signal })) return
    if (signal.aborted || this.disposed) return
    if (agent.inbox?.nextTurn?.some((message) => message.source?.kind === 'user')) {
      state.phase = 'paused'; state.reason = 'human-followup'; return
    }
    const health = await this.guard.observe(agent, state.checkpoint, signal)
    state.continuation_health = health
    if (signal.aborted || this.disposed) return
    if (agent.inbox?.nextTurn?.some(message => message.source?.kind === 'user')) {
      state.phase = 'paused'; state.reason = 'human-followup'; return
    }
    if (health.idleStops >= 3) {
      state.phase = 'paused'; state.reason = 'stalled'; state.resume_after = humanSequence(agent)
      agent.steer(this.message(state, this.describe(state) +
        (editing ? 'Commit the active brush edit or retain its recovery file before reporting. ' : '') +
        'Automatic continuation is paused after repeated endings with unchanged work. Preserve the current checkpoint and report the task as incomplete, including the blocker and latest review. A direct user continuation can resume this checkpoint.'))
      return
    }
    if (health.idleStops === 2) {
      const recovery = await this.recoverContext(agent, signal)
      if (signal.aborted || this.disposed) return
      if (agent.inbox?.nextTurn?.some(message => message.source?.kind === 'user')) {
        state.phase = 'paused'; state.reason = 'human-followup'; return
      }
      state.continuation_health.recovery = recovery
      state.continuations++
      agent.steer(this.message(state, this.describe(state) +
        'The runtime manages context capacity. Context recovery status: ' + recovery.status + '. Resume from the saved checkpoint and latest review with one concrete modeling, observation or repair action. Choose a method suited to the remaining shape problem. Describe an actionable blocker when execution is unavailable.'))
      return
    }
    state.continuations++
    const text = this.describe(state) + (editing
      ? 'A live brush edit is open. Continue shaping or observing it, or commit/discard when ready to change the saved scene. Choose the next action and method according to the visual evidence. Final acceptance uses saved artifacts.'
      : 'This reconstruction remains active. Choose the next useful action using the reference and available feedback. You can refine a candidate, try another method or work order, compare saved alternatives, or return to a better checkpoint. Exploration scope and timing are yours. Submit the chosen final artifacts for independent review.')
    agent.steer(this.message(state, text))
  }

  async recoverContext(agent, signal) {
    try {
      const presets = this.ctx.get?.('agentPresets')
      const compaction = presets?.serviceFor(agent, 'compaction') ?? agent.ctx?.get?.('compaction')
      if (!compaction?.compactIfNeeded) return { status: 'unavailable' }
      const bounded = AbortSignal.any([signal, this.recoveryAbort.signal, AbortSignal.timeout(60000)])
      const result = await compaction.compactIfNeeded(agent, 'pressure', bounded)
      return { status: result ? 'compacted' : 'within-capacity' }
    } catch (error) {
      if (signal.aborted) throw error
      return { status: 'failed', error: String(error.message ?? error).slice(0, 500) }
    }
  }
}
