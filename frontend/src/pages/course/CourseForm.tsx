import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { ManagerCandidate } from '../../api/types'
import { useApi } from '../../api/useApi'
import type { CourseFormValues } from './course-model'

type Errors = Partial<Record<keyof CourseFormValues | 'reason' | 'form', string>>

// 서버 오류 field(snake_case) → 폼 필드
const FIELD_MAP: Record<string, keyof CourseFormValues> = {
  course_name: 'courseName',
  start_date: 'startDate',
  end_date: 'endDate',
  total_hours: 'totalHours',
  training_site: 'trainingSite',
  manager_user_id: 'managerUserId',
}

// S16 등록·수정 폼. 상태는 폼에서 바꾸지 않고 상세 화면의 전환 버튼으로만 바꾼다(baseline 3-1 전이 규칙).
// 수정 시에는 변경한 필드만 보내고, 사유(선택)를 함께 남길 수 있다.
export function CourseForm({
  initial,
  mode,
  onSubmit,
  onCancel,
  currentManager,
}: {
  initial: CourseFormValues
  mode: 'create' | 'edit'
  /** 수정 시 현재 담당자. 비활성화 등으로 후보 목록에 없어도 선택지에 남겨 둔다 */
  currentManager?: ManagerCandidate
  onSubmit: (body: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState(initial)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)
  const managers = useApi((signal) => api.get<{ items: ManagerCandidate[] }>('/courses/manager-candidates', undefined, signal), 'managers')

  // 오류 문구는 라벨 밖에 두고 aria-describedby 로 연결한다(라벨 안에 두면 입력칸 이름에 섞인다)
  const field = (key: keyof CourseFormValues) => ({
    id: `course-${key}`,
    value: values[key],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `course-${key}-error` : undefined,
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next = validate(values)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    const payload: Record<string, unknown> = {
      course_name: values.courseName.trim(),
      start_date: values.startDate,
      end_date: values.endDate,
      total_hours: Number(values.totalHours),
      training_site: values.trainingSite.trim(),
      manager_user_id: Number(values.managerUserId),
    }
    const body = mode === 'create' ? payload : changedOnly(payload, initial)
    if (mode === 'edit') {
      if (Object.keys(body).length === 0) return setErrors({ form: '변경한 내용이 없습니다.' })
      if (reason.trim()) body.reason = reason.trim()
    }
    setSubmitting(true)
    try {
      await onSubmit(body)
    } catch (e) {
      if (e instanceof ApiError && e.field && FIELD_MAP[e.field]) setErrors({ [FIELD_MAP[e.field]]: e.message })
      else if (e instanceof ApiError && e.code === 'INVALID_DATE_RANGE') setErrors({ endDate: e.message })
      else setErrors({ form: e instanceof ApiError ? e.message : '저장하지 못했습니다.' })
    } finally {
      setSubmitting(false)
    }
  }

  const error = (key: keyof Errors) =>
    errors[key] ? (
      <span id={`course-${key}-error`} className="field-error" role="alert">
        {errors[key]}
      </span>
    ) : null

  return (
    <form className="panel course-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="course-courseName">과정명</label>
        <input {...field('courseName')} maxLength={200} />
        {error('courseName')}
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="course-startDate">시작일</label>
          <input type="date" {...field('startDate')} />
          {error('startDate')}
        </div>
        <div className="field">
          <label htmlFor="course-endDate">종료일</label>
          <input type="date" {...field('endDate')} />
          {error('endDate')}
        </div>
        <div className="field">
          <label htmlFor="course-totalHours">총교육시간</label>
          <input type="number" min={1} step={1} {...field('totalHours')} />
          {error('totalHours')}
        </div>
      </div>
      <div className="field">
        <label htmlFor="course-trainingSite">교육장</label>
        <input {...field('trainingSite')} maxLength={200} />
        {error('trainingSite')}
      </div>
      <div className="field">
        <label htmlFor="course-managerUserId">담당자</label>
        <select {...field('managerUserId')}>
          <option value="">선택</option>
          {currentManager && !managers.data?.items.some((m) => m.userId === currentManager.userId) && (
            <option value={currentManager.userId}>{currentManager.name}(현재 담당자)</option>
          )}
          {managers.data?.items.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        {error('managerUserId')}
      </div>
      {mode === 'edit' && (
        <label>
          수정 사유(선택)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      )}
      {error('form')}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? '저장 중…' : mode === 'create' ? '등록' : '저장'}
        </button>
        <button type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  )
}

function validate(v: CourseFormValues): Errors {
  const errors: Errors = {}
  if (!v.courseName.trim()) errors.courseName = '과정명을 입력해 주세요.'
  if (!v.startDate) errors.startDate = '시작일을 입력해 주세요.'
  if (!v.endDate) errors.endDate = '종료일을 입력해 주세요.'
  else if (v.startDate && v.endDate < v.startDate) errors.endDate = '종료일은 시작일보다 빠를 수 없습니다.'
  if (!/^\d+$/.test(v.totalHours) || Number(v.totalHours) < 1) errors.totalHours = '1 이상의 정수로 입력해 주세요.'
  if (!v.trainingSite.trim()) errors.trainingSite = '교육장을 입력해 주세요.'
  if (!v.managerUserId) errors.managerUserId = '담당자를 선택해 주세요.'
  return errors
}

function changedOnly(payload: Record<string, unknown>, initial: CourseFormValues): Record<string, unknown> {
  const before: Record<string, unknown> = {
    course_name: initial.courseName,
    start_date: initial.startDate,
    end_date: initial.endDate,
    total_hours: Number(initial.totalHours),
    training_site: initial.trainingSite,
    manager_user_id: Number(initial.managerUserId),
  }
  return Object.fromEntries(Object.entries(payload).filter(([k, v]) => before[k] !== v))
}
