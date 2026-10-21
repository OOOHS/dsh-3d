import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, realpath, open } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

const WORKER = fileURLToPath(new URL('../scripts/dsh_sculpt_worker.py', import.meta.url))
const ACTIONS = new Set(['begin', 'stroke', 'undo', 'redo', 'status', 'commit', 'discard'])
const PRESETS = new Set(['front', 'back', 'left', 'right', 'top', 'bottom'])
const BRUSHES = new Set(['draw', 'grab', 'smooth', 'inflate'])
const READ_ONLY = new Set(['blender_status', 'blender_helper_catalog'])

function owner(exec) {
  const id = exec?.agent?.session?.header?.id
  if (typeof id !== 'string' || !id) throw new Error('Sculpt editing requires a dsh conversation ID.')
  return id
}
function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`)
  }
}
function vector(value, length, min, max, label) {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} requires ${length} numbers.`)
  value.forEach((v) => finite(v, min, max, label))
}
export function validateCommand(command) {
  if (!ACTIONS.has(command.action) && command.action !== 'view') throw new Error('Unknown sculpt action.')
  if (command.action === 'stroke') {
    if (!BRUSHES.has(command.brush)) throw new Error('brush must be draw, grab, smooth or inflate.')
    if (!command.view_id) throw new Error('stroke requires the latest view_id from blender_view or blender_sculpt.')
    if (!Array.isArray(command.points) || command.points.length < 2 || command.points.length > 256) {
      throw new Error('points requires 2–256 [u,v,pressure?] samples. Repeat a point for a stationary dab.')
    }
    for (const point of command.points) {
      if (!Array.isArray(point) || ![2, 3].includes(point.length)) throw new Error('Each point is [u,v,pressure?].')
      point.forEach((v) => finite(v, 0, 1, 'point coordinate/pressure'))
    }
    if (command.radius !== undefined) finite(command.radius, 0.001, 0.5, 'radius')
    if (command.strength !== undefined) finite(command.strength, 0, 1, 'strength')
    if (command.symmetry !== undefined && !/^(x?y?z?)$/u.test(command.symmetry)) throw new Error('symmetry must be an ordered subset of xyz, or an empty string.')
  }
  if (command.preset !== undefined && !PRESETS.has(command.preset)) throw new Error('Unknown view preset.')
  if (command.orbit !== undefined) vector(command.orbit, 2, -360, 360, 'orbit')
  if (command.pan !== undefined) vector(command.pan, 2, -10, 10, 'pan')
  if (command.rotation !== undefined) {
    vector(command.rotation, 4, -1, 1, 'rotation')
    if (Math.hypot(...command.rotation) < 0.001) throw new Error('rotation quaternion must have nonzero length.')
  }
  if (command.zoom !== undefined) finite(command.zoom, 0.05, 20, 'zoom')
  if (command.projection !== undefined && !['ORTHO', 'PERSP'].includes(command.projection)) throw new Error('projection must be ORTHO or PERSP.')
}

