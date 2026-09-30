import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { AttendanceSummaryItem, TraineeCase, TraineeDetail, TraineeSubmission } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { CaseStatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../format'
import { ATTENDANCE_STATUS_LABELS, ENROLLMENT_STATUS_LABELS, label, REVIEW_STATUS_LABELS, RULE_LABELS, SUBMIT_STATUS_LABELS } from '../../labels'
import { NotFoundPage } from '../PlaceholderPages'

type Tab = 'enrollments' | 'attendance' | 'submissions' | 'cases'

// S05 훈련생 상세(system-design 7-A): 인적정보 요약 + 등록 건(과정) 선택 + 탭(등록이력 / 출결요약 / 결과물 / 확인필요 관련이력).
// 여러 과정에 등록된 경우 상단에서 등록 건을 골라 출결·결과물을 그 과정 기준으로 본다. 강사에게는 서버가 본인 과정 등록 건만 준다.
export function TraineeDetailPage() {
  const { id } = useParams()
  const traineeId = Number(id)
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('enrollments')
  const detail = useApi((signal) => api.get<TraineeDetail>(`/trainees/${traineeId}`, undefined, signal), String(traineeId))

  if (!Number.isInteger(traineeId) || traineeId <= 0) return <NotFoundPage />
  if (detail.status === 'error' && detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />

  const trainee = detail.data
  const enrollments = trainee?.enrollments ?? []
  const requested = Number(params.get('course_id'))
  const selected = enrollments.find((e) => e.courseId === requested) ?? enrollments[0]
  const tabs: { key: Tab; label: string }[] = [
    { key: 'enrollments', label: '등록이력' },
    { key: 'attendance', label: '출결요약' },
    { key: 'submissions', label: '결과물' },
    ...(can('S05', 'A') ? [{ key: 'cases' as const, label: '확인필요 관련이력' }] : []),
  ]

  return (
    <section className="page">
      <div className="page-header">
        <h1>{trainee ? trainee.name : '훈련생 상세'}</h1>
        <div className="toolbar">
          {can('S04', 'U') && trainee && (
            <Link className="button" to={`/trainees/${traineeId}/edit`}>
              정보 수정
            </Link>
          )}
          {can('S06', 'R') && (
            <Link className="button" to={`/trainee-change-logs?trainee_id=${traineeId}`}>
              변경이력 전체 보기
            </Link>
          )}
        </div>
      </div>
      {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
      {!trainee && detail.status === 'loading' && <Loading />}

      {trainee && (
        <>
          <section className="panel" aria-label="인적정보">
            <dl className="summary-grid">
              <div>
                <dt>생년월일</dt>
                <dd>{trainee.birthDate ?? '-'}</dd>
              </div>
              <div>
                <dt>연락처</dt>
                <dd>{trainee.contact ?? '-'}</dd>
              </div>
              <div>
                <dt>최초 등록</dt>
                <dd>{formatDateTime(trainee.registeredAt)}</dd>
              </div>
              <div>
                <dt>과정(등록 건)</dt>
                <dd>
                  {enrollments.length === 0 ? (
                    '-'
                  ) : enrollments.length === 1 ? (
                    <>
                      {selected.courseName} <span className="badge badge-neutral">{label(ENROLLMENT_STATUS_LABELS, selected.status)}</span>
                    </>
                  ) : (
                    <>
                      <select aria-label="과정 선택" value={selected.courseId} onChange={(e) => setParams({ course_id: e.target.value }, { replace: true })}>
                        {enrollments.map((e) => (
                          <option key={e.enrollmentId} value={e.courseId}>
                            {e.courseName} ({label(ENROLLMENT_STATUS_LABELS, e.status)})
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </dd>
              </div>
            </dl>
            {/* 원문 열람은 암호화 설계 후 도입(decisions.md P1-08) */}
            <p className="hint">연락처·생년월일은 일부만 표시합니다.</p>
          </section>

          <section className="panel">
            <div className="tabs" role="tablist" aria-label="훈련생 상세">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
              {tab === 'enrollments' &&
                (enrollments.length === 0 ? (
                  <EmptyText>볼 수 있는 등록 건이 없습니다.</EmptyText>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>과정</th>
                        <th>상태</th>
                        <th>신청일</th>
                        <th>확정일</th>
                        <th>취소 사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enrollments.map((e) => (
                        <tr key={e.enrollmentId}>
                          <td>{can('S16', 'R') ? <Link to={`/courses/${e.courseId}`}>{e.courseName}</Link> : e.courseName}</td>
                          <td>{label(ENROLLMENT_STATUS_LABELS, e.status)}</td>
                          <td>{formatDateTime(e.appliedAt)}</td>
                          <td>{formatDateTime(e.confirmedAt)}</td>
                          <td className="wrap">{e.cancelReason ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              {tab === 'attendance' && (selected ? <AttendanceTab traineeId={traineeId} courseId={selected.courseId} /> : <EmptyText>등록 건이 없습니다.</EmptyText>)}
              {tab === 'submissions' && (selected ? <SubmissionTab traineeId={traineeId} courseId={selected.courseId} /> : <EmptyText>등록 건이 없습니다.</EmptyText>)}
              {tab === 'cases' && <CaseTab traineeId={traineeId} />}
            </div>
          </section>
        </>
      )}
    </section>
  )
}

function AttendanceTab({ traineeId, courseId }: { traineeId: number; courseId: number }) {
  const { can } = useAuth()
  const result = useApi(
    (signal) => api.get<{ items: AttendanceSummaryItem[] }>(`/trainees/${traineeId}/attendance-summary`, { course_id: courseId }, signal),
    `${traineeId}:${courseId}`,
  )
  if (result.status === 'error') return <ErrorText error={result.error} onRetry={result.reload} />
  if (!result.data) return <Loading />
  if (result.data.items.length === 0) return <EmptyText>등록된 회차가 없습니다.</EmptyText>
  return (
    <>
    {can('S08', 'R') && (
      <p className="toolbar">
        <Link to={`/attendance/course?course_id=${courseId}`}>과정별 출결에서 보기</Link>
      </p>
    )}
    <table>
      <thead>
        <tr>
          <th>회차</th>
          <th>교육일</th>
          <th>입실</th>
          <th>퇴실</th>
          <th>출결상태</th>
        </tr>
      </thead>
      <tbody>
        {result.data.items.map((a) => (
          <tr key={a.scheduleId}>
            <td>{a.roundNo}회차</td>
            <td>{a.classDate}</td>
            <td>{formatDateTime(a.checkInTime)}</td>
            <td>{formatDateTime(a.checkOutTime)}</td>
            <td>
              {a.displayStatus === null ? (
                <span className="muted">휴강</span>
              ) : (
                <span className={a.displayStatus === 'NOT_CHECKED' ? 'badge badge-attention' : 'badge badge-neutral'}>{label(ATTENDANCE_STATUS_LABELS, a.displayStatus)}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  )
}

function SubmissionTab({ traineeId, courseId }: { traineeId: number; courseId: number }) {
  const { can } = useAuth()
  const result = useApi((signal) => api.get<{ items: TraineeSubmission[] }>(`/trainees/${traineeId}/submissions`, { course_id: courseId }, signal), `${traineeId}:${courseId}`)
  if (result.status === 'error') return <ErrorText error={result.error} onRetry={result.reload} />
  if (!result.data) return <Loading />
  if (result.data.items.length === 0) return <EmptyText>이 과정에 등록된 결과물이 없습니다.</EmptyText>
  return (
    <table>
      <thead>
        <tr>
          <th>제목</th>
          <th className="num">버전</th>
          <th>제출일시</th>
          <th>제출 상태</th>
          <th>검토 상태</th>
        </tr>
      </thead>
      <tbody>
        {result.data.items.map((s) => (
          <tr key={s.submissionId}>
            <td>{can('S21', 'R') ? <Link to={`/submissions/${s.submissionId}`}>{s.title}</Link> : s.title}</td>
            <td className="num">v{s.version}</td>
            <td>{formatDateTime(s.submittedAt)}</td>
            <td>{label(SUBMIT_STATUS_LABELS, s.submitStatus)}</td>
            <td>{label(REVIEW_STATUS_LABELS, s.reviewStatus)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// C3: verification_case_trainee 로 이 훈련생이 연결된 사건(모든 과정). OPS·EXEC·SYS 전용(S05:A)
function CaseTab({ traineeId }: { traineeId: number }) {
  const { can } = useAuth()
  const result = useApi((signal) => api.get<{ items: TraineeCase[] }>(`/trainees/${traineeId}/verification-cases`, undefined, signal), String(traineeId))
  if (result.status === 'error') return <ErrorText error={result.error} onRetry={result.reload} />
  if (!result.data) return <Loading />
  if (result.data.items.length === 0) return <EmptyText>이 훈련생과 관련된 확인 필요 건이 없습니다.</EmptyText>
  return (
    <table>
      <thead>
        <tr>
          <th>사건</th>
          <th>발생일시</th>
          <th>과정</th>
          <th>탐지유형</th>
          <th>상태</th>
          <th>종결일시</th>
        </tr>
      </thead>
      <tbody>
        {result.data.items.map((c) => (
          <tr key={c.caseId}>
            <td>{can('S23', 'R') ? <Link to={`/verification-cases/${c.caseId}`}>#{c.caseId}</Link> : `#${c.caseId}`}</td>
            <td>{formatDateTime(c.detectedAt)}</td>
            <td>{c.courseName}</td>
            <td>{label(RULE_LABELS, c.ruleCode)}</td>
            <td>
              <CaseStatusBadge status={c.status} />
            </td>
            <td>{formatDateTime(c.closedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
