export function surnameInitial(name: string) {
  const normalized = name.trim()
  if (!normalized) return '—'
  return normalized[0] ?? '—'
}
