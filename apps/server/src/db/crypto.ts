import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export function hashPlatformPassword(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function hashPlatformApiKey(value: string) {
  return createHash('sha256').update('ai-ops-gateway:' + value).digest('hex')
}

function platformKeyEncryptionKey() {
  return createHash('sha256')
    .update('ai-ops-key-view:' + (process.env.AI_OPS_KEY_ENCRYPTION_SECRET?.trim() || 'local-development-only-change-me'))
    .digest()
}

export function encryptPlatformApiKey(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', platformKeyEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'v1.' + iv.toString('base64url') + '.' + tag.toString('base64url') + '.' + ciphertext.toString('base64url')
}

export function decryptPlatformApiKey(value: string) {
  try {
    const parts = value.split('.')
    if(parts.length !== 4 || parts[0] !== 'v1') return null
    const iv = Buffer.from(parts[1]!, 'base64url')
    const tag = Buffer.from(parts[2]!, 'base64url')
    const ciphertext = Buffer.from(parts[3]!, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', platformKeyEncryptionKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function jsonText(value: unknown) {
  return JSON.stringify(value ?? null)
}

export function bytesFor(value: unknown) {
  return Buffer.byteLength(jsonText(value), 'utf8')
}

export function hashValue(value: unknown) {
  return createHash('sha256').update(jsonText(value)).digest('hex')
}

export function decryptJson(value: string | null | undefined): unknown {
  if(!value) return null
  const plain = decryptPlatformApiKey(value)
  if(!plain) return null
  try { return JSON.parse(plain) } catch { return null }
}

export function encryptJson(value: unknown) {
  return encryptPlatformApiKey(jsonText(value))
}

export function auditHash(input: {
  id: string
  actorUserId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  result: string
  requestId: string | null
  summaryJson: string
  occurredAt: string
}, previousHash: string | null) {
  return createHash('sha256').update(jsonText({
    version: 1,
    previousHash,
    id: input.id,
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    result: input.result,
    requestId: input.requestId,
    summaryJson: input.summaryJson,
    occurredAt: input.occurredAt,
  })).digest('hex')
}
