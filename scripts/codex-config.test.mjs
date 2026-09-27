import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureCodex, mergeAiOpsIntoCodexConfig, normalizeGatewayResponsesBaseUrl } from './codex-config.mjs'

test('normalizes the AI OPS Responses base URL', () => {
  assert.equal(normalizeGatewayResponsesBaseUrl('http://127.0.0.1:4175'), 'http://127.0.0.1:4175/v1')
  assert.equal(normalizeGatewayResponsesBaseUrl('https://gateway.example/v1/responses'), 'https://gateway.example/v1')
})

test('merges AI OPS into a Codex config without removing unrelated settings', () => {
  const source = [
    'service_tier = "default"',
    'model = "gpt-5.6-terra"',
    'model_provider = "openai"',
    '',
    '[features]',
    'web_search_request = true',
    '',
    '[model_providers.ai-ops]',
    'name = "Old AI OPS"',
    'base_url = "http://old.example/v1"',
    'env_key = "OLD_TOKEN"',
    'requires_openai_auth = true',
    'wire_api = "responses"',
    '',
    '[model_providers.other]',
    'name = "Other"',
  ].join('\n')

  const result = mergeAiOpsIntoCodexConfig(source, 'https://gateway.example/')
  assert.match(result, /^service_tier = "default"$/mu)
  assert.match(result, /^model = "ai-ops"$/mu)
  assert.match(result, /^model_provider = "ai-ops"$/mu)
  assert.match(result, /^base_url = "https:\/\/gateway\.example\/v1"$/mu)
  assert.match(result, /^env_key = "AI_OPS_TOKEN"$/mu)
  assert.match(result, /^requires_openai_auth = false$/mu)
  assert.match(result, /^\[model_providers\.other\]$/mu)
  assert.equal((result.match(/^\[model_providers\.ai-ops\]$/gmu) ?? []).length, 1)
  assert.doesNotMatch(result, /OLD_TOKEN/u)
})

test('writes a backup and stores the platform key through the injected user-variable setter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ops-codex-config-'))
  const configPath = join(directory, 'config.toml')
  const secret = 'sk-test-direct-codex-key'
  const writes = []
  try {
    await writeFile(configPath, 'model = "gpt-5.6-terra"\n', 'utf8')
    const result = await configureCodex({
      configPath,
      apiKey: secret,
      gatewayBaseUrl: 'http://127.0.0.1:4175',
      setUserEnvironmentVariable: async (name, value) => { writes.push({ name, value }) },
      inspectStatus: async () => ({ login: 'not_logged_in' }),
    })

    const updated = await readFile(configPath, 'utf8')
    const files = await readdir(directory)
    assert.deepEqual(writes, [{ name: 'AI_OPS_TOKEN', value: secret }])
    assert.equal(result.backupCreated, true)
    assert.equal(result.configCreated, false)
    assert.equal(result.login, 'not_logged_in')
    assert.match(updated, /^model = "ai-ops"$/mu)
    assert.doesNotMatch(updated, new RegExp(secret, 'u'))
    assert.equal(files.filter((file) => file.includes('.ai-ops-backup-')).length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
