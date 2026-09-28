import type { VerificationCaseDetail } from '../../api/types'
import { formatDateTime } from '../../format'

// 탐지 근거(evidence.items)를 "무엇을 비교해 어떤 조건에 맞았는지" 사실 그대로 나열한다(system-design 8.4 — 해석·판단 문구 금지).
// 키 이름만 한글로 바꾸고 값은 원본을 보여준다. 알 수 없는 키는 키 이름 그대로 둔다.
const KEY_LABELS: Record<string, string> = {
  schedule_id: '회차',
  device_id: '기기 ID',
  channel: '출결 채널',
  trainee_ids: '관련 훈련생',
  trainee_id: '훈련생',
  event_count: '출결 건수',
  ended_at: '회차 종료 시각',
  elapsed_hours: '종료 후 경과(시간)',
  attendance_id: '출결 ID',
  log_id: '수정이력 ID',
  changed_at: '변경 시각',
  before: '변경 전',
  after: '변경 후',
}

export interface EvidenceField {
  label: string
  value: string
}

export function describeEvidence(detail: VerificationCaseDetail): EvidenceField[][] {
  const schedules = new Map(detail.schedules.map((s) => [s.scheduleId, `${s.roundNo}회차 (${s.classDate})`]))
  const trainees = new Map(detail.trainees.map((t) => [t.traineeId, t.name]))
  const traineeName = (id: unknown) => (typeof id === 'number' ? (trainees.get(id) ?? `#${id}`) : String(id))

  return (detail.evidence.items ?? []).map((item) =>
    Object.entries(item)
      .filter(([key]) => key !== 'id') // 병합용 내부 식별자
      .map(([key, value]) => ({ label: KEY_LABELS[key] ?? key, value: formatValue(key, value, schedules, traineeName) })),
  )
}

function formatValue(key: string, value: unknown, schedules: Map<number, string>, traineeName: (id: unknown) => string): string {
  if (value === null || value === undefined) return '-'
  if (key === 'schedule_id' && typeof value === 'number') return schedules.get(value) ?? `#${value}`
  if (key === 'trainee_ids' && Array.isArray(value)) return value.map(traineeName).join(', ')
  if (key === 'trainee_id') return traineeName(value)
  if ((key === 'ended_at' || key === 'changed_at') && typeof value === 'string') return formatDateTime(value)
  if ((key === 'before' || key === 'after') && typeof value === 'object') return describeChange(value as Record<string, unknown>)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// attendance_change_log before/after 스냅샷: 바뀐 필드만 "필드=값" 으로 나열
function describeChange(snapshot: Record<string, unknown>): string {
  const entries = Object.entries(snapshot)
  if (entries.length === 0) return '-'
  return entries.map(([k, v]) => `${k}=${v === null ? '없음' : String(v)}`).join(', ')
}