/** Owns only isolated editing copies. IPC is private, atomic and serialized. */
export class SculptSessions {
  constructor(config, paths, attachments) {
    this.config = config
    this.paths = paths
    this.attachments = attachments
    this.sessions = new Map()
    this.cache = new Map()
    this.queue = Promise.resolve()
    this.disposed = false
    this.exitHandler = () => { for (const session of this.sessions.values()) session.child?.kill('SIGTERM') }
    process.on('exit', this.exitHandler)
  }
  serial(task) {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {})
    return result
  }
  async guard(name, args, exec) {
    if (READ_ONLY.has(name)) return
    for (const session of this.sessions.values()) {
      if (session.exited) continue
      if (session.owner === owner(exec)) {
        throw new Error(`Editing session ${session.id} is active. Use blender_view for live inspection; commit or discard before file-based Blender tools.`)
      }
      const candidates = [args.blend_path, args.save_path, args.output_path, args.model_path,
        ...Object.values(args.arguments ?? {}).filter((v) => typeof v === 'string')]
      for (const path of candidates.filter((v) => typeof v === 'string' && extname(v).toLowerCase() === '.blend')) {
        const resolved = await this.paths.resolve(path, exec, this.config)
        const canonical = await realpath(resolved).catch(() => resolved)
        if (canonical === session.source) throw new Error(`This .blend is locked by editing session ${session.id}.`)
      }
    }
  }
  async stop(session) {
    if (!session.child || session.exited) return
    session.child.kill('SIGTERM')
    await Promise.race([session.closed, delay(2000)])
    if (!session.exited) {
      session.child.kill('SIGKILL')
      await session.closed
    }
  }
  async waitFile(session, path, signal) {
    const deadline = Date.now() + (this.config.sculptTimeoutMs ?? this.config.timeoutMs)
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Sculpt call cancelled. The worker is stopped; recovery.blend and its journal are retained.')
      try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (session.exited) throw new Error(`Blender editing process exited (${session.exitCode}). Recovery: ${session.directory}/recovery.blend; diagnostics: ${session.directory}/worker.log`)
      await delay(100)
    }
    throw new Error(`Blender editing timed out. Recovery and diagnostics: ${session.directory}`)
  }
  async send(session, command, exec) {
    const id = randomUUID()
    const path = join(session.directory, 'requests', `${id}.json`)
    await writeFile(`${path}.tmp`, JSON.stringify({ id, command }), { mode: 0o600 })
    await rename(`${path}.tmp`, path)
    return this.waitFile(session, join(session.directory, 'responses', `${id}.json`), exec.signal)
  }
  async attach(value) {
    if (!value.view) return value
    const service = this.attachments?.()
    if (!service) throw new Error('dsh attachments service is required to return sculpt images. Enable it in this profile.')
    const ref = await service.saveImage({ data: await readFile(value.view.path), mediaType: 'image/png', name: 'sculpt-view.png' })
    const attachment = { attachmentId: ref.attachmentId, mediaType: ref.mediaType,
      bytes: ref.bytes, width: ref.width, height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
      ...(ref.originalDimensions === undefined ? {} : { originalDimensions: { ...ref.originalDimensions } }) }
    return { ...value, view: { ...value.view, attachment } }
  }
  run(command, exec) {
    return this.serial(async () => {
      if (this.disposed) throw new Error('Sculpt plugin has stopped.')
      if (exec.signal?.aborted) throw new Error('Sculpt call cancelled.')
      validateCommand(command)
      const key = owner(exec)
      const requestId = command.request_id ?? exec.callId
      const cacheKey = `${key}:${requestId}`
      const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex')
      if (requestId && this.cache.has(cacheKey)) {
        const entry = this.cache.get(cacheKey)
        if (entry.digest !== digest) throw new Error('request_id was already used with different arguments.')
        if (entry.value.view && !entry.value.view.attachment) entry.value = await this.attach(entry.value)
        return entry.value
      }
      let session
      let response
      let transportPending = false
      try {
        if (command.action === 'begin') {
          if (this.sessions.get(key)?.exited) this.sessions.delete(key)
          if (this.sessions.has(key)) throw new Error('This conversation already has an active editing session. Commit or discard it first.')
          if (!this.attachments?.()) throw new Error('The dsh attachments service is required for native sculpt views.')
          const source = await this.paths.resolve(command.blend_path, exec, this.config, { mustExist: true, kind: 'blend_path' })
          await this.paths.file(source, 'blend_path')
          if (extname(source).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend.')
          if (typeof command.object_name !== 'string' || !command.object_name.trim()) throw new Error('begin requires object_name.')
          const canonical = await realpath(source)
          if ([...this.sessions.values()].some((s) => !s.exited && s.source === canonical)) throw new Error('This .blend already has an active editing session.')
          const id = randomUUID()
          const directory = await this.paths.resolve(`.dsh-blender/sculpt/${id}`, exec, this.config)
          await mkdir(directory, { recursive: true, mode: 0o700 })
          for (const sub of ['requests', 'responses']) await mkdir(join(directory, sub), { mode: 0o700 })
          session = { id, owner: key, source: canonical, directory, exited: false }
          this.sessions.set(key, session)
          const configPath = join(directory, 'config.json')
          await writeFile(configPath, JSON.stringify({ directory, edit_id: id, blend_path: source,
            object_name: command.object_name, preset: command.preset ?? 'front', parent_pid: process.pid,
            idle_seconds: (this.config.sculptIdleTimeoutMs ?? 1800000) / 1000 }), { mode: 0o600 })
          const log = await open(join(directory, 'worker.log'), 'a', 0o600)
          try {
            session.child = spawn(this.config.blenderExecutable, ['--factory-startup', '--disable-autoexec',
              '--no-window-focus', '--window-geometry', '0', '0', '1000', '800', source,
              '--python', WORKER, '--', '--config', configPath], { stdio: ['ignore', log.fd, log.fd] })
          } finally { await log.close() }
          session.closed = new Promise((resolve) => {
            session.child.once('error', (error) => { session.exited = true; session.exitCode = error.message; resolve() })
            session.child.once('close', (code) => { session.exited = true; session.exitCode = code; resolve() })
          })
          transportPending = true
          response = await this.waitFile(session, join(directory, 'ready.json'), exec.signal)
          transportPending = false
        } else {
          session = this.sessions.get(key)
          if (!session || session.id !== command.edit_id) throw new Error('No matching editing session belongs to this conversation. Use its edit_id or begin a new session.')
          if (session.exited) throw new Error(`Editing process ended. Recover from ${session.directory}/recovery.blend.`)
          const resolvedCommand = { ...command }
          if (command.action === 'commit') {
            const target = await this.paths.resolve(command.save_path, exec, this.config, { kind: 'save_path' })
            if (extname(target).toLowerCase() !== '.blend') throw new Error('save_path must end in .blend.')
            const canonical = await realpath(target).catch(() => target)
            if (canonical === session.source) throw new Error('Commit requires a new .blend path so the source remains available.')
            if ([...this.sessions.values()].some((s) => s !== session && !s.exited && s.source === canonical)) throw new Error('save_path is locked by another editing session.')
            await this.paths.writable(target, command.allow_overwrite === true)
            resolvedCommand.save_path = target
          }
          transportPending = true
          response = await this.send(session, resolvedCommand, exec)
          transportPending = false
        }
        if (!response.ok) throw Object.assign(new Error(response.error), { workerRejected: true })
        // Blender quaternions contain -0. JSON round-tripping normalizes that
        // value to 0 for dsh's strict lossless-JSON boundary.
        response.value = JSON.parse(JSON.stringify(response.value))
        // Cache the completed mutation before attachment delivery so transport retries never repeat it.
        const entry = { digest, value: response.value }
        if (requestId) this.cache.set(cacheKey, entry)
        if (response.value.closed) {
          await this.stop(session)
          this.sessions.delete(key)
        }
        entry.value = await this.attach(response.value)
        if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value)
        return entry.value
      } catch (error) {
        if (session && (transportPending || command.action === 'begin')) {
          await this.stop(session)
          this.sessions.delete(key)
        }
        throw error
      }
    })
  }
  async dispose() {
    this.disposed = true
    process.removeListener('exit', this.exitHandler)
    await Promise.all([...this.sessions.values()].map(async (session) => {
      if (session.child && !session.exited) {
        const id = randomUUID()
        const path = join(session.directory, 'requests', `${id}.json`)
        await writeFile(`${path}.tmp`, JSON.stringify({ id, command: { action: 'suspend' } }), { mode: 0o600 }).catch(() => {})
        await rename(`${path}.tmp`, path).catch(() => {})
        await Promise.race([session.closed, delay(3000)])
      }
      await this.stop(session)
    }))
    this.sessions.clear()
    await this.queue
  }
}

