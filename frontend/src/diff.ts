import { formatDateTime } from './format'
import { ATTENDANCE_STATUS_LABELS, ENROLLMENT_STATUS_LABELS, label } from './labels'

// 변경이력 before/after 스냅샷에서 값이 달라진 필드만 뽑는다(system-design S06·S10 "필드 단위 diff"). 감사 컬럼은 제외한다.
// statusLabels: status 계열 필드의 표시명 사전(훈련생 등록 건 = 등록 상태, 출결 = 출결 상태)
const FIELD_LABELS: Record<string, string> = {
  name: '성명',
  birth_date: '생년월일',
  contact: '연락처',
  status: '상태',
  cancel_reason: '취소 사유',
  confirmed_at: '확정일시',
  confirmed_by: '확정자',
  course_id: '과정',
  applied_at: '신청일시',
  attendance_status: '출결상태',
  check_in_time: '입실',
  check_out_time: '퇴실',
}
const IGNORED = new Set(['created_at', 'created_by', 'updated_at', 'updated_by', 'last_modified_at'])

export interface FieldDiff {
  field: string
  label: string
  before: string
  after: string
}

export function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null, statusLabels: Record<string, string> = ENROLLMENT_STATUS_LABELS): FieldDiff[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const out: FieldDiff[] = []
  for (const key of keys) {
    if (IGNORED.has(key)) continue
    const b = before?.[key] ?? null
    const a = after?.[key] ?? null
    if (JSON.stringify(b) === JSON.stringify(a)) continue
    out.push({ field: key, label: FIELD_LABELS[key] ?? key, before: show(key, b, statusLabels), after: show(key, a, statusLabels) })
  }
  return out
}

function show(key: string, value: unknown, statusLabels: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '(없음)'
  if (key === 'status' && typeof value === 'string') return label(statusLabels, value)
  if (key === 'attendance_status' && typeof value === 'string') return label(ATTENDANCE_STATUS_LABELS, value)
  if ((key.endsWith('_at') || key.endsWith('_time')) && typeof value === 'string') return formatDateTime(value)
  // 로그에는 사용자 ID 만 남는다(이름은 당시 기준으로 기록되지 않음)
  if (key.endsWith('_by')) return `사용자 #${String(value)}`
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
