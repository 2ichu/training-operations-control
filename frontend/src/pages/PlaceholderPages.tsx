import { Link } from 'react-router'

// 아직 구현하지 않은 화면. 메뉴·링크 구조는 먼저 잡아 두고, 화면은 이후 단계에서 채운다.
export function NotImplementedPage({ title }: { title: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="empty-text">이 화면은 아직 준비 중입니다.</p>
      <Link to="/">대시보드로 돌아가기</Link>
    </section>
  )
}

export function NotFoundPage() {
  return (
    <section className="page">
      <h1>페이지를 찾을 수 없습니다</h1>
      <Link to="/">대시보드로 돌아가기</Link>
    </section>
  )
}
