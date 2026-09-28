export function Pagination({ page, size, total, onChange }: { page: number; size: number; total: number; onChange: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size))
  return (
    <nav className="pagination" aria-label="페이지">
      <span className="muted">
        총 {total}건 · {page}/{last} 페이지
      </span>
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        이전
      </button>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= last}>
        다음
      </button>
    </nav>
  )
}
