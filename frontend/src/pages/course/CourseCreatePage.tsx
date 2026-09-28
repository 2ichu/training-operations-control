import { useNavigate } from 'react-router'
import { api } from '../../api/client'
import type { CourseListItem } from '../../api/types'
import { CourseForm } from './CourseForm'
import { EMPTY_COURSE } from './course-model'

// S16 신규 과정 등록. 등록된 과정은 준비중(PREPARING)으로 시작한다(서버가 정함).
export function CourseCreatePage() {
  const navigate = useNavigate()
  return (
    <section className="page">
      <div className="page-header">
        <h1>신규 과정 등록</h1>
      </div>
      <CourseForm
        mode="create"
        initial={EMPTY_COURSE}
        onSubmit={async (body) => {
          const created = await api.post<CourseListItem>('/courses', body)
          navigate(`/courses/${created.courseId}`, { replace: true })
        }}
        onCancel={() => navigate('/courses')}
      />
    </section>
  )
}
