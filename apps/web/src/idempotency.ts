/** Request identifiers only; actual API Key secrets are generated on the server. */
export function createIdempotencyKey(prefix: string): string {
  const browserCrypto = globalThis.crypto
  if (typeof browserCrypto?.randomUUID === 'function') {
    return `${prefix}-${browserCrypto.randomUUID()}`
  }

  // randomUUID requires HTTPS/localhost. getRandomValues also works on LAN HTTP.
  // Preserve secure randomness and the UUID v4 format expected by the API.
  if (typeof browserCrypto?.getRandomValues !== 'function') {
    throw new Error('浏览器不支持安全随机数，请使用新版浏览器重试。')
  }
  const bytes = browserCrypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  return `${prefix}-${uuid}`
}
