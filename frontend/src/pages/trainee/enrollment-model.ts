export type EnrollmentAction = 'start-review' | 'confirm' | 'reject' | 'complete' | 'drop' | 'expel'

// baseline 3-2 전이표 + P1-04(수료·중도포기·제적은 확정 상태에서 사유와 함께 수동 처리, 최종 상태)
export const ENROLLMENT_ACTIONS: Record<EnrollmentAction, { label: string; field: 'reason' | 'cancel_reason'; required: boolean; note?: string }> = {
  'start-review': { label: '확인 착수', field: 'reason', required: false },
  confirm: { label: '확정', field: 'reason', required: false, note: '확정되면 출결·결과물 대상이 됩니다.' },
  reject: { label: '반려/취소', field: 'cancel_reason', required: true, note: '취소된 등록 건은 이력으로 남고, 재신청은 새 등록 건으로 합니다.' },
  complete: { label: '수료', field: 'reason', required: true, note: '수료·중도포기·제적은 되돌릴 수 없는 최종 상태입니다.' },
  drop: { label: '중도포기', field: 'reason', required: true, note: '수료·중도포기·제적은 되돌릴 수 없는 최종 상태입니다.' },
  expel: { label: '제적', field: 'reason', required: true, note: '수료·중도포기·제적은 되돌릴 수 없는 최종 상태입니다.' },
}

export const ACTIONS_BY_STATUS: Record<string, EnrollmentAction[]> = {
  APPLIED: ['start-review', 'reject'],
  REVIEWING: ['confirm', 'reject'],
  CONFIRMED: ['complete', 'drop', 'expel'],
}

// S02 상태 탭(system-design S02: 신청·서류확인중 기본 노출, 확정·취소는 별도 탭). 수료·중도포기·제적은 '종결' 탭으로 묶는다.
export const ENROLLMENT_TABS = [
  { key: 'review', label: '대상자 확인', statuses: ['APPLIED', 'REVIEWING'] },
  { key: 'confirmed', label: '확정', statuses: ['CONFIRMED'] },
  { key: 'finished', label: '수료·중도포기·제적', statuses: ['COMPLETED', 'DROPPED', 'EXPELLED'] },
  { key: 'cancelled', label: '취소', statuses: ['CANCELLED'] },
] as const
