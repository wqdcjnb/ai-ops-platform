// Re-export layer: keeps './external-providers.js' working after the module was split.
// Prefer importing from './external-providers/*.js' in new code.
export * from './external-providers/schemas.js'
export { builtInExternalProviderPresets, listExternalProviderPresets } from './external-providers/presets.js'
export { inferExternalProviderModelModalities } from './external-providers/modality.js'
export {
  defaultExternalProvidersPath, hostsFromEnvironment, isLoopbackHost, isPrivateIpv4,
  isPrivateOrReservedHost, normalizeModelIds, publicModelId,
} from './external-providers/net-guards.js'
export { ExternalProviderRegistry, createExternalProviderRegistry } from './external-providers/registry.js'
