import { describe, expect, it } from 'vitest'
import { mockApi } from '../test/mock-api'
import { api, FETCH_ALL_LIMIT } from './client'

// 250건을 페이지(최대 100)로 나눠 주는 목록 API 대역
const pagedRoute = (total: number) => (call: { query: URLSearchParams }) => {
  const page = Number(call.query.get('page'))
  const size = Number(call.query.get('size'))
  const from = (page - 1) * size
  const items = Array.from({ length: Math.max(Math.min(size, total - from), 0) }, (_, i) => ({ id: from + i + 1 }))
  return { status: 200, body: { items, page, size, total } }
}

describe('api.getAll', () => {
  it('첫 페이지로 전체 건수를 보고 나머지 페이지를 모두 모은다(조회 조건 유지)', async () => {
    const { calls } = mockApi({ 'GET /courses': pagedRoute(250) })
    const result = await api.getAll<{ id: number }>('/courses', { status: 'IN_PROGRESS' })
    expect(result).toMatchObject({ total: 250, truncated: false })
    expect(result.items.map((i) => i.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1))
    expect(calls.map((c) => c.query.get('page'))).toEqual(['1', '2', '3'])
    expect(calls.every((c) => c.query.get('size') === '100' && c.query.get('status') === 'IN_PROGRESS')).toBe(true)
  })

  it('안전 상한을 넘으면 상한까지만 가져오고 truncated 로 알린다', async () => {
    const { calls } = mockApi({ 'GET /schedules': pagedRoute(FETCH_ALL_LIMIT + 150) })
    const result = await api.getAll('/schedules')
    expect(result.items).toHaveLength(FETCH_ALL_LIMIT)
    expect(result.truncated).toBe(true)
    expect(calls).toHaveLength(FETCH_ALL_LIMIT / 100)
  })
})
