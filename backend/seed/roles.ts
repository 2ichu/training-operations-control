// baseline.md 2.1·3-8: 4개 역할 고정 (커스텀 역할 없음)
export const ROLES = [
  { roleCode: 'SYS_ADMIN', roleName: '시스템 관리자' },
  { roleCode: 'OPS_MANAGER', roleName: '과정 운영 담당자' },
  { roleCode: 'INSTRUCTOR', roleName: '강사' },
  { roleCode: 'EXECUTIVE', roleName: '관리자/책임자' },
] as const;

export type RoleCode = (typeof ROLES)[number]['roleCode'];
