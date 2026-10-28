import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, realpath, open } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

const WORKER = fileURLToPath(new URL('../scripts/dsh_sculpt_worker.py', import.meta.url))
const ACTIONS = new Set(['begin', 'preview', 'stroke', 'undo', 'redo', 'status', 'commit', 'discard', 'brushes', 'settings', 'configure'])
const PRESETS = new Set(['front', 'back', 'left', 'right', 'top', 'bottom'])
const BRUSH_ASSETS = JSON.parse(readFileSync(new URL('./brushes.json', import.meta.url), 'utf8'))
const READ_ONLY = new Set(['blender_status', 'blender_helper_catalog'])

export function owner(exec) {
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
  if (['stroke', 'preview'].includes(command.action)) {
    if (!command.view_id) throw new Error('stroke/preview requires the latest view_id from blender_view or blender_sculpt.')
    if (!Array.isArray(command.points) || command.points.length < 2 || command.points.length > 256) {
      throw new Error('points requires 2–256 [u,v,pressure?] samples. Repeat a point for a stationary dab.')
    }
    for (const point of command.points) {
      if (!Array.isArray(point) || ![2, 3].includes(point.length)) throw new Error('Each point is [u,v,pressure?].')
      point.forEach((v) => finite(v, 0, 1, 'point coordinate/pressure'))
    }
  }
  if (command.action === 'preview' && ['brush', 'settings', 'radius', 'strength', 'symmetry', 'invert'].some(k => k in command)) {
    throw new Error('preview observes the current configured brush. Use configure to set brush properties, then preview with points and its view_id.')
  }
  if (command.shading !== undefined && (!command.shading || typeof command.shading !== 'object' || Array.isArray(command.shading))) throw new Error('shading requires an object of native viewport display fields.')
  if (command.brush !== undefined && (typeof command.brush !== 'string' || !command.brush.trim() || command.brush.length > 300)) throw new Error('brush requires an installed asset name or alias.')
  if (command.radius !== undefined) finite(command.radius, 0.001, 0.5, 'radius')
  if (command.strength !== undefined) finite(command.strength, 0, 1, 'strength')
  if (command.symmetry !== undefined && !/^(x?y?z?)$/u.test(command.symmetry)) throw new Error('symmetry must be an ordered subset of xyz, or an empty string.')
  if (command.settings !== undefined) {
    if (!command.settings || typeof command.settings !== 'object' || Array.isArray(command.settings)) throw new Error('settings requires an object grouped by brush/sculpt/unified/automasking.')
    for (const [group, fields] of Object.entries(command.settings)) {
      if (!['brush', 'sculpt', 'unified', 'automasking'].includes(group) || !fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Choose a native settings group and property object.')
    }
  }
  if (command.offset !== undefined && (!Number.isInteger(command.offset) || command.offset < 0)) throw new Error('offset requires a nonnegative integer.')
  if (command.limit !== undefined && (!Number.isInteger(command.limit) || command.limit < 1 || command.limit > 100)) throw new Error('limit requires an integer 1..100.')
  if (command.query !== undefined && typeof command.query !== 'string') throw new Error('query requires text.')
  if (command.group !== undefined && !['brush', 'sculpt', 'unified', 'automasking'].includes(command.group)) throw new Error('Unknown settings group.')
  if (command.preset !== undefined && !PRESETS.has(command.preset)) throw new Error('Unknown view preset.')
  if (command.orbit !== undefined) vector(command.orbit, 2, -360, 360, 'orbit')
  if (command.pan !== undefined) vector(command.pan, 2, -10, 10, 'pan')
  if (command.rotation !== undefined) {
    vector(command.rotation, 4, -1, 1, 'rotation')
    if (Math.hypot(...command.rotation) < 0.001) throw new Error('rotation quaternion must have nonzero length.')
  }
  if (command.zoom !== undefined) finite(command.zoom, 0.05, 20, 'zoom')
  if (command.projection !== undefined && !['ORTHO', 'PERSP'].includes(command.projection)) throw new Error('projection must be ORTHO or PERSP.')
  for (const field of ['highlight', 'isolate']) {
    if (command[field] !== undefined && typeof command[field] !== 'boolean') throw new Error(`${field} must be boolean.`)
  }
  if (command.probe_points !== undefined) {
    if (!Array.isArray(command.probe_points) || command.probe_points.length > 32) throw new Error('probe_points accepts up to 32 [u,v] points.')
    command.probe_points.forEach(point => vector(point, 2, 0, 1, 'probe point'))
  }
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
      const candidates = [args.save_path, args.output_path,
        ...Object.values(args.arguments ?? {}).filter((v) => typeof v === 'string')]
      for (const path of candidates.filter((v) => typeof v === 'string' && extname(v).toLowerCase() === '.blend')) {
        const resolved = await this.paths.resolve(path, exec, this.config)
        const canonical = await realpath(resolved).catch(() => resolved)
        if (canonical === session.source) throw new Error(`This .blend is locked by editing session ${session.id}; choose another output path. Saved input files remain available for inspection and branching.`)
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
    if (!value.view && !value.feedback && !value.emitted_images?.length) return value
    const service = this.attachments?.()
    if (!service) throw new Error('dsh attachments service is required to return sculpt images. Enable it in this profile.')
    const result = { ...value }
    for (const field of ['view', 'feedback']) {
      if (!value[field] || value[field].attachment) continue
      const ref = await service.saveImage({ data: await readFile(value[field].path), mediaType: 'image/png', name: `blender-${field}.png` })
      const attachment = { attachmentId: ref.attachmentId, mediaType: ref.mediaType,
        bytes: ref.bytes, width: ref.width, height: ref.height,
        ...(ref.name === undefined ? {} : { name: ref.name }),
        ...(ref.originalDimensions === undefined ? {} : { originalDimensions: { ...ref.originalDimensions } }) }
      result[field] = { ...value[field], attachment }
    }
    if (value.emitted_images?.length) {
      result.emitted_images = []
      for (const view of value.emitted_images) result.emitted_images.push((await this.attach({ view })).view)
    }
    return result
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
            object_name: command.object_name, preset: command.preset ?? 'front',
            highlight: command.highlight ?? true, isolate: command.isolate ?? false,
            brushes: BRUSH_ASSETS, parent_pid: process.pid,
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
          const resolvedCommand = { observe: !['brushes', 'settings'].includes(command.action), ...command }
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

export function renderEditing(_args, value) {
  const summary = { context: { scene_id: value.scene_id ?? value.edit_id, object: value.editor?.active_object ?? value.object_name, mode: value.editor?.mode ?? value.mode, view_id: value.view?.view_id }, ...value }
  // Persist full evidence in the journal; keep action feedback inside the host's
  // tool-result budget so actual changes survive context pruning.
  if (!['inspect','status'].includes(_args.action)) {
    for (const key of ['objects','pid','source_path','journal_path','brush_base_path','geometry_hash','topology_hash','attributes_hash','blendPath','recovery_path']) delete summary[key]
  }
  if (summary.editor && !['inspect','status'].includes(_args.action)) {
    summary.editor = { ...summary.editor }; delete summary.editor.mesh
  }
  const images = []
  for (const field of ['view', 'feedback']) {
    if (!value[field]) continue
    summary[field] = { ...value[field], attachment: undefined }
    if (value[field].attachment) images.push({ type: 'image', attachment: value[field].attachment })
  }
  if (value.emitted_images?.length) {
    summary.emitted_images = value.emitted_images.map(view => ({ ...view, attachment: undefined,
      ...(view.target ? { target: { ...view.target, surface_samples: view.target.surface_samples?.slice(0, 5) } } : {}) }))
    for (const view of value.emitted_images) if (view.attachment) images.push({ type: 'image', attachment: view.attachment })
  }
  if (summary.view?.target?.surface_samples?.length > 5) {
    summary.view.target = { ...summary.view.target, surface_samples: summary.view.target.surface_samples.slice(0, 5) }
  }
  if (summary.preview?.probes?.length > 8) {
    const probes = summary.preview.probes
    summary.preview = { ...summary.preview, probe_count: probes.length,
      target_hits: probes.filter(p => p.target).length, probes: probes.slice(0, 8),
      probe_summary: 'First eight samples in text; the preview image marks the full gesture.' }
  }
  return [{ type: 'text', text: JSON.stringify(summary, (_key, v) =>
    typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(7)) : v) }, ...images]
}
export function createSculptTools(manager) {
  const shared = {
    edit_id: { type: 'string', description: 'Optional in the shared scene: omitted uses this conversation’s current scene. Explicit edit_id is returned by begin; view_id identifies an image.' },
    request_id: { type: 'string', description: 'Optional stable ID for safely retrying exactly the same request.' },
  }
  const output = { schema: { type: 'object', additionalProperties: true }, render: renderEditing }
  return [defineTool({
    name: 'blender_sculpt',
    description: 'Shape the live mesh through Blender’s native sculpt context. begin selects a mesh; brushes/settings discover installed assets and RNA fields; configure changes the active brush. Optional preview shows its nominal footprint and path with surface/occluder hits, preserving geometry and settings. stroke executes a gesture and returns the current viewport, a same-view before/after detail image, effective settings, actual geometry/attribute changes and displacement in local/world/image coordinates. Omitted settings retain Blender’s current values. undo/redo revisit strokes; commit leaves Sculpt Mode; discard restores entry. Code, mesh edits and brushes operate on the same geometry. Use the latest view_id. See references/sculpting.md.',
    parameters: { ...shared,
      action: { type: 'string', required: true, enum: [...ACTIONS], description: 'begin, brushes, settings, configure, preview, stroke, undo, redo, status, commit, discard.' },
      blend_path: { type: 'string', description: 'begin: existing workspace .blend input; remains preserved.' },
      object_name: { type: 'string', description: 'begin: exact visible mesh object name.' },
      preset: { type: 'string', enum: [...PRESETS], description: 'begin: initial orthographic view; default front.' },
      highlight: { type: 'boolean', description: 'begin: orange target with gray context for aiming; default true. Temporary display colors.' },
      isolate: { type: 'boolean', description: 'begin: show and hit-test the selected component alone; default false.' },
      brush: { type: 'string', description: 'configure/stroke: installed Essentials asset name from brushes, or a legacy alias such as grab. Omitted retains the active brush.' },
      query: { type: 'string', description: 'brushes/settings: search asset names or RNA property names/descriptions.' },
      group: { type: 'string', enum: ['brush', 'sculpt', 'unified', 'automasking'], description: 'settings: optional native settings group.' },
      offset: { type: 'integer', description: 'brushes/settings: pagination offset, default 0.' },
      limit: { type: 'integer', description: 'brushes/settings: page size 1..100, default 30.' },
      settings: { type: 'json', description: 'configure/stroke: native RNA patch grouped by brush/sculpt/unified/automasking, e.g. {brush:{falloff_shape:"PROJECTED",use_frontface:true,spacing:10}}. Discover properties, enum choices and bounds with settings.' },
      observe: { type: 'boolean', description: 'Return a fresh viewport; defaults false for brushes/settings and true for editing.' },
      view_id: { type: 'string', description: 'preview/stroke: latest full viewport view_id. Scene, view and observation changes invalidate prior IDs.' },
      points: { type: 'json', description: 'preview/stroke: 2–256 [u,v,pressure?] samples in the full viewport (0..1), origin top-left. Start on the visible target; drag endpoints may leave its silhouette. Repeat a point for a dab. Detail comparison panels have separate crop coordinates.' },
      radius: { type: 'number', description: 'configure/stroke: nominal radius as fraction of image width, 0.001..0.5. Sets the effective native size in VIEW units. Omitted retains current size.' },
      strength: { type: 'number', description: 'configure/stroke: effective native strength 0..1; omitted retains current value.' },
      invert: { type: 'boolean', description: 'stroke: native inverted direction, e.g. deflate.' },
      symmetry: { type: 'string', description: 'configure/stroke: ordered subset of xyz, e.g. x, xy, xyz; empty disables symmetry. Omitted retains Blender’s current axes.' },
      save_path: { type: 'string', description: 'commit: new workspace .blend output path, distinct from source.' },
      allow_overwrite: { type: 'boolean', description: 'commit: allow replacing an existing output; defaults false.' },
    }, output,
    execute: (args, exec) => manager.run(args, exec),
  }), defineTool({
    name: 'blender_view',
    description: 'Observe the live scene and choose its viewpoint and native display. kind=viewport returns the image, effective shading, selected-object bounds and view_id for screen-space edits. probe_points adds visible-surface hits and an annotated aiming image. shading adjusts viewport lighting/cavity/color independently of camera renders. kind=render uses a scene camera and returns a genuine render with source hashes. Observations preserve geometry.',
    parameters: { ...shared,
      kind: { type: 'string', enum: ['viewport', 'render'], description: 'Default viewport; render uses a scene camera.' },
      camera: { type: 'string', description: 'render: camera name; defaults to scene camera.' },
      time_frame: { type: 'integer', description: 'Animation frame. viewport selects and retains this frame; render samples it and restores the prior time. For batches use blender_render_frames on a saved snapshot.' },
      transparent: { type: 'boolean', description: 'render: override background transparency for this image; omitted retains scene setting.' },
      output_path: { type: 'string', description: 'render: new workspace PNG path; omitted creates an evidence image.' },
      width: { type: 'integer', description: 'render: 16..4096, default 768.' },
      height: { type: 'integer', description: 'render: 16..4096, default 768.' },
      samples: { type: 'integer', description: 'render: 1..512, default 32.' },
      preset: { type: 'string', enum: [...PRESETS], description: 'Standard axis view.' },
      frame: { type: 'boolean', description: 'Fit selected mesh in view.' },
      orbit: { type: 'json', description: '[yaw,pitch] in degrees; relative orbit.' },
      rotation: { type: 'json', description: 'Absolute normalized quaternion [w,x,y,z].' },
      zoom: { type: 'number', description: 'Relative zoom multiplier 0.05..20. Values above 1 move closer.' },
      pan: { type: 'json', description: '[right,up], relative to current view distance.' },
      projection: { type: 'string', enum: ['ORTHO', 'PERSP'], description: 'Orthographic or perspective projection.' },
      highlight: { type: 'boolean', description: 'Use orange target and gray context; false uses the scene viewport appearance.' },
      isolate: { type: 'boolean', description: 'Show and hit-test only the target. false restores scene context.' },
      shading: { type: 'json', description: 'Viewport display patch: type (SOLID/MATERIAL/RENDERED/WIREFRAME), light (STUDIO/FLAT/MATCAP), color_type (MATERIAL/OBJECT/SINGLE), show_shadows, show_cavity, cavity_type, background_type, studio_light. E.g. {light:"FLAT",show_shadows:false,show_cavity:false}. highlight=true temporarily uses target colors.' },
      probe_points: { type: 'json', description: 'Optional up to 32 [u,v] points in this view to raycast without editing.' },
    }, output,
    execute: (args, exec) => manager.run({ ...args, action: 'view' }, exec),
  })]
}
