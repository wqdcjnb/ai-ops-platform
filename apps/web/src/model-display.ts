/**
 * External-provider public IDs include a provider namespace and a hash so they
 * stay stable and collision-safe at the gateway boundary. Keep that detail out
 * of human-facing labels and client configuration where DeepSeek's upstream
 * model ID is already concise and unique.
 */
const deepSeekPublicModelId = /^external-deepseek-(deepseek-[a-z0-9][a-z0-9._-]*)-[a-f0-9]{10}$/i

export function conciseModelName(value: string) {
  const model = value.trim()
  return deepSeekPublicModelId.exec(model)?.[1] ?? model
}
