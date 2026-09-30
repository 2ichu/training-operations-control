// 대시보드용 최소 도식(라이브러리 없이 SVG·CSS). 색만으로 의미를 전달하지 않도록 값과 이름은 항상 옆 텍스트(범례·표)로 함께 표시하고,
// 도식 자체는 장식이라 aria-hidden 으로 둔다.
export interface Segment {
  key: string
  label: string
  value: number
  color: string
}

export function Donut({ segments, centerValue, centerLabel, size = 132 }: { segments: Segment[]; centerValue: string | number; centerLabel: string; size?: number }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const stroke = 16
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted-bg)" strokeWidth={stroke} />
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (s.value / total) * c
            const el = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${c - Math.max(len - 1.5, 0.5)}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )
            offset += len
            return el
          })}
      <text x="50%" y="47%" textAnchor="middle" className="donut-value">
        {centerValue}
      </text>
      <text x="50%" y="63%" textAnchor="middle" className="donut-label">
        {centerLabel}
      </text>
    </svg>
  )
}

/** 표 셀 안에 넣는 가로 막대(값/최대값 비율). 값 자체는 옆 셀에 텍스트로 있다. */
export function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="bar" aria-hidden="true">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/** 하루 시간축(기본 08:00~19:00) 위의 구간 막대 */
export function TimeSpan({ start, end, from = 8, to = 19 }: { start: string; end: string; from?: number; to?: number }) {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const span = (to - from) * 60
  const left = Math.max(0, ((minutes(start) - from * 60) / span) * 100)
  const width = Math.max(2, Math.min(100 - left, ((minutes(end) - minutes(start)) / span) * 100))
  return (
    <div className="timespan" aria-hidden="true">
      <div className="timespan-fill" style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  )
}

/** 한 줄 누적 막대(구성비). 값이 0인 구간은 그리지 않는다. */
export function StackBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, x) => sum + x.value, 0)
  return (
    <div className="stackbar" aria-hidden="true">
      {total === 0 ? <span className="stackbar-empty" /> : segments.filter((x) => x.value > 0).map((x) => <span key={x.key} style={{ flex: x.value, background: x.color }} />)}
    </div>
  )
}
