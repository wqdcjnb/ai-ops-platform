/**
 * The only model identity exposed by the platform.  Relay model IDs remain
 * server-side implementation details.  The legacy ID is accepted only so an
 * already-imported Codex or WorkBuddy profile keeps working after the rename.
 */
export const PUBLIC_MODEL_ID = 'ai-ops' as const
export const PUBLIC_MODEL_NAME = 'AI OPS' as const
export const LEGACY_PUBLIC_MODEL_ID = 'ultimate-model' as const

export function isPublicModelId(value: string) {
  return value === PUBLIC_MODEL_ID || value === LEGACY_PUBLIC_MODEL_ID
}

export function normalizePublicModelId(value: string) {
  return value === LEGACY_PUBLIC_MODEL_ID ? PUBLIC_MODEL_ID : value
}

export function samePublicModel(left: string, right: string) {
  return normalizePublicModelId(left) === normalizePublicModelId(right)
}
