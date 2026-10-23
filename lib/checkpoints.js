import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const images = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Workspace-local saved alternatives. No scheduler, ranking policy or task state. */
export function createCheckpointTool(config, paths) {
  async function root(exec) {
    return paths.resolve('.dsh-blender/checkpoints', exec, config)
  }
  async function record(id, exec) {
    if (!ID.test(id ?? '')) throw new Error('checkpoint_id must be an ID returned by save/list.')
    const directory = join(await root(exec), id)
    const manifest = await paths.resolve(join(directory, 'checkpoint.json'), exec, config, { mustExist: true })
    const value = JSON.parse(await readFile(manifest, 'utf8'))
    if (value.version !== 1 || value.checkpoint_id !== id || value.scene?.path !== join(directory, 'scene.blend')) {
      throw new Error('Checkpoint manifest is invalid.')
    }
    return value
  }
  async function fingerprint(path, exec) {
    exec.signal?.throwIfAborted()
    const bytes = await readFile(path, { signal: exec.signal })
    return { path, bytes: bytes.length, sha256: sha256(bytes) }
  }
  async function execute(args, exec) {
    if (args.action === 'list') {
      const limit = args.limit ?? 20
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1..100.')
      const entries = await readdir(await root(exec)).catch(error => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const records = []
      for (const id of entries.filter(id => ID.test(id))) {
        try { records.push(await record(id, exec)) } catch (error) {
          // In-progress and interrupted saves have no published manifest.
          if (error.code !== 'ENOENT' && !error.message.includes('does not exist')) throw error
        }
      }
      records.sort((a, b) => b.created_at.localeCompare(a.created_at))
      return { checkpoints: records.slice(0, limit), total: records.length }
    }
    if (args.action === 'get') return { checkpoint: await record(args.checkpoint_id, exec) }
    if (args.action === 'restore') {
      const checkpoint = await record(args.checkpoint_id, exec)
      const source = await paths.resolve(checkpoint.scene.path, exec, config, { mustExist: true })
      const actual = await fingerprint(source, exec)
      if (actual.sha256 !== checkpoint.scene.sha256) throw new Error('Saved checkpoint bytes changed; choose an intact checkpoint.')
      const target = await paths.resolve(args.save_path, exec, config, { kind: 'save_path' })
      if (extname(target).toLowerCase() !== '.blend') throw new Error('save_path must end in .blend.')
      const canonical = await realpath(target).catch(error => { if (error.code === 'ENOENT') return target; throw error })
      const rel = relative(await realpath(await root(exec)), canonical)
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Restore into a working path outside the checkpoint archive.')
      await paths.writable(target, args.allow_overwrite === true)
      await paths.snapshot(source, target, exec)
      const saved = await fingerprint(target, exec)
      return { blendPath: target, restored_from: checkpoint.checkpoint_id, ...saved }
    }
    if (args.action !== 'save') throw new Error('Unknown checkpoint action.')
    const source = await paths.resolve(args.blend_path, exec, config, { mustExist: true, kind: 'blend_path' })
    await paths.file(source, 'blend_path')
    if (extname(source).toLowerCase() !== '.blend') throw new Error('blend_path must end in .blend.')
    for (const field of ['label', 'method', 'note']) {
      if (args[field] !== undefined && (typeof args[field] !== 'string' || args[field].length > 10000)) throw new Error(`${field} must be a string of at most 10000 characters.`)
    }
    if (args.parent_id) await record(args.parent_id, exec)
    const evidence = args.evidence_paths ?? []
    if (!Array.isArray(evidence) || evidence.length > 12) throw new Error('evidence_paths accepts up to 12 image paths.')
    const id = randomUUID(), directory = join(await root(exec), id)
    await mkdir(directory, { recursive: true })
    try {
      const target = join(directory, 'scene.blend')
      await paths.snapshot(source, target, exec)
      const files = []
      for (const [i, raw] of evidence.entries()) {
        const path = await paths.resolve(raw, exec, config, { mustExist: true, kind: 'evidence_path' })
        if (!images.has(extname(path).toLowerCase())) throw new Error('Checkpoint evidence must be PNG, JPEG or WebP.')
        await paths.file(path, 'evidence_path')
        const bytes = await readFile(path, { signal: exec.signal })
        const archived = join(directory, `evidence-${i}${extname(path).toLowerCase()}`)
        await writeFile(archived, bytes, { flag: 'wx' })
        files.push({ path: archived, source_path: path, bytes: bytes.length, sha256: sha256(bytes) })
      }
      const value = { version: 1, checkpoint_id: id, created_at: new Date().toISOString(),
        source_path: source, label: args.label ?? '', method: args.method ?? '', note: args.note ?? '',
        ...(args.parent_id ? { parent_id: args.parent_id } : {}), scene: await fingerprint(target, exec), evidence: files }
      const manifest = join(directory, 'checkpoint.json')
      await writeFile(`${manifest}.tmp`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
      await rename(`${manifest}.tmp`, manifest)
      return { checkpoint: value }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }
  return defineTool({
    name: 'blender_checkpoint',
    description: 'Save and revisit alternative Blender scenes while exploring methods or work orders. save archives a scene with packable resources, optional comparison images and free-form notes; parent_id can link a branch. list/get recover candidates across turns. restore opens any checkpoint into a working .blend for further code or brush edits. Choose which candidates to create, compare and retain. Saved checkpoints carry evidence and hashes; final visual approval is assessed on the chosen current artifacts.',
    parameters: {
      action: { type: 'string', required: true, enum: ['save', 'list', 'get', 'restore'] },
      blend_path: { type: 'string', description: 'save: saved scene to archive.' },
      checkpoint_id: { type: 'string', description: 'get/restore: ID from save/list.' },
      parent_id: { type: 'string', description: 'save: optional earlier checkpoint this candidate derives from.' },
      label: { type: 'string', description: 'save: short name chosen by you.' },
      method: { type: 'string', description: 'save: optional description of the modeling approach or work order.' },
      note: { type: 'string', description: 'save: optional observed result, tradeoff or next idea.' },
      evidence_paths: { type: 'array', items: { type: 'string' }, description: 'save: optional workspace images copied with the candidate, up to 12.' },
      save_path: { type: 'string', description: 'restore: working .blend output path.' },
      allow_overwrite: { type: 'boolean', description: 'restore: replace an existing working output; default false.' },
      limit: { type: 'integer', description: 'list: maximum candidates to return, default 20, up to 100.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    isConcurrencySafe: args => ['list', 'get'].includes(args.action), execute,
  })
}
