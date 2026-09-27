import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { configureWorkBuddyModels, normalizeGatewayChatCompletionsUrl } from './workbuddy-config.mjs'

test('normalizes an AI OPS gateway root to the WorkBuddy Chat Completions endpoint', () => {
  assert.equal(normalizeGatewayChatCompletionsUrl('http://127.0.0.1:4175'), 'http://127.0.0.1:4175/v1/chat/completions')
  assert.equal(normalizeGatewayChatCompletionsUrl('https://gateway.example.test/v1'), 'https://gateway.example.test/v1/chat/completions')
})

test('replaces only legacy AI OPS entries while preserving unrelated WorkBuddy models', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ops-workbuddy-config-'))
  try {
    const configPath = join(directory, 'models.json')
    await writeFile(configPath, JSON.stringify([
      { id: 'other-model', name: 'Other', vendor: 'Other', apiKey: 'other-key', url: 'https://other.test/v1/chat/completions' },
      { id: 'old-ai-ops', name: 'AI OPS', vendor: 'AI OPS', apiKey: 'old-key', url: 'http://127.0.0.1:4175/v1/chat/completions' },
    ]), 'utf8')

    const result = await configureWorkBuddyModels({ configPath, apiKey: 'sk-aiops-test-key', gatewayBaseUrl: 'http://127.0.0.1:4175' })
    const saved = JSON.parse(await readFile(configPath, 'utf8'))
    assert.equal(result.created, false)
    assert.equal(result.preservedModels, 1)
    assert.equal(saved.length, 2)
    assert.deepEqual(saved.map((model) => model.id), ['other-model', 'ai-ops'])
    assert.equal(saved[1].url, 'http://127.0.0.1:4175/v1/chat/completions')
    assert.equal(saved[1].apiKey, 'sk-aiops-test-key')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('uses a previous WorkBuddy backup when no active models file exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ops-workbuddy-backup-'))
  try {
    const configPath = join(directory, 'models.json')
    await writeFile(`${configPath}.bak`, JSON.stringify([{ id: 'legacy-ai-ops', name: 'AI OPS', vendor: 'AI OPS' }]), 'utf8')
    const result = await configureWorkBuddyModels({ configPath, apiKey: 'sk-aiops-test-key', gatewayBaseUrl: 'https://gateway.example.test/v1' })
    const saved = JSON.parse(await readFile(configPath, 'utf8'))
    assert.equal(result.created, true)
    assert.equal(result.restoredFromBackup, true)
    assert.deepEqual(saved.map((model) => model.id), ['ai-ops'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
