import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export type ProjectCpaConfig = {
  apiKey?: string
  managementKey?: string
  configPath?: string
}

function optionalValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function scalar(value: string) {
  const withoutComment = value.replace(/\s+#.*$/, '').trim()
  if (!withoutComment) return undefined
  if (withoutComment.startsWith('"') && withoutComment.endsWith('"')) {
    try { return optionalValue(JSON.parse(withoutComment) as string) } catch { return optionalValue(withoutComment.slice(1, -1)) }
  }
  if (withoutComment.startsWith("'") && withoutComment.endsWith("'")) return optionalValue(withoutComment.slice(1, -1).replace(/''/g, "'"))
  return optionalValue(withoutComment)
}

function configuredCpaPath(env: NodeJS.ProcessEnv) {
  const configured = optionalValue(env.CPA_CONFIG_PATH)
  if (!configured) return undefined
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
}

function configuredCpaEnvPath(env: NodeJS.ProcessEnv) {
  const configured = optionalValue(env.CPA_ENV_PATH)
  if (configured) return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  const configPath = configuredCpaPath(env)
  return configPath ? join(dirname(configPath), '.env') : undefined
}

function readProjectCpaEnvValue(name: string, env: NodeJS.ProcessEnv) {
  const envPath = configuredCpaEnvPath(env)
  if (!envPath || !existsSync(envPath)) return undefined
  let content: string
  try { content = readFileSync(envPath, 'utf8') } catch { return undefined }
  const line = content.split(/\r?\n/).find((candidate) => new RegExp(`^\\s*${name}\\s*=`).test(candidate))
  if (!line) return undefined
  const raw = line.slice(line.indexOf('=') + 1).trim()
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { return optionalValue(JSON.parse(raw) as string) } catch { return optionalValue(raw.slice(1, -1)) }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return optionalValue(raw.slice(1, -1).replace(/''/g, "'"))
  return optionalValue(raw)
}

/**
 * Reads only the two CPA credentials that AI OPS needs from the project-owned
 * config file. The file itself remains mounted read-only in the AI OPS
 * container and is never serialized into an API response or log entry.
 */
export function readProjectCpaConfig(env: NodeJS.ProcessEnv = process.env): ProjectCpaConfig {
  const configPath = configuredCpaPath(env)
  if (!configPath || !existsSync(configPath)) return { configPath }
  let content: string
  try { content = readFileSync(configPath, 'utf8') } catch { return { configPath } }

  let inManagement = false
  let inApiKeys = false
  let managementKey: string | undefined
  let apiKey: string | undefined
  for (const line of content.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inManagement = /^remote-management:\s*$/.test(line)
      inApiKeys = /^api-keys:\s*$/.test(line)
      continue
    }
    if (inManagement) {
      const match = line.match(/^\s+secret-key:\s*(.+)$/)
      if (match) managementKey = scalar(match[1] ?? '')
    }
    if (inApiKeys && !apiKey) {
      const match = line.match(/^\s+-\s*(.+)$/)
      if (match) apiKey = scalar(match[1] ?? '')
    }
  }
  return { configPath, ...(apiKey ? { apiKey } : {}), ...(managementKey ? { managementKey } : {}) }
}

export function resolveCpaApiKey(env: NodeJS.ProcessEnv = process.env) {
  return optionalValue(env.AI_OPS_GATEWAY_CPA_API_KEY) ?? optionalValue(env.CPA_API_KEY) ?? readProjectCpaEnvValue('CPA_API_KEY', env) ?? readProjectCpaConfig(env).apiKey
}

export function resolveCpaManagementKey(env: NodeJS.ProcessEnv = process.env) {
  return optionalValue(env.CPA_MANAGEMENT_KEY) ?? readProjectCpaEnvValue('CPA_MANAGEMENT_KEY', env) ?? readProjectCpaConfig(env).managementKey
}

/** Apply project-owned CPA credentials before the runtime and gateway are built. */
export function applyProjectDeploymentConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = resolveCpaApiKey(env)
  const managementKey = resolveCpaManagementKey(env)
  if (!optionalValue(env.AI_OPS_GATEWAY_CPA_API_KEY) && apiKey) env.AI_OPS_GATEWAY_CPA_API_KEY = apiKey
  if (!optionalValue(env.CPA_MANAGEMENT_KEY) && managementKey) env.CPA_MANAGEMENT_KEY = managementKey
}
