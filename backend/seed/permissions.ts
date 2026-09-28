import type { RoleCode } from './roles.js';

import type { PermissionAction, PermissionScope } from '../src/rbac/rbac.types.js';

export type { PermissionAction, PermissionScope };

export interface PermissionSeed {
  roleCode: RoleCode;
  screenId: string;
  action: PermissionAction;
  scope: PermissionScope;
}

const grant = (
  roleCode: RoleCode,
  screens: string[],
  actions: PermissionAction[],
  scope: PermissionScope = 'ALL',
): PermissionSeed[] =>
  screens.flatMap((screenId) => actions.map((action) => ({ roleCode, screenId, action, scope })));

// Phase 1 대상 화면(S01~S06, S11~S16, S25~S27) + Phase 2 출결(S07~S10)·운영일지/특이사항(S17~S18)을
// baseline.md 4-2 매트릭스에서 화면×기능으로 옮겼다.
// hard delete 는 없으므로 D 는 부여하지 않는다(취소·비활성은 U).
// A(확인처리): 결석 확정(S07)과 확인/조치 계열(S18 확인 필요 전환, S22~S24 배정·상태전이) 전체에 재사용한다.
// 이 행위들은 모두 baseline 4-2 상 같은 화면의 다른 쓰기(C/U)와 권한 대상이 달라(예: EXECUTIVE 는 S18 수정·조치완료는
// 불가하지만 확인 필요 전환은 가능) C/U 로는 구분할 수 없어 A 로 분리했다(기술적 선택, 정책 아님).
// S18: INSTRUCTOR 의 조회 스코프는 다른 화면과 달리 "본인 등록 건"(reported_by=본인)이며, U 는 부여하지 않는다
// (수정·조치완료는 OPS_MANAGER 전용, 확인 필요 전환은 OPS_MANAGER·EXECUTIVE 만 — baseline 4-2).
// S22~S24: INSTRUCTOR 는 접근 불가(메뉴 미노출, baseline 4-2 "— (대시보드 요약만)") — 권한을 부여하지 않는 것으로 표현한다.
// S19~S21: 조회(제출현황·미제출, S20은 S19 API 재사용)는 SYS·OPS·EXEC 전체 + INSTRUCTOR 본인 배정 과정,
// 등록·재등록은 OPS 전용, 검토(S21)는 OPS만 쓰고 SYS·EXEC 는 읽기만, INSTRUCTOR 는 S21 전면 불가(baseline 4-2 "S21 접근 불가").
// 첨부 업로드/다운로드(POST /attachments, GET /attachments/{id}/download)는 SUBMISSION 만 지원해 S19 권한을 그대로 게이트로 쓴다.
// S16 종료 체크리스트(GET closure-checklist)는 baseline "OPS·SYS·EXEC" 전용이라 일반 조회(S16:R, INSTRUCTOR 도 보유)와
// 구분하기 위해 A 를 재사용한다(종료 자체는 기존 S16:U 그대로 — OPS 단독, D-06 확정).
// S05 "관련 확인 건"(GET /trainees/{id}/verification-cases)도 baseline "OPS·EXEC·SYS" 전용이라 같은 이유로 A 를 재사용한다
// (S05:R 은 INSTRUCTOR 도 보유 — 출결 요약·결과물 현황은 그대로 R, 확인 건만 별도).
export const PHASE1_PERMISSIONS: PermissionSeed[] = [
  // SYS_ADMIN: 업무 데이터 조회 전용 + 사용자·권한 관리 + 감사로그
  ...grant('SYS_ADMIN', ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S21', 'S22', 'S23', 'S24', 'S27'], ['R']),
  ...grant('SYS_ADMIN', ['S16', 'S05'], ['A']),
  ...grant('SYS_ADMIN', ['S25'], ['C', 'R', 'U']),
  ...grant('SYS_ADMIN', ['S26'], ['R', 'U']),
  // S28 탐지규칙 파라미터 관리(Phase 5): system-design STEP 8.4 "시스템 관리자가 detection_rule 화면에서 조정" — SYS_ADMIN 전용
  ...grant('SYS_ADMIN', ['S28'], ['R', 'U']),

  // OPS_MANAGER: 과정~일정 전체 업무 (전체 과정 접근, D-02)
  ...grant('OPS_MANAGER', ['S01', 'S03', 'S05', 'S06', 'S08', 'S10', 'S11', 'S14'], ['R']),
  ...grant('OPS_MANAGER', ['S02'], ['R', 'U']),
  ...grant('OPS_MANAGER', ['S04', 'S12', 'S13', 'S16'], ['C', 'R', 'U']),
  ...grant('OPS_MANAGER', ['S16'], ['A']), // 종료 체크리스트 조회
  ...grant('OPS_MANAGER', ['S05'], ['A']), // 관련 확인 건 조회

  ...grant('OPS_MANAGER', ['S07'], ['C', 'R', 'U', 'A']),
  ...grant('OPS_MANAGER', ['S09'], ['R', 'U']),
  ...grant('OPS_MANAGER', ['S15'], ['C', 'R']),
  ...grant('OPS_MANAGER', ['S17'], ['R', 'U']), // 작성은 강사만(검수 목적 수정만 O)
  ...grant('OPS_MANAGER', ['S18'], ['C', 'R', 'U', 'A']), // A=확인 필요로 전환(escalate)
  ...grant('OPS_MANAGER', ['S22', 'S23', 'S24'], ['R']),
  ...grant('OPS_MANAGER', ['S22', 'S23'], ['A']), // 담당자 배정·확인 시작·확인완료·조치기록·조치완료·재오픈
  ...grant('OPS_MANAGER', ['S19'], ['C', 'R', 'U']),
  ...grant('OPS_MANAGER', ['S21'], ['C', 'R']),

  // INSTRUCTOR: 본인 배정 범위 조회만(S07 은 입실·퇴실 확인까지, 결석 확정은 D-07 기본값상 불허)
  ...grant('INSTRUCTOR', ['S01', 'S03', 'S05', 'S08', 'S09', 'S11', 'S12', 'S13', 'S15', 'S16', 'S19'], ['R'], 'OWN_ASSIGNED'),
  ...grant('INSTRUCTOR', ['S07'], ['C', 'R', 'U'], 'OWN_ASSIGNED'),
  ...grant('INSTRUCTOR', ['S17'], ['C', 'R', 'U'], 'OWN_ASSIGNED'), // 본인 회차 작성·수정
  ...grant('INSTRUCTOR', ['S18'], ['C', 'R'], 'OWN_ASSIGNED'), // 등록은 본인 배정 과정, 조회는 본인 등록 건만(서비스에서 처리)

  // EXECUTIVE: 조회 전용 + 확인/조치 계열 처리(A, baseline 4-2)
  ...grant('EXECUTIVE', ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S21', 'S22', 'S23', 'S24', 'S27'], ['R']),
  ...grant('EXECUTIVE', ['S18'], ['A']), // 확인 필요로 전환(escalate)만, 수정·조치완료는 불가
  ...grant('EXECUTIVE', ['S22', 'S23'], ['A']),
  ...grant('EXECUTIVE', ['S16', 'S05'], ['A']), // 종료 체크리스트·관련 확인 건 조회
];
