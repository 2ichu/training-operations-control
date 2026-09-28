import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

// 목록 필터를 URL 쿼리에 둔다(새로고침·뒤로가기·링크 공유 시 유지). 필터를 바꾸면 페이지는 1로 돌아간다.
export function useUrlFilters() {
  const [params, setParams] = useSearchParams()

  const get = useCallback((key: string) => params.get(key) ?? '', [params])

  const set = useCallback(
    (changes: Record<string, string | undefined>, options: { keepPage?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          if (!options.keepPage && !('page' in changes)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return { params, get, set }
}
