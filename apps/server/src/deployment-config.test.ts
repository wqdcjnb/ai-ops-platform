import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyProjectDeploymentConfig, readProjectCpaConfig, resolveCpaApiKey, resolveCpaManagementKey } from './deployment-config.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
})

describe('project deployment configuration', () => {
  it('reads CPA API and management credentials from the mounted YAML without exposing them as output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-cpa-'))
    temporaryDirectories.push(directory)
    const configPath = join(directory, 'config.yaml')
    writeFileSync(configPath, [
      'remote-management:',
      '  allow-remote: true',
      '  secret-key: "management-secret"',
      'api-keys:',
      '  - "client-secret"',
    ].join('\n'))
    const env = { CPA_CONFIG_PATH: configPath } as NodeJS.ProcessEnv
    expect(readProjectCpaConfig(env)).toEqual({ configPath, apiKey: 'client-secret', managementKey: 'management-secret' })
    expect(resolveCpaApiKey(env)).toBe('client-secret')
    expect(resolveCpaManagementKey(env)).toBe('management-secret')
  })

  it('does not replace explicit environment credentials', () => {
    const env = { CPA_CONFIG_PATH: 'missing.yaml', AI_OPS_GATEWAY_CPA_API_KEY: 'env-client', CPA_MANAGEMENT_KEY: 'env-management' } as NodeJS.ProcessEnv
    applyProjectDeploymentConfig(env)
    expect(env.AI_OPS_GATEWAY_CPA_API_KEY).toBe('env-client')
    expect(env.CPA_MANAGEMENT_KEY).toBe('env-management')
  })

  it('prefers the project CPA env file when the YAML management key is hashed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-cpa-env-'))
    temporaryDirectories.push(directory)
    const configPath = join(directory, 'config.yaml')
    writeFileSync(configPath, 'remote-management:\n  secret-key: "$2a$hashed"\napi-keys:\n  - "client-from-yaml"\n')
    writeFileSync(join(directory, '.env'), 'CPA_MANAGEMENT_KEY=client-management\nCPA_API_KEY=client-api\n')
    const env = { CPA_CONFIG_PATH: configPath } as NodeJS.ProcessEnv
    expect(resolveCpaApiKey(env)).toBe('client-api')
    expect(resolveCpaManagementKey(env)).toBe('client-management')
  })
})
