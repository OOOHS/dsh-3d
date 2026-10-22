import { readFileSync } from 'node:fs'
import Schema from '@deepseek-ai/schemastery'

export const MODELER_PRESET = 'dsh-3d-modeler'
export const REVIEWER_PRESET = 'dsh-3d-reviewer'
export const MODELER_AGENT = JSON.parse(readFileSync(new URL('../agents/modeler.json', import.meta.url)))
export const REVIEWER_AGENT = JSON.parse(readFileSync(new URL('../agents/reviewer.json', import.meta.url)))

export function agentSchema(defaults, reviewer = false) {
  return Schema.object({
    provider: Schema.string().default(defaults.provider),
    model: Schema.string().default(defaults.model),
    reasoningEffort: Schema.string().default(defaults.reasoningEffort),
    maxTokens: Schema.number().default(defaults.maxTokens),
    instructions: Schema.string().default(defaults.instructions),
    ...(reviewer ? {
      timeoutMs: Schema.number().default(defaults.timeoutMs),
      maxSteps: Schema.number().default(defaults.maxSteps),
      maxRecoveries: Schema.number().default(defaults.maxRecoveries),
    } : {}),
  }).default(defaults)
}

export function agentSettings(config, role) {
  const defaults = role === 'reviewer' ? REVIEWER_AGENT : MODELER_AGENT
  const settings = { ...defaults, ...config[`${role}Agent`] }
  // Read old programmatic configuration while deployments migrate to role settings.
  if (role === 'reviewer' && !config.reviewerAgent) {
    for (const [old, key] of [['reviewProvider', 'provider'], ['reviewModel', 'model'], ['reviewTimeoutMs', 'timeoutMs'], ['reviewMaxOutputTokens', 'maxTokens']]) {
      if (config[old] !== undefined) settings[key] = config[old]
    }
  }
  for (const key of ['provider', 'model', 'reasoningEffort', 'instructions']) {
    if (typeof settings[key] !== 'string' || !settings[key].trim()) throw new Error(`${role}Agent.${key} must be a non-empty string`)
  }
  for (const key of role === 'reviewer' ? ['maxTokens', 'timeoutMs', 'maxSteps', 'maxRecoveries'] : ['maxTokens']) {
    if (!Number.isSafeInteger(settings[key]) || settings[key] < (key === 'maxRecoveries' ? 0 : 1)) throw new Error(`${role}Agent.${key} has an invalid budget`)
  }
  return settings
}

export function modelOptions(settings) {
  return { provider: settings.provider, model: settings.model, reasoningEffort: settings.reasoningEffort, maxTokens: settings.maxTokens }
}

export function rolePlugin(role, settings) {
  return { id: `dsh-3d-${role}-role`, name: 'dsh-3d/agent-role', config: { role, ...settings } }
}

export function presetDefinitions(config) {
  const base = [
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'tool-shell', name: process.platform === 'win32' ? '@deepseek-ai/dsh-tool-pwsh' : '@deepseek-ai/dsh-tool-bash' },
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 } },
    ] },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true } },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
  ]
  return [
    { id: MODELER_PRESET, name: 'DSH 3D 建模', description: '持续编辑场景、原生雕刻与独立验收',
      plugins: [...base, rolePlugin('modeler', agentSettings(config, 'modeler'))] },
    { id: REVIEWER_PRESET, name: 'DSH 3D 评审', description: '独立观察证据、局部裁切与结构化评审',
      plugins: [rolePlugin('reviewer', agentSettings(config, 'reviewer'))] },
  ]
}

export function registerAgentPresets(ctx, config) {
  ctx.inject?.(['agentPresets'], async (child) => {
    for (const definition of presetDefinitions(config)) {
      const dispose = await child.agentPresets.register(definition)
      child.effect(() => dispose)
    }
  })
}
