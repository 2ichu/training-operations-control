import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { CourseSummary, Paged, VerificationCaseListItem } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth, useCurrentUser } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { CaseStatusBadge } from '../../components/StatusBadge'
import { formatDateTime, formatTrainees } from '../../format'
import { ACTIVE_CASE_STATUSES, CASE_STATUS_LABELS, CASE_STATUS_ORDER, label, RULE_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 20
const RULE_CODES = ['RULE_01', 'RULE_02', 'RULE_03', 'RULE_04', 'RULE_05', 'RULE_06', 'MANUAL']

// S22 확인 필요 목록(system-design 7.2). 상태 필터 기본값은 진행중(미종결) 상태만이며, "전체"를 고르면 종결 건도 본다.
// 담당자 일괄지정: 배정 가능한 사용자 목록을 볼 수 있는 API 가 시스템 관리자(S25) 전용이라, 선택 건을 "나에게 배정"하는 형태로 제공한다.
export function VerificationCaseListPage() {
  const { can } = useAuth()
  const { user } = useCurrentUser()
  const { get, set } = useUrlFilters()
  const canAct = can('S22', 'A')
  const statusParam = get('status')
  const statuses = statusParam === 'ALL' ? [] : statusParam ? statusParam.split(',') : ACTIVE_CASE_STATUSES
  const page = Number(get('page')) || 1
  const query = {
    from: get('from'),
    to: get('to'),
    course_id: get('course_id'),
    trainee_name: get('trainee_name'),
    rule_code: get('rule_code'),
    status: statuses.join(','),
    assignee_id: get('mine') === '1' ? user.userId : undefined,
    page,
    size: PAGE_SIZE,
  }
  const list = useApi((signal) => api.get<Paged<VerificationCaseListItem>>('/verification-cases', query, signal), JSON.stringify(query))
  const courses = useApi((signal) => api.getAll<CourseSummary>('/courses', {}, signal), 'courses')
  const [traineeName, setTraineeName] = useState(get('trainee_name'))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const toggleStatus = (status: string) => {
    const next = statuses.includes(status) ? statuses.filter((s) => s !== status) : [...statuses, status]
    // 빈 선택은 "전체"로 취급한다(서버는 status 미지정 시 전 상태를 돌려준다)
    set({ status: next.length === 0 ? 'ALL' : sameSet(next, ACTIVE_CASE_STATUSES) ? undefined : next.join(',') })
  }

  const assignToMe = async () => {
    setMessage(null)
    try {
      const result = await api.post<{ updated: number; notFound: number[] }>('/verification-cases/assign', { case_ids: [...selected], assignee_id: user.userId })
      setMessage({ kind: 'ok', text: `${result.updated}건을 나에게 배정했습니다.` })
      setSelected(new Set())
      list.reload()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : '배정하지 못했습니다.' })
    }
  }

  const items = list.data?.items ?? []
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.caseId))

  return (
    <section className="page">
      <div className="page-header">
        <h1>확인 필요 목록</h1>
      </div>

      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ trainee_name: traineeName.trim() || undefined })
        }}
      >
        <label>
          발생일(부터)
          <input type="date" value={get('from')} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          발생일(까지)
          <input type="date" value={get('to')} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label>
          과정
          <select value={get('course_id')} onChange={(e) => set({ course_id: e.target.value })}>
            <option value="">전체</option>
            {courses.data?.items.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          탐지유형
          <select value={get('rule_code')} onChange={(e) => set({ rule_code: e.target.value })}>
            <option value="">전체</option>
            {RULE_CODES.map((code) => (
              <option key={code} value={code}>
                {label(RULE_LABELS, code)}
              </option>
            ))}
          </select>
        </label>
        <label>
          훈련생명
          <input value={traineeName} onChange={(e) => setTraineeName(e.target.value)} maxLength={100} />
        </label>
        <button type="submit">검색</button>
        <label className="checkbox">
          <input type="checkbox" checked={get('mine') === '1'} onChange={(e) => set({ mine: e.target.checked ? '1' : undefined })} />내 담당 건만
        </label>
      </form>

      <fieldset className="status-filter">
        <legend>상태</legend>
        {CASE_STATUS_ORDER.map((status) => (
          <label key={status} className="checkbox">
            <input type="checkbox" checked={statuses.includes(status)} onChange={() => toggleStatus(status)} />
            {label(CASE_STATUS_LABELS, status)}
          </label>
        ))}
        <button type="button" className="button-link" onClick={() => set({ status: undefined })}>
          진행중만
        </button>
        <button type="button" className="button-link" onClick={() => set({ status: 'ALL' })}>
          전체
        </button>
      </fieldset>

      {canAct && (
        <div className="toolbar">
          <button type="button" onClick={() => void assignToMe()} disabled={selected.size === 0}>
            선택 {selected.size}건 나에게 배정
          </button>
          {message && (
            <span className={message.kind === 'ok' ? 'muted' : 'form-error'} role={message.kind === 'error' ? 'alert' : 'status'}>
              {message.text}
            </span>
          )}
        </div>
      )}

      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className={list.status === 'loading' && list.data ? 'panel is-refreshing' : 'panel'}>
        {!list.data && list.status === 'loading' ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 확인 필요 건이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                {canAct && (
                  <th>
                    <input
                      type="checkbox"
                      aria-label="현재 페이지 전체 선택"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.caseId)))}
                    />
                  </th>
                )}
                <th>사건ID</th>
                <th>발생일시</th>
                <th>과정명</th>
                <th>관련 훈련생</th>
                <th>탐지유형</th>
                <th>우선순위</th>
                <th>상태</th>
                <th>담당자</th>
                <th>종결일시</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.caseId}>
                  {canAct && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`사건 ${c.caseId} 선택`}
                        checked={selected.has(c.caseId)}
                        onChange={() => setSelected((prev) => toggled(prev, c.caseId))}
                      />
                    </td>
                  )}
                  <td>
                    <Link to={`/verification-cases/${c.caseId}`}>#{c.caseId}</Link>
                  </td>
                  <td>{formatDateTime(c.detectedAt)}</td>
                  <td>{c.courseName}</td>
                  <td>{formatTrainees(c.trainees.map((t) => t.name))}</td>
                  <td>{label(RULE_LABELS, c.ruleCode)}</td>
                  <td>{c.priority ? '우선' : '일반'}</td>
                  <td>
                    <CaseStatusBadge status={c.status} />
                  </td>
                  <td>{c.assigneeName ?? '미지정'}</td>
                  <td>{formatDateTime(c.closedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data && list.data.total > 0 && <Pagination page={list.data.page} size={list.data.size} total={list.data.total} onChange={(p) => set({ page: String(p) }, { keepPage: true })} />}
    </section>
  )
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

function toggled(prev: Set<number>, id: number): Set<number> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
