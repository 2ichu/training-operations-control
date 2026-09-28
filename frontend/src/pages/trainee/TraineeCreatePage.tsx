import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { TraineeSearchResult } from '../../api/types'
import { useCourseOptions } from '../../api/useCourseOptions'
import { todayKst } from '../../format'

// 등록 가능한 과정: 종료·중단 제외(#21 임시 기본값 — 운영중 과정 중도 등록은 허용, 서버가 최종 판단)
const OPEN_STATUSES = ['PREPARING', 'RECRUITING', 'IN_PROGRESS']

type Step = { kind: 'person' } | { kind: 'choose'; matches: TraineeSearchResult[] } | { kind: 'enroll'; existing: TraineeSearchResult | null }

// S04 훈련생 등록(system-design 7-A): ① 성명·생년월일로 기존 인물을 먼저 찾고(중복 인물 생성 방지),
// ② 기존 인물을 고르거나 신규 인물로 진행해 ③ 과정 등록 건(신청 상태)을 만든다. 저장 후 훈련생 상세(S05)로 이동한다.
export function TraineeCreatePage() {
  const navigate = useNavigate()
  const courses = useCourseOptions(true, OPEN_STATUSES)
  const [step, setStep] = useState<Step>({ kind: 'person' })
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [contact, setContact] = useState('')
  const [courseId, setCourseId] = useState('')
  const [appliedDate, setAppliedDate] = useState(todayKst())
  const [error, setError] = useState<string | null>(null)
  const [existingLink, setExistingLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const searchPerson = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('성명을 입력해 주세요.')
    setBusy(true)
    setError(null)
    try {
      const result = await api.get<{ items: TraineeSearchResult[] }>('/trainees/search', { name: name.trim(), birth_date: birthDate || undefined })
      setStep(result.items.length > 0 ? { kind: 'choose', matches: result.items } : { kind: 'enroll', existing: null })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '검색하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (step.kind !== 'enroll') return
    if (!courseId) return setError('과정을 선택해 주세요.')
    setBusy(true)
    setError(null)
    setExistingLink(null)
    const body: Record<string, unknown> = { course_id: Number(courseId) }
    if (step.existing) body.trainee_id = step.existing.traineeId
    else body.trainee = { name: name.trim(), ...(birthDate ? { birth_date: birthDate } : {}), ...(contact.trim() ? { contact: contact.trim() } : {}) }
    // 신청일: 오늘이면 서버 시각을 쓰고, 다른 날짜면 그날 0시(KST)로 기록한다
    if (appliedDate && appliedDate !== todayKst()) body.applied_at = `${appliedDate}T00:00:00+09:00`
    try {
      const created = await api.post<{ trainee: { traineeId: number } }>('/enrollments', body)
      navigate(`/trainees/${created.trainee.traineeId}?course_id=${courseId}`, { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ENROLLMENT_EXISTS' && step.existing) setExistingLink(`/trainees/${step.existing.traineeId}?course_id=${courseId}`)
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>훈련생 등록</h1>
        <Link to="/enrollments">대상자 확인으로</Link>
      </div>

      {step.kind === 'person' && (
        <form className="panel course-form" onSubmit={searchPerson} noValidate>
          <h2>인적정보</h2>
          <p className="hint">같은 사람이 이미 있는지 먼저 확인합니다(성명 일치, 생년월일을 넣으면 함께 비교).</p>
          <div className="field">
            <label htmlFor="trainee-name">성명(필수)</label>
            <input id="trainee-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="trainee-birth">생년월일</label>
              <input id="trainee-birth" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="trainee-contact">연락처</label>
              <input id="trainee-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={50} />
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? '확인 중…' : '다음'}
            </button>
          </div>
        </form>
      )}

      {step.kind === 'choose' && (
        <section className="panel" aria-labelledby="matches-title">
          <h2 id="matches-title">같은 이름의 기존 훈련생이 있습니다</h2>
          <p className="hint">같은 사람이면 기존 훈련생을 선택해 새 과정에만 등록합니다. 다른 사람이면 신규로 등록하세요.</p>
          <table>
            <thead>
              <tr>
                <th>성명</th>
                <th>생년월일</th>
                <th>연락처</th>
                <th className="num">등록 건</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {step.matches.map((m) => (
                <tr key={m.traineeId}>
                  <td>
                    <Link to={`/trainees/${m.traineeId}`}>{m.name}</Link>
                  </td>
                  <td>{m.birthDate ?? '-'}</td>
                  <td>{m.contact ?? '-'}</td>
                  <td className="num">{m.enrollmentCount}</td>
                  <td>
                    <button type="button" onClick={() => setStep({ kind: 'enroll', existing: m })}>
                      이 훈련생으로 등록
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions">
            <button type="button" onClick={() => setStep({ kind: 'enroll', existing: null })}>
              다른 사람 — 신규 인물로 등록
            </button>
            <button type="button" onClick={() => setStep({ kind: 'person' })}>
              이전
            </button>
          </div>
        </section>
      )}

      {step.kind === 'enroll' && (
        <form className="panel course-form" onSubmit={save} noValidate>
          <h2>과정 등록</h2>
          <p className="notice">
            {step.existing ? `기존 훈련생 ${step.existing.name}(${step.existing.birthDate ?? '생년월일 없음'})을 새 과정에 등록합니다.` : `신규 인물 ${name.trim()}을(를) 등록합니다.`}
          </p>
          <div className="form-row">
            <div className="field">
              <label htmlFor="enroll-course">과정(필수)</label>
              <select id="enroll-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">선택</option>
                {courses.data?.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {c.courseName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="enroll-applied">신청일</label>
              <input id="enroll-applied" type="date" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} />
            </div>
          </div>
          <p className="hint">등록 건은 "신청" 상태로 만들어지며, 대상자 확인에서 확인 착수·확정합니다.</p>
          {error && (
            <p className="form-error" role="alert">
              {error} {existingLink && <Link to={existingLink}>기존 등록 건 보기</Link>}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" onClick={() => setStep({ kind: 'person' })}>
              이전
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
