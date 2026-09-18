import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedSearch } from './useDebouncedSearch'

describe('useDebouncedSearch', () => {
  afterEach(() => vi.useRealTimers())

  it('runs once after the quiet period and cancels stale searches', () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const search = ref('')
    const runSearch = vi.fn()
    let cancel = () => {}
    scope.run(() => { cancel = useDebouncedSearch(search, runSearch).cancel })

    search.value = '人'
    vi.advanceTimersByTime(239)
    expect(runSearch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(runSearch).toHaveBeenCalledTimes(1)

    search.value = '人员'
    search.value = '人员页'
    vi.advanceTimersByTime(240)
    expect(runSearch).toHaveBeenCalledTimes(2)

    search.value = '人员页面'
    cancel()
    vi.advanceTimersByTime(240)
    expect(runSearch).toHaveBeenCalledTimes(2)
    scope.stop()
  })
})
