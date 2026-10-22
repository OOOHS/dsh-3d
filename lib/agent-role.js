import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-3d-agent-role'
export const inject = ['tools', 'systemPrompt', 'llm']
export const Config = Schema.object({
  role: Schema.union(['modeler', 'reviewer']).required(),
  provider: Schema.string().required(), model: Schema.string().required(),
  reasoningEffort: Schema.string().required(), maxTokens: Schema.number().required(),
  instructions: Schema.string().required(),
  timeoutMs: Schema.number(), maxSteps: Schema.number(), maxRecoveries: Schema.number(),
})

export function apply(ctx, config) {
  ctx.systemPrompt.section({ name: 'dsh-3d:role', order: 0, text: config.instructions,
    interpolate: false, ...(config.role === 'reviewer' ? { complete: true } : {}) })
  if (config.role === 'reviewer') {
    ctx.tools.presentAs('native')
    ctx.tools.restrict({ allow: ['inspect_image'] })
    ctx.systemPrompt.suppressRuntimeContext()
    ctx.tools.guard(exec => ['inspect_image', 'submit_review'].includes(exec.name) ? undefined : 'The review role observes evidence with inspect_image and submits with submit_review.')
  }
  ctx.on('agent/request', async ({ agent, signal }, next) => {
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
