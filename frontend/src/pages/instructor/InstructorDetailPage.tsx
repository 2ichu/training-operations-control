import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { InstructorDetail, InstructorUpdateResult } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { ErrorText, Loading } from '../../components/Feedback'
import { InstructorStatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../format'
import { label, USER_STATUS_LABELS } from '../../labels'
import { NotFoundPage } from '../PlaceholderPages'
import { InstructorForm } from './InstructorForm'

// S12 강사 상세(조회 모드) + 수정. 연결된 로그인 계정은 읽기전용으로만 보여준다(계정 관리는 S25).
// 강사 계정은 본인 정보만 볼 수 있다(타인은 서버가 404).
export function InstructorDetailPage() {
  const { id } = useParams()
  const instructorId = Number(id)
  const { can } = useAuth()
  const detail = useApi((signal) => api.get<InstructorDetail>(`/instructors/${instructorId}`, undefined, signal), String(instructorId))
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  if (!Number.isInteger(instructorId) || instructorId <= 0) return <NotFoundPage />
  if (detail.status === 'error' && detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />
  const instructor = detail.data

  return (
    <section className="page">
      <div className="page-header">
        <h1>{instructor ? instructor.name : '강사 상세'}</h1>
        {can('S11', 'R') && <Link to="/instructors">목록으로</Link>}
      </div>
      {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
      {!instructor && detail.status === 'loading' && <Loading />}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {instructor && editing && (
        <InstructorForm
          mode="edit"
          initial={{ name: instructor.name, contact: instructor.contact, status: instructor.status }}
          onSubmit={async (body) => {
            const result = await api.patch<InstructorUpdateResult>(`/instructors/${instructorId}`, body)
            const pending = result.warnings?.inProgressAssignmentCount ?? 0
            setEditing(false)
            setNotice(pending > 0 ? `저장했습니다. 진행 중인 과정의 배정 ${pending}건이 남아 있습니다 — 대체 강사 배정이 필요합니다.` : '저장했습니다.')
            detail.reload()
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {instructor && !editing && (
        <section className={detail.status === 'loading' ? 'panel is-refreshing' : 'panel'} aria-label="강사 정보">
          <dl className="summary-grid">
            <div>
              <dt>상태</dt>
              <dd>
                <InstructorStatusBadge status={instructor.status} />
              </dd>
            </div>
            <div>
              <dt>연락처</dt>
              <dd>{instructor.contact ?? '-'}</dd>
            </div>
            <div>
              <dt>등록일시</dt>
              <dd>{formatDateTime(instructor.createdAt)}</dd>
            </div>
            <div>
              <dt>최종 수정</dt>
              <dd>{formatDateTime(instructor.updatedAt)}</dd>
            </div>
            <div>
              <dt>연결 계정</dt>
              <dd>
                {instructor.linkedAccount
                  ? `${instructor.linkedAccount.loginId} (${instructor.linkedAccount.name}, ${label(USER_STATUS_LABELS, instructor.linkedAccount.status)})`
                  : '없음'}
              </dd>
            </div>
          </dl>
          {instructor.linkedAccount && <p className="hint">로그인 계정 정보는 여기서 바꿀 수 없습니다(시스템 관리 &gt; 사용자).</p>}
          <div className="toolbar">
            {can('S12', 'U') && (
              <button type="button" onClick={() => setEditing(true)}>
                수정
              </button>
            )}
            {can('S13', 'R') && <Link to={`/schedules?instructor_id=${instructorId}`}>강의 일정 보기</Link>}
            {can('S14', 'R') && <Link to={`/instructor-change-logs?instructor_id=${instructorId}`}>변경이력 보기</Link>}
          </div>
        </section>
      )}
    </section>
  )
}
