import { describe, expect, it } from 'vitest'
import { displayNewApiTokenMask, displayNewApiTokenSecret, extractNewApiTokenSecret, maskNewApiToken, normalizeNewApiToken } from './new-api-tokens.js'

describe('New API token display values', () => {
  it('adds the OpenAI-compatible prefix only to the displayed secret', () => {
    expect(displayNewApiTokenSecret('abc123456789')).toBe('sk-abc123456789')
    expect(displayNewApiTokenSecret('sk-abc123456789')).toBe('sk-abc123456789')
  })

  it('keeps the prefix in masks while hiding the credential body', () => {
    expect(maskNewApiToken('abc123456789')).toBe('sk-abc••••••6789')
    expect(maskNewApiToken('sk-abc123456789')).toBe('sk-abc••••••6789')
  })

  it('normalizes a masked value returned without the prefix', () => {
    expect(normalizeNewApiToken({ id: 1, key: 'abc********xyz', status: 1 })?.masked).toBe('sk-abc********xyz')
    expect(normalizeNewApiToken({ id: 2, key: 'sk-abc********xyz', status: 1 })?.masked).toBe('sk-abc********xyz')
    expect(displayNewApiTokenMask('abc********xyz')).toBe('sk-abc********xyz')
  })

  it('never treats the bullet-style list mask as a complete Key', () => {
    const masked = 'sk-MWZ••••••••••••••••••MDQT'
    expect(normalizeNewApiToken({ id: 3, key: masked, status: 1 })?.secret).toBeNull()
    expect(extractNewApiTokenSecret({ key: masked })).toBeNull()
  })
})
