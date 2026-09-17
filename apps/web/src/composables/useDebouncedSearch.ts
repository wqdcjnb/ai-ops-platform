import { onScopeDispose, watch, type Ref } from 'vue'

export const SEARCH_DEBOUNCE_MS = 240

export function useDebouncedSearch(search: Ref<string>, runSearch: () => void, delay = SEARCH_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  watch(search, () => {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      runSearch()
    }, delay)
  }, { flush: 'sync' })

  onScopeDispose(cancel)

  return { cancel }
}
