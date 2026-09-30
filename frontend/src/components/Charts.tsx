// 대시보드용 최소 도식(라이브러리 없이 SVG·CSS). 색만으로 의미를 전달하지 않도록 값과 이름은 항상 옆 텍스트(범례·표)로 함께 표시하고,
// 도식 자체는 장식이라 aria-hidden 으로 둔다.
export interface Segment {
  key: string
  label: string
  value: number
  color: string
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

/** 반원 게이지(0~100%). 값과 이름은 가운데 텍스트로 함께 표시한다. */
export function Gauge({ value, label, color = '#5a9a6e', width = 200 }: { value: number; label: string; color?: string; width?: number }) {
  const stroke = 16
  const r = (width - stroke) / 2
  const h = r + stroke
  const clamped = Math.max(0, Math.min(1, value))
  const arc = Math.PI * r
  return (
    <svg className="gauge" width={width} height={h + 6} viewBox={`0 0 ${width} ${h + 6}`} aria-hidden="true">
      <path d={`M ${stroke / 2} ${h} A ${r} ${r} 0 0 1 ${width - stroke / 2} ${h}`} fill="none" stroke="var(--muted-bg)" strokeWidth={stroke} strokeLinecap="butt" />
      {clamped > 0 && <path d={`M ${stroke / 2} ${h} A ${r} ${r} 0 0 1 ${width - stroke / 2} ${h}`} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${arc * clamped} ${arc}`} />}
      <text x="50%" y={h - 26} textAnchor="middle" className="gauge-value">
        {Math.round(clamped * 100)}%
      </text>
      <text x="50%" y={h - 6} textAnchor="middle" className="gauge-label">
        {label}
      </text>
    </svg>
  )
}
