import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { CourseIssue, ScheduleListItem, TraineeListItem } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { Modal } from '../../components/Modal'
import { ISSUE_CATEGORY_LABELS } from '../../labels'

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

export interface RegisterInitial {
  courseId?: string
  scheduleId?: number
  content?: string
}

// S18 특이사항 등록/수정. 관련 회차는 선택(과정의 회차 중에서). 강사는 본인 배정 과정에만 등록할 수 있다(서버 스코프).
export function CourseIssueFormDialog({
  issue,
  initial,
  onClose,
  onSaved,
}: {
  /** 있으면 수정 모드 */
  issue?: CourseIssue
  initial?: RegisterInitial
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const courses = useCourseOptions(!issue)
  const [courseId, setCourseId] = useState(issue ? String(issue.courseId) : (initial?.courseId ?? ''))
  const [scheduleId, setScheduleId] = useState(issue?.scheduleId ? String(issue.scheduleId) : initial?.scheduleId ? String(initial.scheduleId) : '')
  const [category, setCategory] = useState(issue?.category ?? '')
  const [content, setContent] = useState(issue?.content ?? initial?.content ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const schedules = useApi(
    (signal) => (courseId ? api.getAll<ScheduleListItem>('/schedules', { course_id: courseId }, signal).then((r) => r.items) : Promise.resolve([] as ScheduleListItem[])),
    courseId,
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!courseId) return setError('과정을 선택해 주세요.')
    if (!category) return setError('카테고리를 선택해 주세요.')
    if (!content.trim()) return setError('내용을 입력해 주세요.')
    setBusy(true)
    setError(null)
    try {
      if (issue) {
        const body: Record<string, unknown> = {}
        if (category !== issue.category) body.category = category
        if (content.trim() !== issue.content) body.content = content.trim()
        const nextSchedule = scheduleId ? Number(scheduleId) : null
        if (nextSchedule !== issue.scheduleId) body.schedule_id = nextSchedule
        if (Object.keys(body).length === 0) {
          setBusy(false)
          return setError('변경한 내용이 없습니다.')
        }
        await api.patch(`/course-issues/${issue.issueId}`, body)
        onSaved('특이사항을 수정했습니다.')
      } else {
        await api.post('/course-issues', { course_id: Number(courseId), category, content: content.trim(), ...(scheduleId ? { schedule_id: Number(scheduleId) } : {}) })
        onSaved('특이사항을 등록했습니다.')
      }
    } catch (e) {
      setError(errorText(e, '저장하지 못했습니다.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={issue ? '특이사항 수정' : '특이사항 등록'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {issue ? (
          <p className="muted">{issue.courseName}</p>
        ) : (
          <label className="stacked">
            과정
            <select
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value)
                setScheduleId('')
              }}
            >
              <option value="">선택</option>
              {courses.data?.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.courseName}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-row">
          <label className="stacked">
            관련 회차(선택)
            <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} disabled={!courseId}>
              <option value="">없음</option>
              {schedules.data?.map((s) => (
                <option key={s.scheduleId} value={s.scheduleId}>
                  {s.roundNo}회차 ({s.classDate})
                </option>
              ))}
            </select>
          </label>
          <label className="stacked">
            카테고리
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">선택</option>
              {Object.entries(ISSUE_CATEGORY_LABELS).map(([code, text]) => (
                <option key={code} value={code}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="stacked">
          내용(필수)
          <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={4000} rows={4} />
        </label>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '저장 중…' : issue ? '저장' : '등록'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// "확인 필요로 전환"(STEP 8.3 수동 생성): verification_case(MANUAL)를 만들고 특이사항은 확인중이 된다(H6).
// 관련 훈련생은 선택 사항(C3). 만들고 나면 확인 필요 상세(S23)로 이동한다.
export function EscalateDialog({ issue, onClose, onExisting }: { issue: CourseIssue; onClose: () => void; onExisting: (message: string) => void }) {
  const navigate = useNavigate()
  const trainees = useApi(
    (signal) => api.getAll<TraineeListItem>('/trainees', { course_id: issue.courseId, status: 'CONFIRMED' }, signal).then((r) => r.items),
    String(issue.courseId),
  )
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await api.post<{ caseId: number }>(`/course-issues/${issue.issueId}/escalate`, { trainee_ids: [...selected] })
      navigate(`/verification-cases/${created.caseId}`)
    } catch (e) {
      // 이미 전환된 건: 새로 만들지 않고 기존 건으로 안내(STEP 8.4 중복 방지)
      if (e instanceof ApiError && e.code === 'VERIFICATION_CASE_EXISTS') return onExisting('이미 확인 필요로 전환된 특이사항입니다. 목록의 연결 확인 건에서 진행 상황을 확인해 주세요.')
      setError(errorText(e, '전환하지 못했습니다.'))
      setBusy(false)
    }
  }

  return (
    <Modal title="확인 필요로 전환" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>
          {issue.courseName}
          {issue.roundNo !== null && ` ${issue.roundNo}회차`} 특이사항을 확인 필요 건으로 만듭니다. 특이사항 상태는 확인중으로 바뀝니다.
        </p>
        <p className="wrap muted">{issue.content}</p>
        <fieldset className="radio-group checkbox-list">
          <legend>관련 훈련생(선택)</legend>
          {!trainees.data && <span className="muted">불러오는 중…</span>}
          {trainees.data?.length === 0 && <span className="muted">확정 훈련생이 없습니다.</span>}
          {trainees.data?.map((t) => (
            <label key={t.traineeId}>
              <input
                type="checkbox"
                checked={selected.has(t.traineeId)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(t.traineeId)) next.delete(t.traineeId)
                    else next.add(t.traineeId)
                    return next
                  })
                }
              />{' '}
              {t.name}
            </label>
          ))}
        </fieldset>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '전환 중…' : '전환'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 조치완료 처리: 특이사항만 닫는다. 연결된 확인 건 상태와는 독립(H6) — 확인 건은 S23 에서 따로 종결한다.
export function ResolveDialog({ issue, onClose, onSaved }: { issue: CourseIssue; onClose: () => void; onSaved: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post(`/course-issues/${issue.issueId}/resolve`)
      onSaved('특이사항을 조치완료 처리했습니다.')
    } catch (e) {
      setError(errorText(e, '처리하지 못했습니다.'))
      setBusy(false)
    }
  }
  return (
    <Modal title="조치완료 처리" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="wrap">{issue.content}</p>
        {issue.verificationCaseId !== null && <p className="hint">연결된 확인 건은 함께 종결되지 않습니다. 확인 건은 확인 필요 상세에서 따로 처리해 주세요.</p>}
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '처리 중…' : '조치완료'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}
