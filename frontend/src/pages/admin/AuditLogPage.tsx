import { useState } from 'react'
import { api } from '../../api/client'
import type { AuditLogDetail, AuditLogEntry, Paged, UserAccount } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { Pagination } from '../../components/Pagination'
import { formatDateTime, todayKst } from '../../format'
import { ACTOR_TYPE_LABELS, AUDIT_ACTION_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 50
const DEFAULT_DAYS = 30
// 감사 대상 테이블(backend audit-registry + 인증·조회 기록 대상)
const TABLES = [
  'course', 'class_schedule', 'trainee', 'trainee_enrollment', 'instructor', 'instructor_assignment', 'attendance', 'operation_log', 'course_issue',
  'verification_case', 'verification_case_trainee', 'submission', 'submission_review_log', 'attachment', 'user_account', 'user_role', 'role', 'role_permission',
  'detection_rule', 'audit_log',
]

const daysBefore = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// S27 감사로그(system-design 7-A, V9): 기간 필수 — 비워 두면 최근 30일을 기본으로 조회한다. 조회 자체도 감사로그(민감정보 조회)에 남는다.
// 행을 누르면 변경 전/후를 보여 준다. 시스템 관리자·관리자/책임자만.
export function AuditLogPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const today = todayKst()
  const from = get('from') || daysBefore(today, DEFAULT_DAYS)
  const to = get('to') || today
  const page = Number(get('page')) || 1
  const query = { from, to, actor_type: get('actor_type'), actor_user_id: get('actor_user_id'), target_table: get('target_table'), action: get('action'), page, size: PAGE_SIZE }
  const logs = useApi((signal) => api.get<Paged<AuditLogEntry>>('/audit-logs', query, signal), JSON.stringify(query))
  // 사용자 필터는 사용자 목록(S25) 권한이 있을 때만(시스템 관리자)
  const users = useApi(
    (signal) => (can('S25', 'R') ? api.getAll<UserAccount>('/users', {}, signal).then((r) => r.items) : Promise.resolve([] as UserAccount[])),
    'users',
  )
  const [openId, setOpenId] = useState<number | null>(null)
  const items = logs.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>감사로그</h1>
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          기간(부터)
          <input type="date" required value={from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          기간(까지)
          <input type="date" required value={to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label>
          행위자 구분
          <select value={get('actor_type')} onChange={(e) => set({ actor_type: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(ACTOR_TYPE_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
        {can('S25', 'R') && (
          <label>
            사용자
            <select value={get('actor_user_id')} onChange={(e) => set({ actor_user_id: e.target.value })}>
              <option value="">전체</option>
              {users.data?.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name}({u.loginId})
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          대상 테이블
          <select value={get('target_table')} onChange={(e) => set({ target_table: e.target.value })}>
            <option value="">전체</option>
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          액션
          <select value={get('action')} onChange={(e) => set({ action: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </form>
      <p className="hint">기간은 필수이며 최대 1년입니다(비우면 최근 {DEFAULT_DAYS}일). 이 화면의 조회도 감사로그에 기록됩니다.</p>

      {logs.status === 'error' && <ErrorText error={logs.error} onRetry={logs.reload} />}
      <div className={logs.status === 'loading' && logs.data ? 'panel is-refreshing' : 'panel'}>
        {!logs.data && logs.status === 'loading' ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 기록이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>작업일시</th>
                <th>사용자</th>
                <th>액션</th>
                <th>대상 테이블</th>
                <th className="num">대상ID</th>
                <th>IP</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.logId}>
                  <td>
                    <button type="button" className="button-link" onClick={() => setOpenId(l.logId)} aria-label={`기록 ${l.logId} 상세`}>
                      {formatDateTime(l.actionAt)}
                    </button>
                  </td>
                  <td>{actorText(l)}</td>
                  <td>{label(AUDIT_ACTION_LABELS, l.action)}</td>
                  <td>{l.targetTable}</td>
                  <td className="num">{l.targetId ?? '-'}</td>
                  <td>{l.ipAddress ?? '-'}</td>
                  <td className="wrap">{l.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {logs.data && logs.data.total > 0 && <Pagination page={logs.data.page} size={logs.data.size} total={logs.data.total} onChange={(p) => set({ page: String(p) })} />}
      {openId !== null && <AuditDetailDialog logId={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}

const actorText = (l: AuditLogEntry) =>
  l.actorType === 'USER' ? (l.actorName ? `${l.actorName}(${l.actorLoginId})` : l.actorUserId === null ? '(알 수 없는 계정)' : `#${l.actorUserId}`) : label(ACTOR_TYPE_LABELS, l.actorType)

// 변경 전/후: 필드 단위로 바뀐 값만 강조하고, 나머지 값은 그대로 보여 준다(마스킹·제외 대상은 기록 시점에 이미 가려져 있다)
function AuditDetailDialog({ logId, onClose }: { logId: number; onClose: () => void }) {
  const detail = useApi((signal) => api.get<AuditLogDetail>(`/audit-logs/${logId}`, undefined, signal), String(logId))
  const d = detail.data
  return (
    <Modal title={`감사로그 #${logId}`} onClose={onClose}>
      {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
      {!d && detail.status === 'loading' && <p className="muted">불러오는 중…</p>}
      {d && (
        <>
          <p className="muted">
            {formatDateTime(d.actionAt)} · {actorText(d)} · {label(AUDIT_ACTION_LABELS, d.action)} · {d.targetTable}
            {d.targetId !== null && ` #${d.targetId}`}
          </p>
          {d.reason && <p className="wrap">사유: {d.reason}</p>}
          <ValueDiff before={d.beforeValue} after={d.afterValue} />
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              닫기
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

const show = (v: unknown) => (v === undefined ? '' : v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function ValueDiff({ before, after }: { before: unknown; after: unknown }) {
  const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (before == null && after == null) return <p className="muted">변경 전/후 값이 없는 기록입니다.</p>
  // 객체(행 스냅샷)면 필드별 표, 그 외(권한 매트릭스 배열 등)는 원문 JSON
  if ((before == null || isRecord(before)) && (after == null || isRecord(after))) {
    const b = before ?? {}
    const a = after ?? {}
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
    return (
      <table className="compact diff-table">
        <thead>
          <tr>
            <th>필드</th>
            <th>변경 전</th>
            <th>변경 후</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const changed = show(b[k]) !== show(a[k])
            return (
              <tr key={k} className={changed ? 'changed' : undefined}>
                <th scope="row">{k}</th>
                <td className="wrap">{before == null ? '' : show(b[k])}</td>
                <td className="wrap">{after == null ? '' : show(a[k])}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }
  return (
    <div className="form-row">
      <div className="field">
        <strong>변경 전</strong>
        <pre className="json">{JSON.stringify(before, null, 2)}</pre>
      </div>
      <div className="field">
        <strong>변경 후</strong>
        <pre className="json">{JSON.stringify(after, null, 2)}</pre>
      </div>
    </div>
  )
}
