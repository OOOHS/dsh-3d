import Schema from '@deepseek-ai/schemastery'
import { NATIVE_TOOLS, scopeNativeDescriptions } from './native-modeling.js'

export const name = 'dsh-3d-agent-role'
export const inject = ['tools', 'systemPrompt', 'llm']
export const Config = Schema.object({
  role: Schema.union(['modeler', 'reviewer']).required(),
  provider: Schema.string().required(), model: Schema.string().required(),
  reasoningEffort: Schema.string().required(), maxTokens: Schema.number().required(),
  instructions: Schema.string().required(),
  timeoutMs: Schema.number(), maxSteps: Schema.number(), maxRecoveries: Schema.number(),
  programmaticTools: Schema.boolean().default(false),
  modelingInterface: Schema.union(['mixed', 'native']).default('mixed'),
})

export function apply(ctx, config) {
  if (config.programmaticTools) {
    const modern = ctx.get('ptcRuntime'), legacy = ctx.get('codeRuntime')
    if (!modern && !legacy) throw new Error('Code modeling requires a host PTC/code runtime. Mount the dsh runtime provider or select DSH 3D 建模.')
    ctx.tools.presentAs(modern ? 'ptc' : 'code')
  }
  let refreshNative
  if (config.role === 'modeler' && config.modelingInterface === 'native') {
    ctx.tools.presentAs('native')
    let release, previous
    refreshNative = () => {
      const globals = new Set(ctx.tools.schemas().map(tool => tool.name))
      const allow = NATIVE_TOOLS.filter(name => globals.has(name))
      const key = JSON.stringify(allow)
      if (key === previous) return
      previous = key
      release?.()
      release = ctx.tools.restrict({ allow })
    }
    refreshNative()
    scopeNativeDescriptions(ctx)
    ctx.on('tools/change', refreshNative)
    ctx.tools.guard(exec => NATIVE_TOOLS.includes(exec.name) ? undefined :
      'This experiment uses native Blender object controls, sculpt gestures, image observation and review.')
  }
  if (config.role === 'modeler') ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: -100,
    text: 'You are a visual 3D agent working in Blender.', interpolate: false })
  ctx.systemPrompt.section({ name: 'dsh-3d:role', order: 0, text: config.instructions,
    interpolate: false, ...(config.role === 'reviewer' ? { complete: true } : {}) })
  if (config.role === 'reviewer') {
    ctx.tools.presentAs('native')
    ctx.tools.restrict({ allow: ['inspect_image'] })
    ctx.systemPrompt.suppressRuntimeContext()
    ctx.tools.guard(exec => ['inspect_image', 'submit_review'].includes(exec.name) ? undefined : 'The review role observes evidence with inspect_image and submits with submit_review.')
  }
  ctx.on('agent/request', async ({ agent, signal }, next) => {
    refreshNative?.()
    const request = await next()
    const selected = config.role === 'modeler'
      ? agent.session.snapshotEvents().filter(e => e.type === 'model/selection').at(-1)?.data : undefined
    if (config.role === 'reviewer') {
      const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal)
      if (!info.inputModalities.includes('image')) throw new Error('The review agent requires an image-capable model.')
    }
    return { ...request, provider: selected?.provider ?? config.provider, model: selected?.model ?? config.model,
      reasoningEffort: selected ? selected.reasoningEffort : config.reasoningEffort, maxTokens: config.maxTokens }
  })
}
