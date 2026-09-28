import { useCallback, useEffect, useRef, useState } from 'react'

export type ApiResult<T> =
  | { status: 'loading'; data?: T }
  | { status: 'error'; error: Error; data?: T }
  | { status: 'success'; data: T }

interface Settled<T> {
  key: string
  data?: T
  error?: Error
}

// 조회 전용 훅. key(조회 조건을 직렬화한 문자열)가 바뀌면 이전 요청을 취소하고 다시 부른다.
// 로딩 여부는 "마지막으로 끝난 요청의 key 가 현재 key 와 다른가"로 계산하고, 재조회 중에는 직전 데이터를 유지해 화면이 깜빡이지 않게 한다.
export function useApi<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string): ApiResult<T> & { reload: () => void } {
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })
  const [nonce, setNonce] = useState(0)
  const requestKey = `${key}#${nonce}`
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetcherRef.current(controller.signal).then(
      (data) => setSettled({ key: requestKey, data }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setSettled((prev) => ({ key: requestKey, data: prev?.data, error: error instanceof Error ? error : new Error(String(error)) }))
      },
    )
    return () => controller.abort()
  }, [requestKey])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  if (!settled || settled.key !== requestKey) return { status: 'loading', data: settled?.data, reload }
  if (settled.error) return { status: 'error', error: settled.error, data: settled.data, reload }
  return { status: 'success', data: settled.data as T, reload }
}
