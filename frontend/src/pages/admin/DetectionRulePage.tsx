import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { AttendanceSetting, DetectionRule } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { CaseStatusBadge } from '../../components/StatusBadge'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { label, RULE_PARAM_LABELS } from '../../labels'

const PARAM_MIN = 1
const PARAM_MAX = 100000
const GRACE_MIN = 0
const GRACE_MAX = 240

// S28 탐지규칙(Phase 5, P5-01·02): 규칙별 기준값(params — 기존 키의 값만)과 사용 여부를 조정한다. 사유 필수, 감사로그 before/after.
// 초기 상태는 D-11 확정값이라 바꾸지 않고, MANUAL(특이사항 수동 전환용)은 수정할 수 없다. 바꾼 값은 다음 탐지 실행부터 적용된다.
// RULE_01·02 는 도입하지 않기로 했다(신뢰할 수 있는 단말 식별자 없음). 옛 배포에 행이 남아 있으면 "미도입"으로만 보이고 수정·활성화할 수 없다.
export function DetectionRulePage() {
  const { can } = useAuth()
  const rules = useApi((signal) => api.get<{ items: DetectionRule[] }>('/detection-rules', undefined, signal).then((r) => r.items), 'rules')
  const [editing, setEditing] = useState<DetectionRule | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const items = rules.data ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>탐지규칙</h1>
      </div>
      <p className="hint">기준값을 바꾸면 다음 탐지 실행부터 적용되며, 이미 만들어진 확인 필요 건은 바뀌지 않습니다.</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {rules.status === 'error' && <ErrorText error={rules.error} onRetry={rules.reload} />}
      <div className={rules.status === 'loading' && rules.data ? 'panel is-refreshing' : 'panel'}>
        {!rules.data && rules.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>탐지규칙이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>규칙</th>
                <th>설명</th>
                <th>기준값</th>
                <th>초기 상태</th>
                <th>사용</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.ruleId} className={r.isActive ? undefined : 'muted'}>
                  <td>
                    {r.ruleCode}
                    <br />
                    {r.ruleName}
                    {r.retired && (
                      <>
                        <br />
                        <span className="hint">도입하지 않은 규칙</span>
                      </>
                    )}
                  </td>
                  <td className="wrap">{r.description ?? ''}</td>
                  <td>
                    {Object.keys(r.params).length === 0 ? (
                      '-'
                    ) : (
                      <ul className="plain">
                        {Object.entries(r.params).map(([k, v]) => (
                          <li key={k}>
                            {label(RULE_PARAM_LABELS, k)}: <strong>{v}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <CaseStatusBadge status={r.initialStatus} />
                  </td>
                  <td>{r.isActive ? '사용' : '사용 안 함'}</td>
                  <td>
                    {r.editable && can('S28', 'U') ? (
                      <button type="button" className="button-link" onClick={() => setEditing(r)} aria-label={`${r.ruleCode} 수정`}>
                        수정
                      </button>
                    ) : !r.editable ? (
                      <span className="muted">{r.retired ? '미도입' : '수정 불가'}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <RuleDialog
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setNotice(`${editing.ruleCode} 설정을 저장했습니다. 다음 탐지 실행부터 적용됩니다.`)
            setEditing(null)
            rules.reload()
          }}
        />
      )}
      <AttendanceGraceSection />
    </section>
  )
}

// D-08 확정(자동 판정, 유예 10분): 입실 시각 > 시작 + 지각 유예분 → 지각, 퇴실 시각 < 종료 − 조퇴 유예분 → 조퇴.
// 바꾼 값은 이후 입실·퇴실 확인부터 적용되고, 이미 기록된 출결 상태는 다시 판정하지 않는다(정정은 S09).
function AttendanceGraceSection() {
  const { can } = useAuth()
  const setting = useApi((signal) => api.get<AttendanceSetting>('/attendance-settings', undefined, signal), 'attendance-settings')
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const data = setting.data

  return (
    <>
      <h2>지각·조퇴 판정 기준</h2>
      <p className="hint">입실·퇴실 확인을 저장할 때 자동으로 판정합니다. 지각한 훈련생이 일찍 퇴실하면 지각으로 남습니다. 바꾼 값은 이후 기록부터 적용되며, 이미 기록된 출결은 바뀌지 않습니다(필요하면 출결 수정 화면에서 정정).</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {setting.status === 'error' && <ErrorText error={setting.error} onRetry={setting.reload} />}
      <div className="panel">
        {!data ? (
          <Loading />
        ) : (
          <dl className="summary-grid">
            <dt>지각 유예</dt>
            <dd>
              {data.lateGraceMinutes}분 (시작 {data.lateGraceMinutes}분 초과 입실 → 지각)
            </dd>
            <dt>조퇴 유예</dt>
            <dd>
              {data.earlyLeaveGraceMinutes}분 (종료 {data.earlyLeaveGraceMinutes}분 전보다 이른 퇴실 → 조퇴)
            </dd>
          </dl>
        )}
        {data && can('S28', 'U') && (
          <div className="form-actions">
            <button type="button" onClick={() => setEditing(true)}>
              판정 기준 수정
            </button>
          </div>
        )}
      </div>
      {editing && data && (
        <GraceDialog
          setting={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setNotice('판정 기준을 저장했습니다. 이후 입실·퇴실 확인부터 적용됩니다.')
            setEditing(false)
            setting.reload()
          }}
        />
      )}
    </>
  )
}

function GraceDialog({ setting, onClose, onSaved }: { setting: AttendanceSetting; onClose: () => void; onSaved: () => void }) {
  const [late, setLate] = useState(String(setting.lateGraceMinutes))
  const [early, setEarly] = useState(String(setting.earlyLeaveGraceMinutes))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const body: Record<string, unknown> = {}
    for (const [key, text, raw, current] of [
      ['late_grace_minutes', '지각 유예', late, setting.lateGraceMinutes],
      ['early_leave_grace_minutes', '조퇴 유예', early, setting.earlyLeaveGraceMinutes],
    ] as const) {
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isInteger(n) || n < GRACE_MIN || n > GRACE_MAX) return setError(`${text}는 ${GRACE_MIN}~${GRACE_MAX} 사이의 정수(분)여야 합니다.`)
      if (n !== current) body[key] = n
    }
    if (Object.keys(body).length === 0) return setError('변경한 내용이 없습니다.')
    if (!reason.trim()) return setError('변경 사유를 입력해 주세요.')
    body.reason = reason.trim()
    setBusy(true)
    setError(null)
    try {
      await api.patch('/attendance-settings', body)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <Modal title="지각·조퇴 판정 기준 수정" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-row">
          <label className="stacked">
            지각 유예(분)
            <input type="number" min={GRACE_MIN} max={GRACE_MAX} value={late} onChange={(e) => setLate(e.target.value)} />
          </label>
          <label className="stacked">
            조퇴 유예(분)
            <input type="number" min={GRACE_MIN} max={GRACE_MAX} value={early} onChange={(e) => setEarly(e.target.value)} />
          </label>
        </div>
        <label className="stacked">
          변경 사유(필수)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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

function RuleDialog({ rule, onClose, onSaved }: { rule: DetectionRule; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(rule.params).map(([k, v]) => [k, String(v)])))
  const [isActive, setIsActive] = useState(rule.isActive)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const params: Record<string, number> = {}
    for (const [key, raw] of Object.entries(values)) {
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isInteger(n) || n < PARAM_MIN || n > PARAM_MAX) return setError(`${label(RULE_PARAM_LABELS, key)}는 ${PARAM_MIN}~${PARAM_MAX} 사이의 정수여야 합니다.`)
      if (n !== rule.params[key]) params[key] = n
    }
    const body: Record<string, unknown> = {}
    if (Object.keys(params).length > 0) body.params = params
    if (isActive !== rule.isActive) body.is_active = isActive
    if (Object.keys(body).length === 0) return setError('변경한 내용이 없습니다.')
    if (!reason.trim()) return setError('변경 사유를 입력해 주세요.')
    body.reason = reason.trim()
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/detection-rules/${rule.ruleId}`, body)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <Modal title={`${rule.ruleCode} 수정`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">
          {rule.ruleName} — {rule.description}
        </p>
        <div className="form-row">
          {Object.keys(rule.params).map((key) => (
            <label key={key} className="stacked">
              {label(RULE_PARAM_LABELS, key)}
              <input type="number" min={PARAM_MIN} max={PARAM_MAX} value={values[key]} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
            </label>
          ))}
        </div>
        <label className="checkbox-inline">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> 이 규칙 사용
        </label>
        {rule.isActive && !isActive && <p className="hint">사용을 끄면 이 규칙으로는 새 확인 필요 건이 생기지 않습니다.</p>}
        <label className="stacked">
          변경 사유(필수)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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
