import { useRef, useState } from 'react'
import { ApiError, api, attachmentUrl } from '../../api/client'
import type { AttachmentInfo } from '../../api/types'
import { formatBytes, formatDateTime } from '../../format'

// 첨부 목록 + 추가(POST /attachments). 첨부는 추가만 가능하고 삭제·교체는 없다(attachment 는 append-only — DB 트리거).
// 다운로드는 서버가 부모 엔티티 조회 권한을 다시 확인하고 감사로그(VIEW_SENSITIVE)를 남긴다.
export function Attachments({
  items,
  entityType,
  entityId,
  canUpload,
  onUploaded,
}: {
  items: AttachmentInfo[]
  entityType: 'OPERATION_LOG' | 'COURSE_ISSUE'
  entityId: number
  canUpload: boolean
  onUploaded: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await api.upload(entityType, entityId, file)
      onUploaded()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '파일을 올리지 못했습니다.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <section aria-label="첨부파일" className="attachments">
      <h3>첨부파일</h3>
      {items.length === 0 ? (
        <p className="muted">첨부파일이 없습니다.</p>
      ) : (
        <ul>
          {items.map((a) => (
            <li key={a.attachmentId}>
              <a href={attachmentUrl(a.attachmentId)} download>
                {a.fileName}
              </a>{' '}
              <span className="muted">
                {formatBytes(a.fileSize)} · {formatDateTime(a.uploadedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <label className="stacked">
          첨부파일 추가(20MB 이하)
          <input ref={input} type="file" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      )}
      {busy && <p className="muted">올리는 중…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
