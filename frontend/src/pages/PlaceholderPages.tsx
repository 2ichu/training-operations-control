import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="page">
      <h1>페이지를 찾을 수 없습니다</h1>
      <Link to="/">대시보드로 돌아가기</Link>
    </section>
  )
}
