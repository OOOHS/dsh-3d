import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, realpath, open, readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SculptSessions, owner, validateCommand, renderEditing } from './sculpt-session.js'

const WORKER = fileURLToPath(new URL('../scripts/dsh_sculpt_worker.py', import.meta.url))
const BRUSHES = JSON.parse(await readFile(new URL('./brushes.json', import.meta.url), 'utf8'))
const hash = value => createHash('sha256').update(value).digest('hex')
const sceneActions = new Set(['new', 'open', 'status', 'inspect', 'save', 'close', 'configure'])

/** One native process owns the live scene. Files are snapshots and project tools are ordinary Python files. */
export class SceneSessions extends SculptSessions {
  capabilities() {
    return ['persistent-scene', 'viewport', 'render', 'save-and-restore',
      ...(this.config.enablePython !== false ? ['python', 'project-tools'] : []),
      ...(this.config.enableSculpt !== false ? ['native-brushes'] : []),
      ...(this.config.enableReview !== false ? ['independent-review'] : [])]
  }
  async projectTools(exec) {
    const workspace = exec.agent.session.header.cwd
    const directory = join(workspace, 'tools')
    let names
    try { names = await readdir(directory) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const tools = []
    for (const name of names.filter(n => n.endsWith('.py')).sort().slice(0, 30)) {
      try {
        const path = await this.paths.resolve(join(directory, name), exec, this.config, { mustExist: true })
        const source = await readFile(path, 'utf8')
        const doc = source.match(/^\s*(?:#![^\n]*\n)?\s*(?:"""|''')([\s\S]*?)(?:"""|''')/u)?.[1]?.trim().split('\n')[0]
        tools.push({ path: `tools/${name}`, description: doc?.slice(0, 240) ?? name, sha256: hash(source) })
      } catch (error) { tools.push({ path: `tools/${name}`, unavailable: String(error.message).slice(0, 200) }) }
    }
    return tools
  }
  async decorate(value, session, exec) {
    value = JSON.parse(JSON.stringify(value))
    session.brushActive = value.mode === 'SCULPT'
    if (value.view?.view_id && !value.view.camera) session.lastViewId = value.view.view_id
    if (value.view || value.feedback || value.emitted_images?.length) value = await this.attach(value)
    return { ...value, scene_id: session.id, edit_id: session.id, working_path: session.working,
      ...(value.saved_path || value.blendPath ? {} : { blendPath: session.working }) }
  }
  async start(command, exec) {
    const key = owner(exec)
    const existing = this.sessions.get(key)
    const requestId = command.request_id ?? exec.callId
    if (requestId && existing?.startRequest === requestId && !existing.exited && existing.startValue) {
      if (existing.startDigest !== hash(JSON.stringify(command))) throw new Error('request_id was already used with different arguments.')
      return this.decorate(existing.startValue, existing, exec)
    }
    const source = command.action === 'open'
      ? await this.paths.resolve(command.blend_path, exec, this.config, { mustExist: true, kind: 'blend_path' }) : undefined
    if (source) {
      await this.paths.file(source, 'blend_path')
      if (extname(source).toLowerCase() !== '.blend') throw new Error('Open a .blend scene.')
    }
    if (existing && !existing.exited) {
      await this.send(existing, { action: 'suspend' }, exec)
      await this.stop(existing)
    }
    this.sessions.delete(key)
    const id = randomUUID(), directory = await this.paths.resolve(`.dsh-blender/scenes/${id}`, exec, this.config)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    for (const name of ['requests', 'responses']) await mkdir(join(directory, name), { mode: 0o700 })
    const working = join(directory, 'working.blend')
    const session = { id, owner: key, source: source ? await realpath(source) : working,
      shared: true, working, directory, exited: false }
    const configPath = join(directory, 'config.json')
    await writeFile(configPath, JSON.stringify({ shared: true, directory, edit_id: id,
      blend_path: source ?? null, workspace: exec.agent.session.header.cwd, working_path: working,
      preset: command.preset ?? 'front', brushes: BRUSHES, parent_pid: process.pid,
      idle_seconds: (this.config.sculptIdleTimeoutMs ?? 1800000) / 1000 }), { mode: 0o600 })
    const log = await open(join(directory, 'worker.log'), 'a', 0o600)
    try {
      session.child = spawn(this.config.blenderExecutable,
        ['--factory-startup', '--disable-autoexec', '--no-window-focus', '--window-geometry', '0', '0', '1000', '800',
          ...(source ? [source] : []), '--python', WORKER, '--', '--config', configPath],
        { stdio: ['ignore', log.fd, log.fd] })
    } finally { await log.close() }
    session.closed = new Promise(resolve => {
      session.child.once('error', error => { session.exited = true; session.exitCode = error.message; resolve() })
      session.child.once('close', code => { session.exited = true; session.exitCode = code; resolve() })
    })
    this.sessions.set(key, session)
    let ready
    try {
      ready = await this.waitFile(session, join(directory, 'ready.json'), exec.signal)
      if (!ready.ok) throw new Error(ready.error)
    } catch (error) { await this.stop(session); this.sessions.delete(key); throw error }
    session.startRequest = requestId
    session.startDigest = hash(JSON.stringify(command))
    session.startValue = ready.value
    return this.decorate(ready.value, session, exec)
  }
  current(exec, id) {
    const session = this.sessions.get(owner(exec))
    if (!session || session.exited) throw new Error(`Open a scene with blender_scene. ${session ? `Recover from ${session.working}.` : ''}`)
    if (id && id !== session.id && id !== session.lastViewId) throw new Error(`Scene ID mismatch: ID belongs to another scene or is stale. Current scene_id/edit_id: ${session.id}. Omit the ID to use this conversation’s current scene; view_id identifies an observation.`)
    return session
  }
  async request(command, exec) {
    const session = this.current(exec, command.scene_id ?? command.edit_id)
    const requestId = command.request_id ?? exec.callId
    const digest = hash(JSON.stringify(command)), key = `${owner(exec)}:${requestId}`
    if (requestId && this.cache.has(key)) {
      const entry = this.cache.get(key)
      if (entry.digest !== digest) throw new Error('request_id was already used with different arguments.')
      return this.decorate(entry.value, session, exec)
    }
    let response
    try { response = await this.send(session, command, exec) }
    catch (error) { await this.stop(session); throw error }
    if (!response.ok) throw new Error(`${response.error} Current scene_id/edit_id: ${session.id}. IDs may be omitted. blender_scene status reports the current context.`)
    if (requestId) this.cache.set(key, { digest, value: response.value })
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value)
    const value = await this.decorate(response.value, session, exec)
    if (value.closed) { await this.stop(session); this.sessions.delete(owner(exec)) }
    return value
  }
  scene(args, exec) {
    return this.serial(async () => {
      if (!sceneActions.has(args.action)) throw new Error('Scene action: new, open, status, inspect, configure, save, close.')
      if (this.disposed) throw new Error('Scene plugin has stopped.')
      exec.signal?.throwIfAborted()
      if (args.action === 'new' || args.action === 'open') return this.start(args, exec)
      const current = this.sessions.get(owner(exec))
      if (args.action === 'status' && (!current || current.exited)) return {
        status: current ? 'exited' : 'inactive', capabilities: this.capabilities(), executable: this.config.blenderExecutable,
        ...(current ? { recovery_path: current.working } : {}), project_tools: await this.projectTools(exec) }
      const command = { observe: args.action === 'configure', ...args, ...(args.action === 'configure' ? { action: 'configure_scene' } : {}) }
      if (args.action === 'save') {
        command.save_path = await this.output(args.save_path, exec, args.allow_overwrite === true)
      }
      const value = await this.request(command, exec)
      if (args.action === 'status') return { ...value, capabilities: this.capabilities(), project_tools: await this.projectTools(exec) }
      return value
    })
  }
  async output(path, exec, overwrite = false) {
    const target = await this.paths.resolve(path, exec, this.config, { kind: 'save_path' })
    if (extname(target).toLowerCase() !== '.blend') throw new Error('save_path must end in .blend.')
    await this.guard('scene-save', { save_path: target }, exec)
    await this.paths.writable(target, overwrite)
    await mkdir(join(target, '..'), { recursive: true })
    return target
  }
  async execute(args, exec) {
    if (this.config.enablePython === false) throw new Error('Python execution is disabled in this profile.')
    if (!!args.script === !!args.tool_path) throw new Error('Supply either script or tool_path.')
    let command = { ...args, action: 'python' }
    if (args.tool_path) {
      const path = await this.paths.resolve(args.tool_path, exec, this.config, { mustExist: true, kind: 'tool_path' })
      if (extname(path).toLowerCase() !== '.py') throw new Error('Project tools are .py files in the workspace.')
      await this.paths.file(path, 'tool_path')
      const source = await readFile(path, 'utf8')
      command = { ...command, tool_path: path, tool_source: source, tool_sha256: hash(source) }
    }
    if (!this.sessions.get(owner(exec)) || this.sessions.get(owner(exec)).exited) await this.scene({ action: 'new' }, exec)
    return this.serial(() => this.request(command, exec))
  }
  async run(args, exec) {
    validateCommand(args)
    if (args.action === 'begin') {
      if (!this.sessions.get(owner(exec)) || this.sessions.get(owner(exec)).exited) {
        if (!args.blend_path) throw new Error('Open/create a scene first or supply blend_path.')
        await this.scene({ action: 'open', blend_path: args.blend_path, preset: args.preset }, exec)
      }
      return this.serial(async () => {
        if (args.blend_path) {
          const path = await this.paths.resolve(args.blend_path, exec, this.config, { mustExist: true })
          const session = this.current(exec)
          if (![session.source, session.working].includes(await realpath(path))) throw new Error('Open the intended scene with blender_scene before selecting its component.')
        }
        return this.request({ ...args, action: 'select' }, exec)
      })
    }
    return this.serial(async () => {
      const command = { observe: !['brushes', 'settings'].includes(args.action), ...args }
      if (args.action === 'commit' && args.save_path) command.save_path = await this.output(args.save_path, exec, args.allow_overwrite === true)
      if (args.action === 'view' && args.kind === 'render') {
        command.action = 'render'
        command.output_path = await this.paths.resolve(args.output_path ?? `.dsh-blender/renders/${randomUUID()}.png`, exec, this.config, { kind: 'output_path' })
        if (extname(command.output_path).toLowerCase() !== '.png') throw new Error('Live renders use PNG.')
        await this.paths.writable(command.output_path, args.allow_overwrite === true)
      }
      return this.request(command, exec)
    })
  }
  async guard(name, args, exec) {
    await super.guard(name, args, exec)
    for (const session of this.sessions.values()) {
      if (session.exited) continue
      for (const path of [args.save_path, args.output_path].filter(Boolean)) {
        const resolved = await this.paths.resolve(path, exec, this.config)
        if (resolved === session.working) throw new Error('The runtime owns working.blend. Save snapshots to a project path or edit the live scene with blender_execute.')
      }
    }
  }
}

export const renderScene = renderEditing
export function createSceneTools(manager) {
  const output = { schema: { type: 'object', additionalProperties: true }, render: renderScene }
  return [defineTool({ name: 'blender_scene',
    description: 'Manage the current shared Blender scene. new starts an empty scene; open loads a saved scene; both preserve the previous working recovery file. Python, brushes and views operate on this same live scene. status returns the actual editing context and a compact index of tools/*.py; inspect returns compact object facts; detail=true includes evaluated topology, UVs, constraints and animation. configure changes native selection, mode and active tool. save creates a snapshot while the scene stays open; open any saved candidate to return to it. close retains recovery. Choose methods and work order yourself.',
    parameters: {
      action: { type: 'string', required: true, enum: [...sceneActions] },
      scene_id: { type: 'string', description: 'Optional current scene ID; omitted selects this conversation’s scene.' },
      blend_path: { type: 'string', description: 'open: workspace .blend to load.' },
      save_path: { type: 'string', description: 'save: new project .blend snapshot path.' },
      allow_overwrite: { type: 'boolean', description: 'save: explicitly replace an existing snapshot; defaults to false.' },
      object_name: { type: 'string', description: 'configure: select an object by exact name.' },
      mode: { type: 'string', description: 'configure: native object mode, e.g. OBJECT, EDIT, SCULPT.' },
      tool: { type: 'string', description: 'configure: native workspace tool id accepted by bpy.ops.wm.tool_set_by_id.' },
      detail: { type: 'boolean', description: 'inspect: include bounds, UV/color layers, constraints, vertex groups, shape keys, animation and evaluated mesh counts; default false.' },
      evaluated: { type: 'boolean', description: 'inspect with detail: evaluate modifiers for mesh counts; default true.' },
      object_names: { type: 'array', items: { type: 'string' }, description: 'inspect: named objects; omitted lists scene objects.' },
      limit: { type: 'integer', description: 'inspect: maximum object summaries, default 40, up to 200.' },
      preset: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'bottom'], description: 'new/open: initial view.' },
      request_id: { type: 'string', description: 'Stable ID for safely retrying a request.' },
    }, output, execute: (args, exec) => manager.scene(args, exec),
  }), defineTool({ name: 'blender_execute',
    description: 'Execute Python incrementally in the current live Blender scene, preserving existing code and brush changes. Opens an empty scene on first use. Supply script, or tool_path to a project .py file freshly loaded on every call. Tools may define run(params) or assign dsh_result. Globals: bpy, bmesh, mathutils, workspace, params, dsh. Execution retains Blender’s current mode, selection and brush settings. Choose mode explicitly when an operator needs a different mode. dsh exposes inspect(), editor(), configure(object_name=None,mode=None,tool=None), select(object_name), view(**options), stroke(**options), render(**options), edit(action,**options), sculpt(action,**options), project(points,object_name=None), emit(observation). emit explicitly returns intermediate images and brush comparisons. Project current geometry positions to the chosen view for replayable gestures. Save useful helpers with the host file tools and revise them freely. Execution returns actual object changes, result and optional image; failures restore the preceding scene. Explicitly create/open a scene for a different starting point.',
    parameters: {
      scene_id: { type: 'string', description: 'Optional current scene ID.' },
      script: { type: 'string', description: 'Python operating on the current scene. May set JSON-safe dsh_result.' },
      tool_path: { type: 'string', description: 'Workspace .py file. Its current source is read and compiled on each call; run(params) is called when defined.' },
      mode: { type: 'string', description: 'Optional native mode to enter before execution, e.g. OBJECT, EDIT, SCULPT. Omitted preserves the current mode.' },
      params: { type: 'json', description: 'JSON input exposed as params and passed to run(params).' },
      observe: { type: 'boolean', description: 'Return a fresh viewport image after execution; default true.' },
      request_id: { type: 'string', description: 'Stable ID for safely retrying a completed execution.' },
    }, output, execute: (args, exec) => manager.execute(args, exec),
  })]
}
