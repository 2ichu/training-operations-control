import { Link, useNavigate } from 'react-router'
import { api } from '../../api/client'
import type { InstructorListItem } from '../../api/types'
import { InstructorForm } from './InstructorForm'

// S12 강사 등록. 저장하면 상세로 이동한다.
export function InstructorCreatePage() {
  const navigate = useNavigate()
  return (
    <section className="page">
      <div className="page-header">
        <h1>강사 등록</h1>
        <Link to="/instructors">목록으로</Link>
      </div>
      <InstructorForm
        mode="create"
        onSubmit={async (body) => {
          const created = await api.post<InstructorListItem>('/instructors', body)
          navigate(`/instructors/${created.instructorId}`, { replace: true })
        }}
        onCancel={() => navigate('/instructors')}
      />
    </section>
  )
}
