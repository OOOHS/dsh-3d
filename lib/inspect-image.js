import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

const SCRIPT = fileURLToPath(new URL('../scripts/inspect_image.py', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function inspectImageContent(value) {
  return [{ type: 'text', text: JSON.stringify({ ...value, attachment: undefined }, null, 2) },
    { type: 'image', attachment: value.attachment }]
}

export async function renderCrop(python, args, signal) {
  signal?.throwIfAborted()
  const child = spawn(python, ['-I', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
  const chunks = [], errors = []
  let size = 0
  child.stdout.on('data', chunk => { size += chunk.length; if (size > 65536) child.kill('SIGKILL'); else chunks.push(chunk) })
  child.stderr.on('data', chunk => { if (Buffer.concat(errors).length < 4000) errors.push(chunk) })
  const abort = () => child.kill('SIGKILL')
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  try {
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(args))
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Image inspection failed: ${Buffer.concat(errors).toString().slice(-3000)}`)))
    })
    signal?.throwIfAborted()
    return JSON.parse(Buffer.concat(chunks).toString())
  } finally { signal?.removeEventListener('abort', abort) }
}

/** Shared implementation; review scopes supply a closed evidence resolver. */
export function createInspectImageTool(ctx, config, paths, options = {}) {
  return defineTool({
    name: 'inspect_image',
    description: 'Observe a reference or render image, optionally crop a normalized [left,top,right,bottom] region and enlarge it. Returns actual image pixels with original dimensions, source fingerprint and crop coordinates. Modelers supply a workspace path; reviewers select an image_id from their evidence list. Use whole-image context alongside local observations.',
    parameters: {
      image: { type: 'string', required: true, description: 'Workspace image path, or an admitted review image_id such as reference or render_1.' },
      region: { type: 'array', items: { type: 'number' }, description: 'Optional normalized [left,top,right,bottom] crop, with 0..1 coordinates. Defaults to the full image.' },
      zoom: { type: 'number', description: 'Display enlargement from 1 to 4, default 1; output longest side is capped at 2048 pixels.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => inspectImageContent(value) },
    async execute(args, exec) {
      const region = args.region ?? [0, 0, 1, 1], zoom = args.zoom ?? 1
      if (!Array.isArray(region) || region.length !== 4 || region.some(v => !Number.isFinite(v) || v < 0 || v > 1) || region[0] >= region[2] || region[1] >= region[3]) throw new Error('region requires [left,top,right,bottom] within 0..1 with positive area.')
      if (!Number.isFinite(zoom) || zoom < 1 || zoom > 4) throw new Error('zoom must be 1..4.')
      const source = options.resolve ? await options.resolve(args.image, exec)
        : { path: await paths.resolve(args.image, exec, config, { mustExist: true, kind: 'image' }), image_id: args.image }
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(source.path).toLowerCase())) throw new Error('Inspection accepts PNG, JPEG, WebP and GIF images.')
      const info = await stat(source.path)
      if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Inspection image must be a regular file of at most 20 MiB.')
      const bytes = await readFile(source.path, { signal: exec.signal })
      const sha256 = hash(bytes)
      if (source.sha256 && source.sha256 !== sha256) throw new Error('The admitted evidence image changed.')
      const directory = options.outputDirectory ?? await paths.resolve('.dsh-blender/observations', exec, config, { kind: 'observation directory' })
      await mkdir(directory, { recursive: true })
      const output = join(directory, `${randomUUID()}.png`)
      const python = config.analysisPythonExecutable || (process.platform === 'win32' ? 'python' : 'python3')
      const signal = AbortSignal.any([...(exec.signal ? [exec.signal] : []), AbortSignal.timeout(config.helperTimeoutMs ?? 120000)])
      const dimensions = await renderCrop(python, { source: source.path, output, region, zoom }, signal)
      if (hash(await readFile(source.path, { signal: exec.signal })) !== sha256) throw new Error('Image changed during observation; inspect the current version again.')
      const data = await readFile(output, { signal: exec.signal })
      const attachments = exec.agent?.ctx?.get?.('attachments') ?? ctx.get?.('attachments')
      if (!attachments?.saveImage) throw new Error('Image inspection requires the attachments service.')
      const ref = await attachments.saveImage({ data, mediaType: 'image/png', name: 'observation.png' })
      const attachment = { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height, ...(ref.name ? { name: ref.name } : {}) }
      return { image_id: source.image_id, source_sha256: sha256, region, zoom, ...dimensions, attachment,
        ...(options.resolve ? {} : { imagePath: output }) }
    },
  })
}
