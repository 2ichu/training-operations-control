import { Link } from 'react-router'
import type { ClosureItem } from '../../api/types'

const CLASSIFICATION_LABELS: Record<ClosureItem['classification'], string> = {
  BLOCKING: '필수 차단',
  WARNING: '경고 후 진행',
  NOT_NEEDED: '확인 불필요',
}

// 항목별 확인 화면(system-design S16 "각 항목 클릭 시 해당 화면으로 이동"). 8·9번은 이동할 화면이 없다.
function itemLink(item: number, courseId: number): string | null {
  const q = `course_id=${courseId}`
  switch (item) {
    case 1:
    case 2:
      return `/attendance/course?${q}`
    case 3:
      return `/verification-cases?${q}`
    case 4:
      return `/operation-logs?${q}`
    case 5:
      return `/submissions/missing?${q}`
    case 6:
      return `/submissions?${q}`
    case 7:
      return `/enrollments?${q}`
    default:
      return null
  }
}

// 종료 체크리스트(baseline 9절). 필수 차단 항목이 하나라도 있으면 종료할 수 없고, 경고 항목은 사유를 남기고 진행할 수 있다.
export function ClosureChecklistTable({ items, courseId }: { items: ClosureItem[]; courseId: number }) {
  return (
    <table>
      <thead>
        <tr>
          <th>항목</th>
          <th>분류</th>
          <th className="num">건수</th>
          <th>결과</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => {
          const link = itemLink(i.item, courseId)
          const flagged = i.classification !== 'NOT_NEEDED' && i.count > 0
          return (
            <tr key={i.item}>
              <td>{link && flagged ? <Link to={link}>{i.label}</Link> : i.label}</td>
              <td>{CLASSIFICATION_LABELS[i.classification]}</td>
              <td className="num">{i.classification === 'NOT_NEEDED' ? '-' : i.count}</td>
              <td>
                {i.classification === 'NOT_NEEDED' ? (
                  <span className="muted">검사 안 함</span>
                ) : !flagged ? (
                  <span className="badge badge-done">이상 없음</span>
                ) : i.classification === 'BLOCKING' ? (
                  <span className="badge badge-attention">종료 불가</span>
                ) : (
                  <span className="badge badge-neutral">사유 필요</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
