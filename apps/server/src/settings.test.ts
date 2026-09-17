import { describe, expect, it } from 'vitest'
import { createSettings, settingsResponseSchema } from './settings.js'

describe('settings contract', () => {
  it('keeps risky capabilities disabled and credential values unavailable', () => {
    const value = createSettings(
      { state: 'ready', authConfigured: true, checkedAt: '2026-09-15T10:00:00.000Z' },
      { state: 'reachable', checkedAt: '2026-09-15T10:00:00.000Z' },
      { state: 'reachable', checkedAt: '2026-09-15T10:00:00.000Z' },
      new Date('2026-09-15T10:00:00.000Z'),
    )
    expect(settingsResponseSchema.safeParse(value).success).toBe(true)
    expect(value.access).toMatchObject({ serverRbacVerified: true, writeAllowed: false })
    expect(value.connections.items.every((item) => item.credentialValueAvailable === false)).toBe(true)
    expect(value.features.items.every((item) => item.enabled === false && item.editable === false)).toBe(true)
    expect(value.backup).toMatchObject({ configured: false, browserDownloadAllowed: false })
  })
})
