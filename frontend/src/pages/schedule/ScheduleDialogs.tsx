import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { CourseDetail, ScheduleListItem, ScheduleWriteResult } from '../../api/types'
import { useApi } from '../../api/useApi'
import { Modal } from '../../components/Modal'
import { formatTime } from '../../format'
import { overlapMessage } from './schedule-model'

type Assignment = CourseDetail['instructorAssignments'][number]

/** 회차에 지정할 수 있는 강사: 유효 배정(과정 전체 또는 해당 회차)이 있는 강사(서버 ASSIGNMENT_REQUIRED 와 같은 기준) */
function eligibleInstructors(assignments: Assignment[], roundNo: number | null) {
  const map = new Map<number, string>()
  for (const a of assignments) {
    if (a.status === 'ASSIGNED' && (a.roundNo === null || a.roundNo === roundNo)) map.set(a.instructorId, a.instructorName)
  }
  return [...map].map(([instructorId, name]) => ({ instructorId, name }))
}

function useSubmit(onDone: (message: string) => void) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    try {
      onDone(await action())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }
  return { error, busy, run, setError }
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}

// 신규 회차 추가: class_schedule INSERT. 강사는 배정된 강사 중에서만 고른다(system-design STEP 4.1 절차 5).
export function ScheduleCreateDialog({ course, onClose, onSaved }: { course: CourseDetail; onClose: () => void; onSaved: (message: string) => void }) {
  const nextRound = course.schedules.reduce((max, s) => Math.max(max, s.roundNo), 0) + 1
  const [roundNo, setRoundNo] = useState(String(nextRound))
  const [classDate, setClassDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')
  const [instructorId, setInstructorId] = useState('')
  const [content, setContent] = useState('')
  const { error, busy, run, setError } = useSubmit(onSaved)
  const round = Number(roundNo)
  const instructors = eligibleInstructors(course.instructorAssignments, Number.isInteger(round) ? round : null)
  const selectedInstructor = instructors.some((i) => String(i.instructorId) === instructorId) ? instructorId : ''

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!Number.isInteger(round) || round < 1) return setError('회차는 1 이상의 정수로 입력해 주세요.')
    if (!classDate) return setError('교육일을 입력해 주세요.')
    if (!startTime || !endTime) return setError('시작·종료 시각을 입력해 주세요.')
    if (endTime <= startTime) return setError('종료 시각은 시작 시각보다 늦어야 합니다.')
    if (!selectedInstructor) return setError('강사를 선택해 주세요.')
    void run(async () => {
      const saved = await api.post<ScheduleWriteResult>(`/courses/${course.courseId}/schedules`, {
        round_no: round,
        class_date: classDate,
        start_time: startTime,
        end_time: endTime,
        instructor_id: Number(selectedInstructor),
        ...(content.trim() ? { content: content.trim() } : {}),
      })
      return `${round}회차를 추가했습니다.${overlapMessage(saved.warnings?.overlappingSchedules)}`
    })
  }

  return (
    <Modal title="회차 추가" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">{course.courseName}</p>
        <div className="form-row">
          <label className="stacked">
            회차
            <input type="number" min={1} value={roundNo} onChange={(e) => setRoundNo(e.target.value)} />
          </label>
          <label className="stacked">
            교육일
            <input type="date" value={classDate} onChange={(e) => setClassDate(e.target.value)} />
          </label>
          <label className="stacked">
            시작
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="stacked">
            종료
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <label className="stacked">
          강사
          <select value={selectedInstructor} onChange={(e) => setInstructorId(e.target.value)}>
            <option value="">선택</option>
            {instructors.map((i) => (
              <option key={i.instructorId} value={i.instructorId}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        {instructors.length === 0 && <p className="hint">이 회차에 지정할 수 있는 배정 강사가 없습니다. 먼저 강사 배정을 추가해 주세요.</p>}
        <label className="stacked">
          내용
          <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={500} rows={2} />
        </label>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 회차 수정: 일자·시간·내용만(PATCH /schedules/{id}). 강사 교체는 "강사 재배정", 휴강은 "휴강 처리"로 따로 한다.
export function ScheduleEditDialog({ schedule, onClose, onSaved }: { schedule: ScheduleListItem; onClose: () => void; onSaved: (message: string) => void }) {
  const [classDate, setClassDate] = useState(schedule.classDate)
  const [startTime, setStartTime] = useState(formatTime(schedule.startTime))
  const [endTime, setEndTime] = useState(formatTime(schedule.endTime))
  const [content, setContent] = useState(schedule.content ?? '')
  const [reason, setReason] = useState('')
  const { error, busy, run, setError } = useSubmit(onSaved)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const body: Record<string, unknown> = {}
    if (!classDate) return setError('교육일을 입력해 주세요.')
    if (endTime <= startTime) return setError('종료 시각은 시작 시각보다 늦어야 합니다.')
    if (classDate !== schedule.classDate) body.class_date = classDate
    if (startTime !== formatTime(schedule.startTime)) body.start_time = startTime
    if (endTime !== formatTime(schedule.endTime)) body.end_time = endTime
    if (content.trim() !== (schedule.content ?? '')) body.content = content.trim() || null
    if (Object.keys(body).length === 0) return setError('변경한 내용이 없습니다.')
    if (reason.trim()) body.reason = reason.trim()
    void run(async () => {
      const saved = await api.patch<ScheduleWriteResult>(`/schedules/${schedule.scheduleId}`, body)
      return `${schedule.roundNo}회차를 수정했습니다.${overlapMessage(saved.warnings?.overlappingSchedules)}`
    })
  }

  return (
    <Modal title="회차 수정" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">
          {schedule.courseName} {schedule.roundNo}회차 · {schedule.instructorName}
        </p>
        <div className="form-row">
          <label className="stacked">
            교육일
            <input type="date" value={classDate} onChange={(e) => setClassDate(e.target.value)} />
          </label>
          <label className="stacked">
            시작
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="stacked">
            종료
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <label className="stacked">
          내용
          <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={500} rows={2} />
        </label>
        <label className="stacked">
          수정 사유(선택)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 휴강 처리: 사유 필수, 되돌릴 수 없다. 휴강 회차는 출결 입력(S07)이 막히고 운영기록 탐지(RULE_03·04)에서 빠진다.
export function CancelClassDialog({ schedule, onClose, onSaved }: { schedule: ScheduleListItem; onClose: () => void; onSaved: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const { error, busy, run, setError } = useSubmit(onSaved)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim()) return setError('휴강 사유를 입력해 주세요.')
    void run(async () => {
      await api.post(`/schedules/${schedule.scheduleId}/cancel-class`, { reason: reason.trim() })
      return `${schedule.roundNo}회차를 휴강 처리했습니다.`
    })
  }
  return (
    <Modal title="휴강 처리" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>
          {schedule.courseName} {schedule.roundNo}회차({schedule.classDate} {formatTime(schedule.startTime)}~{formatTime(schedule.endTime)})를 휴강 처리합니다.
        </p>
        <p className="hint">휴강은 되돌릴 수 없으며, 이 회차의 출결은 기록하지 않습니다.</p>
        <label className="stacked">
          휴강 사유(필수)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '처리 중…' : '휴강 처리'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 강사 재배정(P1-06): 회차의 담당 강사만 교체한다. 새 강사에게 그 과정(또는 회차)의 유효 배정이 있어야 한다.
export function ReassignDialog({ schedule, onClose, onSaved }: { schedule: ScheduleListItem; onClose: () => void; onSaved: (message: string) => void }) {
  const course = useApi((signal) => api.get<CourseDetail>(`/courses/${schedule.courseId}`, undefined, signal), String(schedule.courseId))
  const [instructorId, setInstructorId] = useState('')
  const [reason, setReason] = useState('')
  const { error, busy, run, setError } = useSubmit(onSaved)
  const candidates = eligibleInstructors(course.data?.instructorAssignments ?? [], schedule.roundNo).filter((i) => i.instructorId !== schedule.instructorId)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!instructorId) return setError('새 강사를 선택해 주세요.')
    if (!reason.trim()) return setError('재배정 사유를 입력해 주세요.')
    void run(async () => {
      const saved = await api.post<ScheduleWriteResult>(`/schedules/${schedule.scheduleId}/reassign-instructor`, { instructor_id: Number(instructorId), reason: reason.trim() })
      return `${schedule.roundNo}회차 강사를 바꿨습니다.${overlapMessage(saved.warnings?.overlappingSchedules)}`
    })
  }

  return (
    <Modal title="강사 재배정" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">
          {schedule.courseName} {schedule.roundNo}회차 · 현재 {schedule.instructorName}
        </p>
        {course.status === 'error' && <FormError error={course.error.message} />}
        <label className="stacked">
          새 강사
          <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)} disabled={!course.data}>
            <option value="">{course.data ? '선택' : '불러오는 중…'}</option>
            {candidates.map((i) => (
              <option key={i.instructorId} value={i.instructorId}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        {course.data && candidates.length === 0 && <p className="hint">바꿀 수 있는 배정 강사가 없습니다. 먼저 이 과정(또는 회차)에 강사를 배정해 주세요.</p>}
        <label className="stacked">
          재배정 사유(필수)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}
