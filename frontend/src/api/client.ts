// 백엔드 API 호출 공통 래퍼. 세션은 httpOnly 쿠키라 JS 에서 다루지 않고 credentials 로만 전달한다.
// 개발 서버는 vite.config.ts 의 프록시로 /api 를 백엔드에 넘겨 같은 출처로 동작한다(쿠키 SameSite=Lax 유지).
export const API_BASE = '/api/v1'

// 백엔드 오류 응답 형식: { statusCode, code?, field?, message } (DomainExceptionFilter·Nest 기본 예외)
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly field?: string

  constructor(status: number, message: string, code?: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

type UnauthorizedListener = () => void
let onUnauthorized: UnauthorizedListener | null = null

/** 세션 만료(401) 시 호출할 처리를 등록한다. 로그인·세션 확인 요청 자체는 제외한다. */
export function setUnauthorizedListener(listener: UnauthorizedListener | null): void {
  onUnauthorized = listener
}

export type Query = Record<string, string | number | boolean | undefined | null>

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`
}

interface RequestOptions {
  query?: Query
  body?: unknown
  signal?: AbortSignal
  /** true 면 401 을 세션 만료로 취급하지 않는다(로그인 실패·최초 세션 확인) */
  skipUnauthorizedHandler?: boolean
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: 'same-origin',
      headers: options.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.')
  }

  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && !options.skipUnauthorizedHandler) onUnauthorized?.()
    throw toApiError(response.status, data)
  }
  return data as T
}

function toApiError(status: number, data: unknown): ApiError {
  const body = (data ?? {}) as { message?: unknown; code?: unknown; field?: unknown }
  // Nest 기본 검증 오류는 message 가 배열일 수 있다
  const raw = Array.isArray(body.message) ? body.message.join(', ') : body.message
  // 5xx 는 내부 메시지 대신 공통 안내를 보여준다(백엔드도 내부 오류 내용은 노출하지 않는다)
  const message = status < 500 && typeof raw === 'string' && raw.trim() ? raw : defaultMessage(status)
  return new ApiError(status, message, typeof body.code === 'string' ? body.code : undefined, typeof body.field === 'string' ? body.field : undefined)
}

function defaultMessage(status: number): string {
  if (status === 401) return '로그인이 필요합니다.'
  if (status === 403) return '이 작업을 수행할 권한이 없습니다.'
  if (status === 404) return '대상을 찾을 수 없습니다.'
  if (status >= 500) return '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
  return '요청을 처리할 수 없습니다.'
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
}