function render(_args, value) {
  const attachment = value.view?.attachment
  const summary = { ...value, ...(value.view ? { view: { ...value.view, attachment: undefined } } : {}) }
  return [{ type: 'text', text: JSON.stringify(summary, null, 2) },
    ...(attachment ? [{ type: 'image', attachment }] : [])]
}
export function createSculptTools(manager) {
  const shared = {
    edit_id: { type: 'string', description: 'ID returned by begin. Owned by this conversation.' },
    request_id: { type: 'string', description: 'Optional stable ID for safely retrying exactly the same request.' },
  }
  const output = { schema: { type: 'object', additionalProperties: true }, render }
  return [defineTool({
    name: 'blender_sculpt',
    description: 'Native Blender sculpting in one persistent editing session. begin opens an existing .blend mesh and returns its viewport image; stroke applies Draw/Grab/Smooth/Inflate and returns the updated image. Use normalized top-left image coordinates and the latest view_id. Call repeatedly until commit saves a new .blend or discard exits. undo/redo operate on stroke boundaries. File-based Blender tools resume after exit. Requires a desktop graphics context and Essentials brush assets (tested on Blender 5.2.2 LTS). Supports fixed-topology base meshes; prepare Multires, Shape Keys and Dynamic Topology separately before entry.',
    parameters: { ...shared,
      action: { type: 'string', required: true, enum: [...ACTIONS], description: 'begin, stroke, undo, redo, status, commit, discard.' },
      blend_path: { type: 'string', description: 'begin: existing workspace .blend input; remains preserved.' },
      object_name: { type: 'string', description: 'begin: exact visible mesh object name.' },
      preset: { type: 'string', enum: [...PRESETS], description: 'begin: initial orthographic view; default front.' },
      brush: { type: 'string', enum: [...BRUSHES], description: 'stroke: native brush asset.' },
      view_id: { type: 'string', description: 'stroke: latest returned view_id. A view change or new observation invalidates prior IDs.' },
      points: { type: 'json', description: 'stroke: 2–256 [u,v,pressure?] samples, each number 0..1. u goes right, v goes down. Repeat a point for a dab.' },
      radius: { type: 'number', description: 'stroke: brush radius as fraction of image width, 0.001..0.5; default 0.08.' },
      strength: { type: 'number', description: 'stroke: 0..1, default 0.5.' },
      invert: { type: 'boolean', description: 'stroke: native inverted direction, e.g. deflate.' },
      symmetry: { type: 'string', description: 'stroke: ordered subset of xyz, e.g. x, xy, xyz; default empty.' },
      save_path: { type: 'string', description: 'commit: new workspace .blend output path, distinct from source.' },
      allow_overwrite: { type: 'boolean', description: 'commit: allow replacing an existing output; defaults false.' },
    }, output,
    execute: (args, exec) => manager.run(args, exec),
  }), defineTool({
    name: 'blender_view',
    description: 'Observe or change the live sculpt viewport and return an actual image plus view_id. Coordinates in subsequent strokes refer to this image. Leave view options empty to observe. Views never add sculpt undo steps.',
    parameters: { ...shared,
      preset: { type: 'string', enum: [...PRESETS], description: 'Standard axis view.' },
      frame: { type: 'boolean', description: 'Fit selected mesh in view.' },
      orbit: { type: 'json', description: '[yaw,pitch] in degrees; relative orbit.' },
      rotation: { type: 'json', description: 'Absolute normalized quaternion [w,x,y,z].' },
      zoom: { type: 'number', description: 'Relative zoom multiplier 0.05..20. Values above 1 move closer.' },
      pan: { type: 'json', description: '[right,up], relative to current view distance.' },
      projection: { type: 'string', enum: ['ORTHO', 'PERSP'], description: 'Orthographic or perspective projection.' },
    }, output,
    execute: (args, exec) => manager.run({ ...args, action: 'view' }, exec),
  })]
}
