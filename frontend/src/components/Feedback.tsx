import type { ReactNode } from 'react'

// 빈 상태·오류 안내는 텍스트로만 표시한다(빈 일러스트·그래프 금지 — system-design 7.1 예외 상황).
export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="empty-text">{children}</p>
}

export function ErrorText({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error-text" role="alert">
      <span>{error.message}</span>
      {onRetry && (
        <button type="button" className="button-link" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}
