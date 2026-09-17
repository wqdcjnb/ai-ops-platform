// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { SEARCH_DEBOUNCE_MS, useDebouncedSearch } from './useDebouncedSearch'

afterEach(() => vi.useRealTimers())

describe('useDebouncedSearch', () => {
  it('only runs the latest value after the short input pause', () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const search = ref('')
    const runSearch = vi.fn()
    let cancel: () => void

    scope.run(() => { ({ cancel } = useDebouncedSearch(search, runSearch)) })
    search.value = '林'
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    search.value = '林筱雨'
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    expect(runSearch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(runSearch).toHaveBeenCalledTimes(1)
    cancel!()
    scope.stop()
  })

  it('allows immediate actions to cancel the queued search', () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const search = ref('')
    const runSearch = vi.fn()
    let cancel: () => void

    scope.run(() => { ({ cancel } = useDebouncedSearch(search, runSearch)) })
    search.value = '请求'
    cancel!()
    vi.runAllTimers()

    expect(runSearch).not.toHaveBeenCalled()
    scope.stop()
  })
})
