// 표시 형식. 시각은 기관 기준 시간대(Asia/Seoul — decisions.md P1-20)로 보여준다.
const TIME_ZONE = 'Asia/Seoul'

const dateTimeFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** ISO 시각 → 'YYYY-MM-DD HH:mm' (KST) */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormat.format(date)
}

/** 'HH:mm:ss' → 'HH:mm' */
export const formatTime = (time: string | null | undefined): string => (time ? time.slice(0, 5) : '-')

/** 관련 훈련생 표시 규칙(system-design 7.2, C3): 0명 '-', 2명까지 이름 나열, 초과 시 '홍길동 외 N명' */
export function formatTrainees(names: string[]): string {
  if (names.length === 0) return '-'
  if (names.length <= 2) return names.join(', ')
  return `${names[0]} 외 ${names.length - 1}명`
}

const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** 오늘 날짜(KST) 'YYYY-MM-DD' */
export const todayKst = (now: Date = new Date()): string => dateFormat.format(now)

const inputFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** ISO 시각 → datetime-local 입력값(KST 'YYYY-MM-DDTHH:mm'). 없으면 '' */
export function toKstInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : inputFormat.format(date).replace(' ', 'T')
}

/** KST 날짜('YYYY-MM-DD')와 시각('HH:mm') 또는 datetime-local 값 → 서버로 보낼 ISO(+09:00) */
export const kstIso = (dateTime: string): string => `${dateTime.length === 16 ? dateTime : dateTime.slice(0, 16)}:00+09:00`

