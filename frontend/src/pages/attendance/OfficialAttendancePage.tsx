import { type FormEvent, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { OfficialImportBatch, OfficialImportResult, OfficialImportRow } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { OFFICIAL_IMPORT_RESULT_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { formatDateTime } from '../../format'

// 업로드용 CSV 양식(머리글 + 예시 한 줄). 공식 출결시스템에서 받은 값을 이 형식으로 옮겨 올린다.
const TEMPLATE = 'round_no,trainee_name,birth_date,status,check_in,check_out\n1,홍길동,1990-01-31,출석,09:00,18:00\n'

// S29 공식 출결 대사(D-12 확정: CSV 파일 업로드). 내부 기록이 없으면 공식 값으로 기록하고, 내부 기록과 임계치 이내로 일치하면
// 공식으로 전환하며, 크게 다르면 내부 기록은 그대로 두고 확인 필요(RULE_07) 건을 만든다. 오류 행은 그 행만 반영되지 않는다.
export function OfficialAttendancePage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const courses = useCourseOptions(true, ['PREPARING', 'RECRUITING', 'IN_PROGRESS'])
  const history = useApi(
    (signal) => api.get<{ items: OfficialImportBatch[] }>('/official-attendance-imports', { course_id: courseId, size: 20 }, signal).then((r) => r.items),
    `history:${courseId}`,
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OfficialImportResult | null>(null)
  const [detail, setDetail] = useState<OfficialImportBatch | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!courseId) return setError('과정을 선택해 주세요.')
    if (!file) return setError('CSV 파일을 선택해 주세요.')
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      setResult(await api.postForm<OfficialImportResult>(`/courses/${courseId}/official-attendance`, form))
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      history.reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '업로드하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = '공식출결_업로드_양식.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>공식 출결 대사</h1>
      </div>
      <p className="hint">
        공식 출결 자료(CSV)를 올리면 내부 출결과 맞춰 봅니다. 내부 기록과 크게 다르면 내부 기록은 그대로 두고 확인 필요 건을 만듭니다. 종료·중단된 과정은 반영할 수 없습니다.
      </p>

      {can('S29', 'C') && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="filters">
            <label>
              과정(필수)
              <select value={courseId} onChange={(e) => set({ course_id: e.target.value })}>
                <option value="">선택</option>
                {courses.data?.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {c.courseName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CSV 파일(2MB·1,000행 이하)
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? '반영 중…' : '업로드·반영'}
            </button>
            <button type="button" className="button-link" onClick={downloadTemplate}>
              양식 내려받기
            </button>
          </div>
          <p className="hint">
            필수 열: round_no(회차), trainee_name(훈련생명), status(출석·지각·조퇴·결석·인정결석 또는 영문 코드). 선택 열: birth_date(생년월일 YYYY-MM-DD, 동명이인 구분용), check_in·check_out(HH:MM). 훈련생은 확정된 사람 중 이름(과 생년월일)으로 찾습니다.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {result && <ResultPanel result={result} />}

      <h2>업로드 이력</h2>
      {history.status === 'error' && <ErrorText error={history.error} onRetry={history.reload} />}
      <div className="panel">
        {!history.data && history.status === 'loading' ? (
          <p className="muted">불러오는 중…</p>
        ) : (history.data ?? []).length === 0 ? (
          <EmptyText>업로드 이력이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>일시</th>
                <th>과정</th>
                <th>파일</th>
                <th>올린 사람</th>
                <th className="num">행</th>
                <th className="num">반영</th>
                <th className="num">불일치</th>
                <th className="num">오류</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((b) => (
                <tr key={b.batchId}>
                  <td>{formatDateTime(b.receivedAt)}</td>
                  <td>{b.courseName}</td>
                  <td className="wrap">{b.fileName}</td>
                  <td>{b.uploadedByName}</td>
                  <td className="num">{b.total}</td>
                  <td className="num">{b.created + b.updated + b.converted}</td>
                  <td className="num">{b.mismatched}</td>
                  <td className="num">{b.errors}</td>
                  <td>
                    <button type="button" className="button-link" onClick={() => setDetail(b)} aria-label={`${b.fileName} 상세`}>
                      상세
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {detail && <BatchDialog batch={detail} onClose={() => setDetail(null)} />}
    </section>
  )
}

function ResultPanel({ result }: { result: OfficialImportResult }) {
  return (
    <div className="panel" role="status">
      <h2>{result.fileName} 반영 결과</h2>
      <ul className="plain">
        {Object.entries(result.counts).map(([code, n]) => (
          <li key={code}>
            {label(OFFICIAL_IMPORT_RESULT_LABELS, code)}: <strong>{n}</strong>행
          </li>
        ))}
      </ul>
      <RowTable rows={result.rows.filter((r) => r.result !== 'UNCHANGED')} />
      {result.rows.some((r) => r.result === 'UNCHANGED') && <p className="hint">변경 없음 {result.rows.filter((r) => r.result === 'UNCHANGED').length}행은 표에서 뺐습니다.</p>}
    </div>
  )
}

function RowTable({ rows }: { rows: OfficialImportRow[] }) {
  const { can } = useAuth()
  if (rows.length === 0) return <EmptyText>표시할 행이 없습니다.</EmptyText>
  return (
    <table>
      <thead>
        <tr>
          <th className="num">줄</th>
          <th>회차·훈련생</th>
          <th>결과</th>
          <th>내용</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rowNo} className={r.result === 'ERROR' ? 'muted' : undefined}>
            <td className="num">{r.rowNo}</td>
            <td>{[r.roundNo ? `${r.roundNo}회차` : null, r.traineeName].filter(Boolean).join(' ')}</td>
            <td>{label(OFFICIAL_IMPORT_RESULT_LABELS, r.result)}</td>
            <td className="wrap">{r.message}</td>
            <td>{r.caseId !== null && can('S23', 'R') ? <Link to={`/verification-cases/${r.caseId}`}>확인 필요 #{r.caseId}</Link> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BatchDialog({ batch, onClose }: { batch: OfficialImportBatch; onClose: () => void }) {
  const rows = useApi((signal) => api.get<{ items: OfficialImportRow[] }>(`/official-attendance-imports/${batch.batchId}`, undefined, signal).then((r) => r.items), batch.batchId)
  return (
    <Modal title={`${batch.fileName} 처리 내역`} onClose={onClose}>
      {rows.status === 'error' && <ErrorText error={rows.error} onRetry={rows.reload} />}
      {!rows.data ? <p className="muted">불러오는 중…</p> : <RowTable rows={rows.data} />}
      <div className="form-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
