function cookieValue(name: string) {
  if (typeof document === 'undefined') return null
  const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return item?.slice(`${name}=`.length) ?? null
}

export function withCsrfHeader(headers: Record<string, string>) {
  const token = cookieValue('ai_ops_csrf')
  return token ? { ...headers, 'x-csrf-token': token } : headers
}
