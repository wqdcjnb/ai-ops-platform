
export const capabilities = (externalModelsAvailable = false) => ({
  models: externalModelsAvailable,
  chatCompletions: externalModelsAvailable,
  // The relay adapter forwards the native Responses contract whenever an
  // enabled third-party account is present.
  responses: externalModelsAvailable,
  media: externalModelsAvailable,
  streaming: externalModelsAvailable,
})
