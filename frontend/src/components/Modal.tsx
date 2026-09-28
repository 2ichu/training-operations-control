import { type ReactNode, useEffect, useRef } from 'react'

// 확인·사유 입력용 모달. Esc 로 닫히고, 열리면 첫 입력 요소로 초점을 옮긴다.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // 열릴 때 한 번만: 초점 이동·Esc 등록, 닫힐 때 원래 초점 복원
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('textarea, input, select, button')
    first?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
