# 훈련과정 통합관리 및 내부통제 시스템 설계안

> 코드 작성 이전 단계 산출물. 업무 프로세스 → 데이터 구조 → 화면 구조 → 기능 명세 → 개발 순서 순으로 정의한다.
> **개발 기준선**: 이 문서와 훈련과정 ERD(v5)가 Single Source of Truth이며, 개발자용 정리본(상태값 사전·권한 매트릭스·API 요구사항·규칙 표·감사·삭제·종료·보안 정책)은 [baseline.md](baseline.md)에 있다. 부록 B~D는 수정 전 감사 스냅샷이므로 현재 정의는 STEP 1~12와 부록 F를 따른다.
> 원칙: 이 시스템은 공식 출결체계를 대체하지 않으며, "확인 필요 사항"을 식별해 담당자 확인/조치를 지원하는 내부통제 도구다. 자동으로 부정행위/부정수급을 판정하지 않는다.

---

## STEP 1. 전체 업무 프로세스

### 1.1 메인 플로우 (End-to-End)

```
[과정 개설]
과정 등록(과정정보/기간/교육장/담당자)
   ↓
[대상자 확보]
훈련 대상자 등록(신청/모집명단 업로드) → 대상자 확인(자격/서류) → 훈련생 확정(입과)
   ↓
[운영 준비]
강사 배정(과정×회차 단위) → 교육일정 생성(회차별 일자/시간/강사/내용)
   ↓
[훈련 실시] (회차 단위로 반복)
당일 출결 확인(입실) → 교육 운영 → 운영일지 작성 → 당일 출결 확인(퇴실) → 특이사항 기록(있는 경우)
   ↓
[상시 모니터링] (배치/실시간, 병행 진행)
공식 출결정보 수집 ↔ 내부 운영정보 대조 → 규칙 기반 탐지 → "확인 필요" 이벤트 생성
   ↓
[확인 및 조치] (이벤트 발생 시)
담당자 확인 → 확인내용 기록 → (필요 시) 조치 → 조치내용 기록 → 처리 완료
   ↓
[결과물 관리] (과정 진행 중 ~ 종료 전)
결과물 제출 → 제출현황 확인 → 검토 → 검토결과 기록
   ↓
[과정 종료]
출결 미처리 건 확인 → 확인 필요 사항 잔여 건 확인 → 운영일지 완비 확인 → 결과물 제출/검토 완료 확인 → 과정 종료 처리
   ↓
[사후 관리]
변경이력 보관 / 감사로그 보관 (기간 내 조회 가능 상태 유지)
```

### 1.2 단계별 상세 (스윔레인)

각 단계를 행위자/입력/처리/출력/화면/테이블 관점에서 명세한다. P4(상시 모니터링)를 제외한 모든 단계는 사람의 화면 조작으로 시작되고, P4는 시스템이 자동으로 시작한다.

| 단계 | 트리거 | 주 행위자 | 입력 | 처리 내용 | 출력(상태 변화) | 관련 화면 | 관련 테이블 |
|---|---|---|---|---|---|---|---|
| P0 과정 개설 | 신규 과정 개설 필요 발생(외부 사업계획 확정 등) | 운영담당자 | 과정명/기간/교육시간/교육장/담당자 | 과정 등록 화면 입력·저장 | `course.status`: (신규)→준비중 | 과정 등록(S16) | course |
| P1 대상자 확보 | course.status = 준비중/모집중 | 운영담당자(등록·확인) | 명단 업로드 또는 개별 등록, 서류/자격 확인 결과 | 훈련생 신규 등록 또는 기존 훈련생의 신규 등록건 생성 → 서류확인 → 확정 처리 | `trainee_enrollment.status`: 신청→서류확인중→확정(또는 반려 시 취소) | 훈련생 등록(S04), 대상자 확인(S02) | trainee, trainee_enrollment, trainee_change_log |
| P2 운영 준비 | 확정 훈련생 1인 이상 존재 | 운영담당자 | 강사 선택, 회차별 일정 정보 | 강사 배정 생성, 회차별 교육일정 생성 | `instructor_assignment` 확정, `class_schedule` N건 생성, `course.status`: 준비중→운영중 | 강사 목록(S11), 교육일정(S13) | instructor_assignment, class_schedule, course |
| P3 훈련 실시 (회차 수만큼 반복) | class_schedule.class_date = 당일, status≠휴강 | 강사, 운영담당자 | 입실 확인, 교육 진행, 운영일지, 퇴실 확인, (당일 마감 시) 결석 확정 | 입실 이벤트 발생 시에만 `attendance` 신규 생성 → 교육 → 운영일지 작성 → 퇴실 기록 → 미확인자는 당일 마감 시 결석으로 확정 생성(C1) | `attendance`는 이벤트 발생분만 존재(미출결은 비저장 계산값), `operation_log` 생성 | 일일 출결(S07), 회차별 운영일지(S17) | attendance, operation_log, attachment |
| P4 상시 모니터링 (병행) | attendance/attendance_change_log/operation_log 변경, 또는 정기 배치 | 시스템(자동) | attendance, attendance_change_log, operation_log 데이터 | 탐지규칙 01~07 평가(class_schedule.status=휴강 회차는 제외) | 매칭 시 `verification_case` 신규 생성(상태=확인필요/우선확인) | (백엔드) → 대시보드(S01)/확인 필요 목록(S22)에 반영 | verification_case, detection_rule |
| P5 확인 및 조치 | verification_case 신규 생성(자동 탐지 또는 특이사항에서 담당자의 수동 전환, STEP 8.3) 또는 기존 건에 담당자 배정 | 운영담당자, 관리자/책임자 | 탐지근거 열람, 확인내용, 조치내용 | 상태 전이 처리 | `verification_case.status` 전이, `verification_action_log` 누적 | 확인 필요 목록(S22)/상세(S23) | verification_case, verification_action_log, audit_log |
| P6 결과물 관리 (병행) | 제출기한 도래 또는 훈련생 제출 행위 | 훈련생(제출), 운영담당자/강사(검토) | 제출 파일, 검토 결과 | 제출 등록 → 검토 처리 | `submission.review_status` 갱신 | 제출현황(S19), 검토(S21) | submission, submission_review_log |
| P7 과정 종료 | 종료일 도래 또는 종료 처리 시도 | 운영담당자 | 종료 체크리스트 확인 결과 | 미처리 출결/미종결 확인사항/미작성 운영일지/미완료 결과물 검증 후 종료 처리 | `course.status`: 운영중→종료 | 과정 상세(S16, 종료 체크리스트) | course, audit_log |

### 1.3 상태 전이 정의

핵심 엔티티 4종의 상태 머신을 명시적으로 정의한다. 모든 상태 전이는 `audit_log`에 자동 기록되며, 업무적으로 의미 있는 전이(훈련생 확정, 출결 상태 변경, 확인사항 종결 등)는 해당 엔티티의 변경이력 테이블에도 기록된다.

**course.status**

| 현재 상태 | 가능한 다음 상태 | 전이 조건 |
|---|---|---|
| 준비중 | 모집중, 운영중, 중단 | 모집중: 대상자 모집 시작 / 운영중: 첫 교육일 도래 또는 수동 전환 / 중단: 개설 취소 |
| 모집중 | 운영중, 중단 | 운영중: 확정 훈련생 존재 + 첫 교육일 도래 |
| 운영중 | 종료, 중단 | 종료: 종료 체크리스트 통과(STEP 4.6) / 중단: 예외 사유 입력 후 강제 중단 |
| 종료 / 중단 | (없음) | 최종 상태. 재오픈 불가(오등록 정정은 변경이력으로 별도 관리) |

**trainee_enrollment.status**

| 현재 상태 | 가능한 다음 상태 | 전이 조건 |
|---|---|---|
| 신청 | 서류확인중, 취소 | 서류확인중: 담당자 확인 착수 / 취소: 자격 미달·중복신청 등 |
| 서류확인중 | 확정, 취소 | 확정: 자격요건 충족 확인 완료 |
| 확정 | 수료, 중도포기, 제적 | 과정 종료 시점 출결/이수 기준 충족 여부에 따라 자동/수동 판정 |

**attendance.attendance_status** — [C1 반영, 아래 "출결 레코드 생성 원칙" 참고] `attendance` 레코드는 실제 출결 이벤트(입실/퇴실/결석 확정)가 발생할 때만 생성된다. 따라서 "레코드는 있지만 아직 상태가 안 정해진" 단계는 존재하지 않으며, 레코드가 아예 없는 상태는 상태값이 아니라 화면·API가 계산하는 **미출결**(비저장 값)로 표현한다.

| 현재 상태 | 가능한 다음 상태 | 전이 조건 |
|---|---|---|
| (레코드 없음 = 미출결, 비저장 계산값) | 출석, 지각, 결석 | 입실 확인 처리(공식/연계자동/내부수기) 시 `attendance` 신규 생성 → 출석 또는 지각으로 즉시 확정. 당일 마감까지 입실 확인이 없으면 담당자(또는 배치)가 결석으로 확정 생성 |
| 출석/지각 | 조퇴, (수정을 통한 재분류) | 조기 퇴실 확인 또는 담당자 수정 |
| 결석 | 인정결석, (수정을 통한 재분류) | 사유서 확인 후 담당자 수정 |
| 모든 상태(기존 레코드) | 임의 상태로 수정 가능 | 단, 반드시 `attendance_change_log` 기록 + 사유 필수. 규칙 05·06 탐지 대상. 최초 생성(미출결→출석/지각/결석)은 "수정"이 아니므로 `attendance_change_log` 대상이 아니다(STEP 9 참고) |

> **출결 레코드 생성 원칙(C1)**: `attendance`는 회차 생성이나 훈련생 배정만으로 미리 만들어지지 않는다. 오늘 출결 대상자 중 아직 이벤트가 없는 훈련생은 `trainee_enrollment`(확정)와 `class_schedule`(당일 회차)을 기준으로 화면·API가 그때그때 계산하는 "미출결"로만 표시되며, DB에는 아무 행도 없다. 이 원칙 덕분에 `source_type`을 NOT NULL로 유지해도 충돌이 없다 — 레코드가 생기는 시점에는 이미 출처(공식/연계자동/내부수기)가 확정돼 있기 때문이다.

**verification_case.status**

```
확인필요 ──┐
우선확인 ──┴─→ 확인중 ──┬─→ 확인완료 ──(재오픈)──→ 추가확인 ──→ 확인중
                        └─→ 조치필요 ──→ 조치완료 ──(재오픈)──→ 추가확인 ──→ 확인중
```

- 최초 생성 시 상태는 탐지규칙의 우선순위 설정에 따라 "확인필요" 또는 "우선확인"으로 결정된다.
- "확인완료"·"조치완료"는 종결 상태이나 삭제되지 않으며, 새로운 근거가 발견되면 "추가확인"으로 재오픈할 수 있다(재오픈 시 사유 입력 필수).

### 1.4 트리거 방식 (실시간 vs 배치)

탐지규칙과 상태 갱신은 발생 즉시 처리해야 하는 것과, 일정 시간 경과를 조건으로 하는 것으로 나뉜다.

| 처리 항목 | 방식 | 제안 주기/시점 |
|---|---|---|
| 규칙 01 동일 환경 복수 출결 | 실시간(이벤트 기반) | 출결 저장 트랜잭션 직후 즉시 평가 |
| 규칙 02 짧은 시간 내 복수 계정 출결 | 실시간(이벤트 기반) | 출결 저장 트랜잭션 직후 즉시 평가 |
| 규칙 03 회차 운영기록 지연 | 배치 | 매시 정각 스캔(회차 종료시각 + delay_hours 경과 회차 대상) |
| 규칙 04 퇴실정보 누락 | 배치 | 일 1회(야간, 예: 22:00) + 교육 종료 후 익일 오전 재확인 |
| 규칙 05 반복적인 출결 수정 | 배치 | 일 1회(수정 발생 누적 집계) |
| 규칙 06 출결상태 반복 변경 | 배치 | 일 1회 |
| 규칙 07 공식-내부 정보 불일치 | 배치(공식 데이터 수신 후) | 공식 출결 데이터 연동 주기에 종속(연동 방식 확정 후 결정 — STEP 12 참고). 상세 처리 흐름은 STEP 8.2 | 
| 특이사항 기반 확인 필요 수동 생성 | 실시간(사용자 액션) | 담당자가 특이사항 상세(S18)에서 "확인 필요로 전환" 클릭 시 즉시(자동 탐지 아님, STEP 8.3) |
| 감사로그 기록 | 실시간 | 모든 CUD 트랜잭션과 원자적으로 처리 |
| 과정 자동 상태 전환(준비중→운영중) | 배치 | 일 1회(자정 직후) class_schedule의 최소 class_date 확인 |

### 1.5 병행되는 지원 프로세스 (전 구간에 걸쳐 발생)

- **변경이력 기록**: 훈련생 정보·등록상태, 강사 정보·배정, 출결이 **수정**될 때마다 전용 `*_change_log`에 사유와 함께 발생(최초 생성은 제외). 과정·교육일정·운영일지·특이사항·결과물 등 그 외 데이터의 수정은 전용 이력 테이블을 두지 않고 `audit_log`의 before/after로 추적한다(베이스라인 확정)
- **감사로그 기록**: 시스템 내 모든 사용자 행위(생성/수정/삭제/조회 중 민감 조회 등)에 대해 자동 발생
- **권한 검증**: 모든 화면 진입 및 기능 실행 시 역할 기반 접근 제어(RBAC) 적용, 실패 시 403 처리(STEP 2.5 참고)

### 1.6 프로세스 설계 시 유의점

- "훈련 대상자"와 "훈련생"은 동일 인물(`trainee`)이며 별도 테이블로 구분하지 않는다. 상태는 인물 자체가 아니라 "특정 과정에 대한 등록 건"(`trainee_enrollment`)에 귀속되므로, 대상자 등록 → 확인 → 확정의 흐름은 `trainee_enrollment.status`의 전이로 표현한다(STEP 5.1 구조 수정 사항 참고).
- 출결 확인과 운영일지 작성은 강사/운영담당자 양쪽에서 발생할 수 있으므로 권한과 책임 소재를 화면 단위로 명확히 분리한다.
- 탐지 → 확인 → 조치는 하나의 이벤트 생명주기로 관리하며, 상태값은 반드시 중립적 표현을 사용한다.
- P3(훈련 실시)과 P4(상시 모니터링)는 동시에 진행되는 별도 프로세스다. P4는 P3의 산출물(출결·운영일지)을 입력으로만 사용하며 P3의 흐름을 막지 않는다(비동기 처리 원칙).

---

## STEP 2. 사용자 역할 및 권한

### 2.1 역할 정의

| 역할 | 코드 | 설명 |
|---|---|---|
| 시스템 관리자 | SYS_ADMIN | 시스템 자체의 관리자. 사용자/권한/설정/전체 데이터/감사로그 |
| 과정 운영 담당자 | OPS_MANAGER | 실무 담당자. 과정~결과물까지 일상 업무 전체 수행 |
| 강사 | INSTRUCTOR | 본인 담당 과정/일정에 한정된 입력 권한 |
| 관리자/책임자 | EXECUTIVE | 조회 및 확인/조치 승인 중심, 편집 권한은 제한적 |

### 2.2 권한 매트릭스 (메뉴 × 기능)

범례: C=생성, R=조회, U=수정, D=삭제, A=승인/확인처리, — =접근불가

| 메뉴/기능 | SYS_ADMIN | OPS_MANAGER | INSTRUCTOR | EXECUTIVE |
|---|---|---|---|---|
| 대시보드 | R | R(전체 과정, STEP 2.4) | R(본인 과정) | R(전체) |
| 과정 목록/상세/종료(S15·S16) | R | CRUD(종료·중단 포함) | R(본인 배정 과정) | R |
| 훈련생 목록/상세 | R | CRUD | R(본인 과정) | R |
| 훈련생 등록/확정 | R | CRUD | — | R |
| 훈련생 변경이력 | R | R | — | R |
| 출결(일일/과정별) | R | CRUD(결석 확정 포함) | R(본인 회차) + 입실·퇴실 확인(C·U 최초 기록만, 결석 확정·수정 불가) | R |
| 출결 수정 | — | CU(사유필수) | — | — |
| 확인 필요 출결/사항 | R | R,U,A | —(메뉴 미노출, 본인 관련 건은 대시보드 요약에서만 확인 — STEP 3.6) | R,A |
| 출결 수정이력 | R | R | — | R |
| 강사 목록/배정 | R | CRUD | R(본인) | R |
| 강사 변경이력 | R | R | — | R |
| 교육일정 | R | CRUD | R(본인 배정 회차) | R |
| 운영일지 | R | R,U(검수) | CRUD(본인 담당 회차) | R |
| 특이사항 | R | CRUD,A | C(입력만, 수정은 담당자) | R,A |
| 결과물 제출현황/미제출 | R | R,U(독려/상태변경) | R(본인 과정) | R |
| 결과물 검토 | R | CRUD | — | R |
| 사용자 관리 | CRUD | — | — | — |
| 권한 관리 | CRUD | — | — | — |
| 감사로그 | R | — | — | R |

> 원칙: 강사는 "입력 최소 권한", 관리자/책임자는 "조회+확인처리 중심", 운영담당자가 실질적 CRUD의 대부분을 수행한다. **시스템 관리자는 업무 데이터를 조회만 하고(R) 사용자·권한 관리(S25·S26)만 쓰기 권한을 가진다** — 이전 초안의 "예외 대응용 업무 데이터 CRUD"는 STEP 7-A 화면 명세(S02·S04·S12·S13·S16이 모두 OPS_MANAGER 전용)와 충돌해 베이스라인에서 제거했다. 시스템 관리자의 업무 데이터 예외 수정 권한이 필요한지는 STEP 12 결정사항 #19로 남긴다.

### 2.3 권한 설계 원칙

1. 메뉴 접근 권한과 기능(버튼) 권한을 분리해서 관리한다 — 메뉴는 보이되 버튼이 비활성화되는 경우가 존재한다(예: 강사가 운영일지를 "조회"는 하나 "수정"은 못 하는 타 강사의 회차).
2. 강사는 기본적으로 "본인에게 배정된 과정/회차" 범위로 데이터가 필터링된 상태로만 조회/입력 가능하다(행 단위 권한, Row-level Security).
3. "확인 필요 사항 처리(A)"는 운영담당자/관리자책임자만 가능하며, 처리자 이력은 감사로그와 조치이력에 이중으로 남는다.

### 2.4 역할별 데이터 스코프 (Row-level 규칙)

메뉴 단위 권한만으로는 "어떤 행(row)까지 보이는가"가 정의되지 않으므로 명시한다. 스코프 판정 기준은 모두 `instructor_assignment`, `course.manager_user_id` 등 실제 테이블 관계로 계산하며, 별도 캐시 없이 조회 시점에 필터링한다.

| 역할 | 과정 스코프 | 판정 기준 |
|---|---|---|
| SYS_ADMIN | 전체 | 제한 없음 |
| OPS_MANAGER | 전체 과정 (**확정 D-02**) | `course.manager_user_id`는 표시·책임 소재용 필드일 뿐 접근 제한에는 사용하지 않음. 담당 과정 제한 등으로 정책이 바뀌면 STEP 12 #18을 재검토하고 스코프·API를 함께 변경 |
| INSTRUCTOR | 본인 배정 과정/회차만 | `instructor_assignment.instructor_id = 로그인사용자.instructor_id` 인 `course_id`/`schedule_id` 집합으로 제한. 타 강사의 회차는 목록 자체에 노출되지 않음(조회 자체 차단) |
| EXECUTIVE | 전체 (조회 전용 + 확인/조치 A권한) | 제한 없음, 단 마스터데이터(훈련생/강사/과정) 편집 버튼은 애초에 렌더링하지 않음 |

### 2.5 화면별 버튼 단위 권한 예시

메뉴 권한(2.2)을 화면의 실제 버튼 단위로 분해한 예시. 나머지 화면도 동일한 원칙(작성자 본인 여부, 역할, 상태값)으로 파생한다.

| 화면 | 버튼/액션 | SYS_ADMIN | OPS_MANAGER | INSTRUCTOR | EXECUTIVE |
|---|---|---|---|---|---|
| 회차별 운영일지 | 신규 작성 | — | O | O(본인 회차만) | — |
| 회차별 운영일지 | 수정 | — | O(검수 목적) | O(본인 작성 건만) | — |
| 확인 필요 상세 | 상태 "확인중" 전환 | — | O | — | O |
| 확인 필요 상세 | "조치완료"로 종결 | — | O | — | O |
| 확인 필요 상세 | "추가확인" 재오픈 | — | O | — | O |
| 출결 수정 | 저장(사유 필수) | — | O | — | — |
| 사용자 관리 | 계정 비활성화 | O | — | — | — |

### 2.6 접근 거부 시 처리

- **[서버 검증 원칙]** 이 문서의 모든 권한(STEP 2.2 CRUD/A, STEP 2.4 데이터 스코프, STEP 2.5 버튼 권한)은 화면 렌더링과 무관하게 **서버/API 계층에서 요청마다 재검증**한다. 메뉴·버튼 숨김은 사용성 보조일 뿐 통제 수단이 아니다. 특히 INSTRUCTOR의 스코프(본인 배정 과정/회차)는 URL 경로의 ID(course_id, schedule_id, trainee_id, submission_id, attachment_id 등)를 직접 바꿔 호출해도 서버가 소속을 재검사해 403(또는 존재 은닉을 위한 404)으로 거부해야 하며, 거부는 `audit_log`(action=ACCESS_DENIED)에 기록한다.
- 메뉴 자체가 권한 밖이면 사이드바에 노출하지 않는다(존재를 알리지 않음).
- URL 직접 접근 등으로 권한 밖 화면에 진입 시도 시 403 안내 화면(간단한 텍스트: "접근 권한이 없습니다")을 표시하고 해당 시도를 감사로그에 기록한다.
- 버튼 단위 권한 부재 시에는 버튼을 아예 렌더링하지 않는 것을 기본으로 하며(비활성화 상태로 노출해 혼란을 주지 않음), 목록성 화면에서 일부 행만 처리 권한이 없는 경우(예: 타 강사 회차)는 해당 행 자체를 노출하지 않는다.

---

## STEP 3. 전체 메뉴 구조

### 3.1 검토 결과 요약

기존 제시안은 큰 틀에서 타당하나, 다음 3가지를 반드시 보완해야 한다.

1. **"확인 필요 사항"이 출결에만 종속되어 있음** — 요구사항 원문에 "확인이 필요한 출결 및 운영사항 관리"라고 명시되어 있어, 출결뿐 아니라 운영일지·특이사항 등에서도 확인 필요 사항이 발생할 수 있다. 따라서 "확인 필요 출결"을 출결 관리 하위에 두는 대신, **"확인/조치 관리"를 최상위 메뉴로 분리**하고 그 안에서 출결기반/운영기반 건을 함께 다뤄야 한다.
2. **"훈련 대상자 등록 및 확인" 단계가 메뉴에 없음** — 훈련생 목록에 확정된 훈련생만 있으면 입과 전 대상자 검토 과정이 누락된다. "훈련생 관리" 안에 "대상자 확인" 화면을 추가한다.
3. **강사 배정이 명시적 메뉴/화면이 없음** — "강사 배정"은 교육일정 생성의 전제 조건이므로 강사 관리 또는 과정 운영 메뉴에 명시적으로 위치해야 한다. 이번 설계에서는 교육일정 화면 내 기능으로 통합(별도 메뉴 추가는 지양 — 메뉴 과다 방지 원칙에 따름).

불필요한 추가는 하지 않는다. 예를 들어 "통계", "리포트", "알림센터"는 MVP 단계 요구사항에 없으므로 메뉴로 만들지 않고 대시보드 내 요약으로만 흡수한다.

### 3.2 확정 메뉴 구조 (화면ID 매핑, STEP 6 참고)

```
1. 대시보드                                                   [S01]

2. 훈련생 관리
   2.1 대상자 확인          (신규) 대상자 등록/서류확인/입과확정 처리   [S02]
   2.2 훈련생 목록          확정된 훈련생 조회/검색                   [S03]
   2.3 훈련생 등록          신규 등록(대상자 경유 없는 직접 등록 포함)  [S04]
   2.4 훈련생 상세                                              [S05]
   2.5 변경이력                                                 [S06]

3. 출결 관리
   3.1 일일 출결                                                [S07]
   3.2 과정별 출결                                              [S08]
   3.3 출결 수정이력                                            [S10]

4. 강사 관리
   4.1 강사 목록                                                [S11]
   4.2 강의 일정            (교육일정 생성/강사 배정 포함, S13과 동일 화면)  [S13]
   4.3 강사 변경이력                                            [S14]

5. 과정 운영
   5.1 과정 목록                                                [S15]
   5.2 교육일정              (S13과 동일 데이터, 과정 중심 뷰)         [S13]
   5.3 회차별 운영일지                                          [S17]
   5.4 특이사항                                                 [S18]

6. 결과물 관리
   6.1 제출현황                                                 [S19]
   6.2 미제출                                                   [S20]
   6.3 검토이력                                                 [S21]

7. 확인/조치 관리         (신규, 최상위로 승격)
   7.1 확인 필요 목록        (출결기반 + 운영기반 통합)              [S22]
   7.2 확인 필요 상세                                           [S23]
   7.3 조치이력                                                 [S24]

8. 시스템 관리
   8.1 사용자                                                   [S25]
   8.2 권한                                                     [S26]
   8.3 감사로그                                                 [S27]
```

### 3.3 메뉴 구조 변경 사유 정리

| 변경 | 사유 |
|---|---|
| "확인 필요 출결"을 "확인/조치 관리"로 승격, 운영기반 건 통합 | 요구사항이 출결+운영 양쪽의 확인 필요 사항을 다루도록 명시. 하나의 메뉴 아래 통합해야 담당자가 놓치지 않음 |
| "대상자 확인" 화면 신설 | 등록→확인→확정의 업무 흐름이 메뉴에 반영되지 않으면 실제 입과 전 서류 검토 업무가 누락됨 |
| "교육일정"을 강사 관리/과정 운영 양쪽에서 접근 가능하되 데이터는 단일 테이블 사용 | 강사는 "내 일정" 관점, 운영담당자는 "과정 진행 순서" 관점으로 봐야 하므로 진입점은 2개, 데이터와 화면 컴포넌트는 1개로 재사용 |
| 별도 "강사 배정" 메뉴 미생성 | 교육일정 생성 화면에 강사 선택 필드로 충분히 커버되며, 별도 메뉴는 과잉 |
| "통계/리포트" 메뉴 미생성 | MVP 범위 외. 대시보드 요약 카드/테이블로 충분 |

### 3.4 진입점별 기본 필터 및 뷰 차이 (S13 상세)

동일한 `class_schedule` 데이터를 서로 다른 관점으로 보여주는 대표 사례이므로 진입 조건을 명확히 한다.

| 진입 메뉴 | 기본 필터 | 기본 정렬 | 기본 뷰 형태 |
|---|---|---|---|
| 4.2 강의 일정 (강사 관리) | `instructor_id` = 로그인한 강사 본인(강사 로그인 시) 또는 목록에서 선택한 강사 | 날짜 오름차순 | 캘린더 우선, 목록 보조 |
| 5.2 교육일정 (과정 운영) | `course_id` = 선택된 과정 | 회차(round_no) 오름차순 | 회차 목록 우선, 캘린더 보조 |

### 3.5 그 외 화면 기본 필터 (요약)

| 화면 | 기본 필터 |
|---|---|
| 대시보드 | 조회일 = 오늘, 과정 상태 = 운영중 |
| 일일 출결 | 조회일 = 오늘 |
| 확인 필요 목록 | 상태 = 진행중 상태 전체(확인필요/우선확인/확인중/추가확인/조치필요), 종결 상태 기본 숨김 |
| 결과물 미제출 | 제출기한 경과 + 미제출 |
| 훈련생 목록 | `trainee_enrollment.status` = 확정 |
| 대상자 확인 | `trainee_enrollment.status` in (신청, 서류확인중) |

### 3.6 사이드바 노출 규칙

- 사이드바는 STEP 2.2 매트릭스에서 전 항목이 "—"인 메뉴만 숨긴다. 예: 시스템 관리(8번) 전체는 SYS_ADMIN만 노출, 결과물 검토(6.3)는 INSTRUCTOR에 노출하지 않음.
- 확인/조치 관리(7번)는 INSTRUCTOR에게 메뉴 자체를 노출하지 않는다(본인 관련 건은 대시보드 요약에서만 확인, STEP 12 결정사항 #9와 연동해 추후 알림으로 보완 가능).
- breadcrumb 예시: `과정 운영 > 회차별 운영일지 > 3회차 작성` / `확인/조치 관리 > 확인 필요 상세 > #CASE-00123`

---

## STEP 4. 업무별 상세 프로세스

각 프로세스는 목적 / 트리거 / 사전조건 / 상세 절차(행위자·화면·액션·시스템 처리·관련 테이블) / 예외·대안 흐름 / 사후조건 순으로 기술한다.

### 4.1 과정 개설 프로세스

**목적**: 신규 훈련과정을 시스템에 등록하고 훈련 실시 직전까지의 준비를 완료한다.
**트리거**: 신규 과정 개설 필요 발생(사업계획 확정 등, 시스템 외부 요인)
**사전조건**: 없음(최초 단계)

| # | 행위자 | 화면 | 액션 | 시스템 처리 | 관련 테이블 |
|---|---|---|---|---|---|
| 1 | 운영담당자 | 과정 등록(S16) | 과정명/기간/교육시간/교육장/담당자 입력 후 저장 | `course` 신규 생성, status=준비중 | course |
| 2 | 운영담당자 | 훈련생 등록(S04) | 명단 업로드 또는 개별 등록(과정 선택 = 과정 배정, 별도 "배정" 화면은 없음) | `trainee`/`trainee_enrollment` 생성, status=신청 | trainee, trainee_enrollment |
| 3 | 운영담당자 | 대상자 확인(S02) | 자격요건·서류 확인 후 확정 처리 | `trainee_enrollment.status`: 신청→서류확인중→확정 | trainee_enrollment, trainee_change_log |
| 4 | 운영담당자 | 강사 목록(S11, 활동 강사 확인) → 교육일정(S13) | S13에서 담당 강사 선택(과정 전체 담당 또는 회차별) | `instructor_assignment` 생성(저장은 S13에서 발생, S11에는 배정 입력 기능 없음) | instructor_assignment |
| 5 | 운영담당자 | 교육일정(S13) | 회차별 일자/시간/강사/내용 입력 | `class_schedule` N건 생성(instructor_id는 배정된 강사 중에서만 선택) | class_schedule |
| 6 | 운영담당자 | 과정 상세(S16) | 상태를 "운영중"으로 전환(수동) 또는 대기 | `course.status`: 준비중→운영중 (또는 배치가 첫 교육일 도래 시 자동 전환) | course |

**예외·대안 흐름**
- 확정 훈련생이 0명인 상태에서 "운영중" 전환 시도 → 확인 경고 다이얼로그 표시 후 담당자 승인 시에만 진행(강제 차단은 아님, 소수 인원 과정도 존재할 수 있으므로).
- 특정 회차에 강사가 배정되지 않은 채로 저장 시도 → 교육일정 화면에서 해당 회차를 "미배정" 배지로 표시, 저장은 허용하되 대시보드에 경고 노출.
- 대상자 서류 확인 결과 자격 미달 → `trainee_enrollment.status`=취소, 사유 기록(재신청 시 신규 enrollment로 처리, 기존 trainee 레코드는 재사용).

**사후조건**: course.status=운영중, 1개 이상의 확정 훈련생, 1개 이상의 class_schedule과 배정된 강사 존재.

### 4.2 교육 당일 운영 프로세스

**목적**: 회차 단위로 입실 확인부터 퇴실 확인·결석 확정까지 당일 교육 운영 전 과정을 기록한다.
**트리거**: `class_schedule.class_date` = 당일
**사전조건**: 해당 회차의 class_schedule 존재(status≠휴강), 강사 배정 완료, 훈련생 확정 완료

**출결 조회 원칙(C1)**: S07(일일 출결)은 매 조회 시 `trainee_enrollment`(status=확정, course=schedule.course) 목록을 `attendance`(schedule_id=대상 회차)에 LEFT JOIN해서 만든다. 매칭되는 `attendance` 행이 있으면 실제 값을, 없으면 저장되지 않은 "미출결"을 화면에 표시한다.

| # | 행위자 | 화면 | 액션 | 시스템 처리 | 관련 테이블 |
|---|---|---|---|---|---|
| 1 | 운영담당자/강사 | 일일 출결(S07) | 대상 과정/회차 선택 → 확정 훈련생 목록을 attendance와 LEFT JOIN 조회 | 매칭 없는 훈련생은 "미출결"로 표시(레코드 생성 안 함) | trainee_enrollment, attendance(있는 것만) |
| 2 | 운영담당자/강사 | 일일 출결(S07) | "미출결" 대상자에 대해 입실 확인 클릭 | `attendance` 신규 INSERT(check_in_time, attendance_status=출석/지각 즉시 확정, source_type=공식/연계자동/내부수기) | attendance |
| 3 | 강사 | (현장 진행, 화면 조작 없음) | 교육 실시 | — | — |
| 4 | 강사 | 회차별 운영일지(S17) | 교육내용/참여인원/특이사항/첨부파일 입력 후 저장 | `operation_log` 생성, 첨부파일은 `attachment` 연결 | operation_log, attachment |
| 5 | 운영담당자/강사 | 일일 출결(S07) | 교육 종료 후 퇴실 확인(기존 attendance 행 대상) | `attendance.check_out_time` UPDATE | attendance |
| 6 | 운영담당자 | 일일 출결(S07) | 당일 마감 시 잔여 "미출결" 대상자에 대해 "결석 확정" 클릭(개별/일괄) | `attendance` 신규 INSERT(attendance_status=결석, check_in_time=NULL, source_type=내부수기) — 최초 생성이므로 change_log 대상 아님 | attendance |
| 7 | 시스템(자동) | — | 종료시간 경과 후 기존 attendance 행 중 퇴실 미확인 감지(배치) | 규칙 04 매칭 시 `verification_case` 생성 | attendance, verification_case |

**예외·대안 흐름**
- 공식 출결 데이터가 지연 수신되는 경우 → 아직 attendance 행이 없다면 내부수기로 먼저 생성(source_type=내부수기). 이후 공식 데이터가 수신되면 STEP 8.2의 대사(reconciliation) 로직이 비교하여, 임계치 이내 일치 시 공식값으로 갱신하고 source_type을 공식으로 전환하며, 불일치 시 attendance는 그대로 둔 채 규칙 07 확인 필요 이벤트를 생성한다(자동 덮어쓰기 없음).
- 해당 회차가 휴강으로 처리되는 경우 → `class_schedule.status`=휴강으로 전환, 해당 회차는 출결 조회·입력 대상에서 제외되고("미출결" 계산도 하지 않음) 규칙 03·04 평가에서도 제외된다.
- 강사가 회차 시작 전 결번(사고 등)으로 대체 강사가 투입되는 경우 → 운영담당자가 `class_schedule.instructor_id` 및 `instructor_assignment`를 수정하고 변경이력에 사유 기록.
- 당일 마감 시점까지 담당자가 "결석 확정"을 누르지 않은 "미출결" 잔여 건은 시스템이 자동으로 결석 처리하지 않는다(사람이 확정하는 것이 원칙). 다만 여러 날 누적되면 과정 종료 체크리스트(STEP 4.6)의 "출결 미처리" 항목에서 함께 집계된다.
- 강사가 현장에서 이상 정황(특이사항)을 인지한 경우 → 자동 탐지를 기다리지 않고 특이사항(S18)에 기록 후, 필요 시 운영담당자가 "확인 필요로 전환"하여 수동으로 verification_case를 생성할 수 있다(STEP 8.3).

**사후조건**: 해당 회차에 대해 실제 이벤트가 있었던 훈련생만큼 attendance 레코드 존재(전원이 아닐 수 있음 — 미확정 "미출결"이 남아있을 수 있으며 이는 정상적인 중간 상태), operation_log 1건 존재.

### 4.3 확인 필요 사항 처리 프로세스

**목적**: 탐지된 이상 가능성을 담당자가 확인하고 필요 시 조치하여 종결한다.
**트리거**: `verification_case` 신규 생성(자동 탐지 또는 수동 전환) 또는 기존 건에 담당자 배정
**사전조건**: 탐지규칙(STEP 8.1) 매칭 결과가 존재하거나, 특이사항(course_issue)에서 담당자가 수동으로 확인 필요를 지정함

| # | 행위자 | 화면 | 액션 | 시스템 처리 | 관련 테이블 |
|---|---|---|---|---|---|
| 1 | 시스템(자동) 또는 운영담당자 | — 또는 특이사항 상세(S18) | 배치/실시간 탐지 실행, 또는 담당자가 특이사항에서 "확인 필요로 전환" 클릭 | 규칙 매칭 시 자동 생성(status=확인필요/우선확인, detection_rule_id=RULE_01~07) 또는 수동 생성(detection_rule_id=MANUAL, related_course_issue_id 연결, STEP 8.3) | verification_case |
| 2 | 운영담당자 | 대시보드(S01) | 신규 건수 확인 | — | — |
| 3 | 운영담당자 | 확인 필요 목록(S22) | 대상 건 조회 후 클릭 | — | — |
| 4 | 운영담당자 | 확인 필요 상세(S23) | 탐지근거·연관 정보(관련 훈련생 0~N명/출결/운영일지) 열람 | — | verification_case, verification_case_trainee, attendance, operation_log |
| 5 | 운영담당자 | 확인 필요 상세(S23) | 상태를 "확인중"으로 전환, 확인내용 입력 | `verification_case` 갱신, `verification_action_log` insert | verification_case, verification_action_log, audit_log |
| 6 | 운영담당자 | 확인 필요 상세(S23) | (필요 시) 상태를 "조치필요"로 전환, 조치내용 입력 → 조치 수행 후 "조치완료" | 동일 | 동일 |
| 7 | 운영담당자 | 확인 필요 상세(S23) | (조치 불필요 시) "확인완료"로 종결 | 동일 | 동일 |

**예외·대안 흐름**
- 동일 원인으로 중복 탐지되는 경우 → 활성(미종결) 상태의 동일 규칙·동일 대상 건이 있으면 신규 생성 대신 기존 건에 근거만 누적(STEP 8.4 원칙).
- 확인내용/조치내용 미입력 상태로 상태 전환 시도 → 저장 차단, 필수 입력 안내.
- 종결된 건에서 추가 이상 정황 발견 → "추가확인"으로 재오픈(사유 필수), 재오픈 이력은 `verification_action_log`에 누적되어 처리 이력이 끊기지 않음.
- 여러 담당자가 동시에 같은 건을 열람·저장 시도 → 낙관적 잠금으로 나중 저장 시도 시 최신 상태 재확인 요청.

**사후조건**: `verification_case.status` ∈ {확인완료, 조치완료}, `verification_action_log`에 전체 처리 흐름이 시간순으로 기록됨, `audit_log`에도 반영.

### 4.4 출결 수정 프로세스

**목적**: 출결 오류를 정정하되, 정정 행위 자체를 투명하게 이력화한다.
**트리거**: 운영담당자가 기존 출결 레코드의 오류를 인지
**사전조건**: 대상 `attendance` 레코드 존재

| # | 행위자 | 화면 | 액션 | 시스템 처리 | 관련 테이블 |
|---|---|---|---|---|---|
| 1 | 운영담당자 | 일일 출결(S07) / 과정별 출결(S08) | 대상 출결 건의 "수정" 클릭 | 수정 화면 오픈, 변경 전 값 표시 | attendance |
| 2 | 운영담당자 | 출결 수정(S09, 모달) | 변경 후 값 입력, 수정사유 입력(필수) | 입력값 유효성 검사(사유 최소 글자수 등) | — |
| 3 | 운영담당자 | 출결 수정(S09, 모달) | 저장 | `attendance` UPDATE + `attendance_change_log` INSERT(변경 전/후 스냅샷, 사유) + `audit_log` INSERT를 하나의 트랜잭션으로 처리 | attendance, attendance_change_log, audit_log |
| 4 | 시스템(자동) | — | 배치 시 반복 수정 횟수 집계 | 규칙 05(횟수 초과) 매칭 시 `verification_case` 생성 | verification_case |
| 5 | 시스템(자동) | — | 배치 시 상태 반복 변경 패턴 확인 | 규칙 06 매칭 시 `verification_case` 생성 | verification_case |

**예외·대안 흐름**
- 수정사유 미입력 또는 최소 글자수 미달 → 저장 차단.
- 수정 대상 건이 이미 활성 `verification_case`와 `verification_case_trainee.attendance_id`로 연결된 상태에서 추가 수정이 발생하는 경우 → 신규 케이스를 만들지 않고 해당 케이스의 `evidence.items`에 근거를 추가한다(STEP 8.4, 추가 시 audit_log actor_type=SYSTEM_RULE).

**사후조건**: `attendance`는 최신값 반영, `attendance_change_log`에 원본 변경 내역이 영구 보존(append-only, 수정·삭제 불가).

### 4.5 결과물 제출/검토 프로세스

> **[확정 — 2026-09-21, 결정 D-01]** 결과물은 **운영담당자가 훈련생을 대신해 등록**한다(훈련생은 시스템 사용자가 아니며 TRAINEE 역할·계정 없음). 훈련생 직접 제출로 운영정책이 바뀌면 이 결정을 재검토하고 STEP 2·5·6·7-A와 API·권한을 함께 변경한다(비교표는 부록 F, decisions.md 2절).

**목적**: 훈련생이 실제로 제출한 결과물을 운영담당자가 시스템에 등록하고, 그 검토 결과를 기록한다.
**트리거**: 결과물 제출기한 도래 또는 훈련생이 담당자에게 결과물을 전달(이메일·현장 제출 등 시스템 외부 경로)
**사전조건**: 대상 훈련생이 `trainee_enrollment.status`=확정 상태

| # | 행위자 | 화면 | 액션 | 시스템 처리 | 관련 테이블 |
|---|---|---|---|---|---|
| 1 | 훈련생 | (시스템 외부 — 이메일/현장 제출 등) | 결과물을 운영담당자에게 전달 | — | — |
| 2 | 운영담당자 | 제출현황(S19) | "결과물 등록" 클릭 → 훈련생 선택, 파일, 훈련생이 실제 제출한 일시(`submission.submitted_at`) 입력 후 저장 | `submission` 신규 INSERT(submit_status=제출됨). 시스템에 이 레코드가 등록된 시점은 공통 감사컬럼 `created_at`으로 자동 기록되어 `submitted_at`(원본 제출 시점)과 구분됨. 등록 행위자는 `created_by`로 자동 기록 | submission, attachment |
| 3 | 운영담당자 | 제출현황(S19) / 미제출(S20) | 미제출자 확인 | — | submission(없음=미제출로 계산, C1과 동일한 "레코드 없으면 미제출" 원칙 적용) |
| 4 | 운영담당자 | 미제출(S20) | 독려(연락, 시스템 외부 조치) 후 결과물 확보 시 2번으로 복귀 | — | — |
| 5 | 운영담당자 | 결과물 검토(S21) | 결과물 열람 후 검토상태(적합/보완요청/부적합)·검토내용 입력 | `submission_review_log` 생성, `submission.review_status` 갱신 | submission_review_log, submission |
| 6 | 운영담당자 | 제출현황(S19) | 보완요청 후 훈련생이 다시 전달한 결과물을 재등록 | `submission.version` 증가 + 파일 교체(기존 파일은 attachment에 보존) | submission, attachment |

**예외·대안 흐름**
- 제출기한 경과 후 등록하는 경우 → 등록은 허용하되 "기한후제출"로 별도 표시(운영담당자 정책 판단 여지 제공).
- 보완요청이 반복되는 경우 → `submission_review_log`에 버전별 이력이 누적되어 검토 이력 전체를 추적 가능.
- `submission`이 아예 존재하지 않는 상태는 STEP 5.3 정의상 "제출 없음"을 의미하며, C1의 attendance와 동일한 원칙으로 미리 생성해 두지 않는다(제출현황/미제출 화면은 조회 시 `trainee_enrollment`와 `submission`을 LEFT JOIN해서 계산).

**사후조건**: 확정 훈련생 중 실제로 결과물을 전달한 인원만큼 `submission` 레코드 존재(전원이 아닐 수 있음 — 미등록 잔여분은 "미제출"로 계산됨), 등록된 건은 최소 1회 이상의 검토 이력 보유(과정 종료 전 목표).

### 4.6 과정 종료 프로세스

**목적**: 과정 종료 전 데이터 정합성을 확인하고 공식적으로 과정을 종결한다.
**트리거**: 과정 종료일 도래 또는 운영담당자의 종료 처리 시도
**사전조건**: `course.status`=운영중

| # | 행위자 | 화면 | 액션 | 시스템 처리 | 관련 테이블 |
|---|---|---|---|---|---|
| 1 | 운영담당자 | 과정 상세(S16, 종료 체크리스트) | 종료 처리 시도 | 4개 항목 자동 검증 실행 | course |
| 2 | 시스템(자동) | 종료 체크리스트 | 출결 미처리 건 존재 여부 확인 — **(a)** attendance 존재하되 퇴실 미확인(check_out_time NULL) **(b)** 확정 훈련생×회차 중 attendance 자체가 없는 "미출결" 잔여분(C1, trainee_enrollment와 class_schedule 대비 계산) | 존재 시 경고(차단 여부는 STEP 12 결정사항 #17에 따름) | attendance, trainee_enrollment, class_schedule |
| 3 | 시스템(자동) | 종료 체크리스트 | 확인 필요 사항 중 미종결 건 확인 | 존재 시 경고 | verification_case |
| 4 | 시스템(자동) | 종료 체크리스트 | 회차별 운영일지 누락 여부 확인 | 존재 시 경고 | operation_log |
| 5 | 시스템(자동) | 종료 체크리스트 | 결과물 제출/검토 완료율 확인 | 미완료 시 경고 | submission |
| 6 | 운영담당자 | 종료 체크리스트 | 모두 정리되었거나 예외 사유를 남기고 강제 종료 선택 | `course.status`: 운영중→종료 | course |
| 7 | 시스템(자동) | — | 종료 처리 완료 | 종료 시점 스냅샷(누가·언제·어떤 미해결 항목이 있었는지)을 `audit_log`에 기록 | audit_log |

**예외·대안 흐름**
- 경고 항목이 있는 상태에서 종료를 강행하는 경우 → 강제 종료 사유 입력을 필수로 하고, 사유와 당시 미해결 항목 스냅샷을 `audit_log`에 함께 기록(사후 추적 가능하도록).
- 종료 후 데이터 오류가 발견되는 경우 → 과정 상태는 재오픈하지 않고, 개별 데이터(예: 출결)에 대해서만 변경이력을 남기며 수정(예외적 수정 경로, STEP 12 결정사항으로 승인 단계 필요 여부 확인 필요).

**사후조건**: `course.status`=종료, 관련 미해결 항목 유무와 처리 방식이 `audit_log`에 영구 기록됨.

---

## STEP 5. 데이터 구조 및 ERD 개념

> 시각적 ERD: [훈련과정 ERD](https://claude.ai/artifact/HTwrhpTaK7gWgeMTRknR7o) — 아래 표의 관계를 4개 도메인(①훈련생·과정·강사 ②출결·운영 ③결과물·확인/조치 ④시스템·감사)으로 나눈 다이어그램. 전체 컬럼/제약조건은 이 문서가 원본(source of truth)이다.

### 5.1 공통 설계 원칙

- 모든 테이블은 공통 감사 컬럼을 가진다: `created_at`, `created_by`, `updated_at`, `updated_by` (append-only 로그성 테이블은 `updated_*` 없이 `created_*`만 가진다 — 이력은 수정되지 않으므로). 하단 표에서는 반복 생략.
- PK는 원칙적으로 surrogate key(`BIGINT` 자동증가)를 사용한다.
- 삭제는 원칙적으로 **논리 삭제**(상태값 전환)를 사용한다. MVP에서는 물리 삭제 기능 자체를 제공하지 않는다(원칙 9 준수).
- **STEP 1~4 확정 과정에서 반영된 구조 수정 사항** (이전 초안 대비 변경):
  1. `trainee.status` 필드를 제거했다. 상태는 훈련생 개인이 아니라 "특정 과정에 대한 등록 건"에 귀속되므로(한 사람이 여러 과정에 재등록될 수 있음) `trainee_enrollment.status`로 일원화한다.
  2. `class_schedule.status`(저장값 예정/휴강, "진행완료"는 계산값)를 신규 추가했다. STEP 4.2 예외 흐름에서 휴강·대체강사 상황이 확인되었는데, 이 구분이 없으면 규칙 03(회차 운영기록 지연)·04(퇴실 누락)이 휴강 회차를 오탐한다.
  3. `verification_case`에 `related_course_issue_id`를 추가했다. 요구사항이 "출결 및 운영사항"의 확인 필요를 명시하므로, 특이사항(`course_issue`)에서 기인한 이벤트도 근거로 연결되어야 한다.
  4. `submission`에 `version` 컬럼을 추가했다. STEP 4.5의 재제출 흐름은 신규 행 생성이 아니라 동일 제출 건의 버전 증가로 표현하고, `submission_review_log`가 버전별 검토 이력을 누적한다.
  5. `attendance_change_log`에 `trainee_id`를 비정규화 컬럼으로 추가했다. 규칙 05(반복 수정)·06(상태 반복 변경)은 훈련생 단위 집계가 배치마다 반복 실행되므로, `attendance` 조인 없이 바로 집계할 수 있도록 성능 목적의 중복 컬럼을 둔다.
  6. `trainee_change_log`/`instructor_change_log`는 엔티티 자체 변경과 그 하위 배정/등록 변경을 함께 다루므로 `entity_type`(TRAINEE/ENROLLMENT, INSTRUCTOR/ASSIGNMENT)으로 구분되는 다형성 구조를 사용한다.
- **개발 전 최종 검증(부록)에서 반영된 CRITICAL 수정 사항 (C1~C5, 상세는 부록 F 참고)**:
  7. (C1) `attendance.attendance_status`에서 "확인중"을 제거했다. `attendance`는 실제 출결 이벤트가 발생했을 때만 생성되는 실제 기록으로 재정의하고, 아직 이벤트가 없는 대상자는 `trainee_enrollment`+`class_schedule` 기준으로 계산되는 "미출결"(비저장)로 표현한다. 이로써 `source_type` NOT NULL과의 충돌이 해소된다.
  8. (C2, **확정 D-01**) `submission`은 스키마 변경 없이 "운영담당자가 훈련생의 결과물을 대신 등록"하는 모델로 확정했다 — `submitted_at`(원본 제출 시점, 담당자 입력)과 `created_at`(시스템 등록 시점, 자동 기록)을 구분해 쓰는 것으로 충분하다. 훈련생 직접 제출은 운영정책 변경 시 재검토한다(부록 F 비교표).
  9. (C3) `verification_case.trainee_id`와 `related_attendance_id`를 제거하고 `verification_case_trainee`(#25) 브릿지 테이블을 신설했다. 규칙 01·02처럼 여러 훈련생이 연루되는 사건과, 훈련생이 1명이거나 없는 사건을 동일한 구조로 표현한다.
  10. (C4) `audit_log.user_id`를 `actor_type`(USER/SYSTEM_RULE/SYSTEM_BATCH/SYSTEM_API) + `actor_user_id`(nullable)로 분리했다. 규칙 기반 자동 탐지나 배치처럼 사람이 아닌 행위자도 감사로그에 남길 수 있게 되었다.
  11. (C5) 규칙 03을 "입실 후 60분 내 현장정보 미확인"에서 "회차 종료 후 일정 시간이 지나도 운영일지가 작성되지 않음"으로 재정의했다(판단 데이터를 `class_schedule.end_time` 기준으로 변경). 훈련생 개별 현장 확인은 현재 데이터로 판단 근거가 불충분하므로 MVP 범위에서 제외하고, 새 이벤트 테이블은 신설하지 않았다(상세는 STEP 8.1·부록 F 참고).
- "변경이력"이 필요한 핵심 엔티티(훈련생, 강사, 출결)는 각각 전용 이력 테이블로 관리하되, **출결만은 UI/집계 패턴이 특수해 완전히 독립된 테이블 구조**를 쓴다(변경 전/후 시간값 비교, 반복수정·상태반복 탐지와 직결).
- `*_change_log`(업무적 변경이력, 사유 포함, 사용자 노출용)와 `audit_log`(시스템 전역 기술 로그, 보안/감사 목적)는 목적이 다르므로 별도 테이블로 유지한다(근거는 STEP 9.1 참고).
- `attachment`는 `operation_log`/`submission`/`course_issue` 3곳에서 공용으로 참조하는 다형성(entity_type + entity_id) 테이블이다. DB 레벨 FK 제약을 걸 수 없으므로 애플리케이션 레벨 검증(허용된 entity_type 목록, 대상 레코드 존재 여부)이 필수다.

### 5.2 테이블 목록 (25개, C3 반영으로 1개 추가)

| # | 테이블명 | 설명 | 발생 프로세스 |
|---|---|---|---|
| 1 | `course` | 과정 | P0 |
| 2 | `trainee` | 훈련생 인적정보(상태 없음) | P1 |
| 3 | `trainee_enrollment` | 훈련생-과정 등록(상태 보유) | P1 |
| 4 | `trainee_change_log` | 훈련생/등록 변경이력 | P1, 4.1 |
| 5 | `instructor` | 강사 | P2 |
| 6 | `instructor_assignment` | 강사-과정-회차 배정 | P2 |
| 7 | `instructor_change_log` | 강사/배정 변경이력 | P2, 4.2 |
| 8 | `class_schedule` | 회차별 교육일정 | P2 |
| 9 | `attendance` | 출결 | P3, 4.2 |
| 10 | `attendance_change_log` | 출결 수정이력(전용) | 4.4 |
| 11 | `operation_log` | 회차별 운영일지 | P3, 4.2 |
| 12 | `course_issue` | 교육과정 특이사항 | P3~P7 |
| 13 | `submission` | 결과물 제출 | P6, 4.5 |
| 14 | `submission_review_log` | 결과물 검토이력 | 4.5 |
| 15 | `verification_case` | 확인 필요 사항(이벤트, 훈련생 단일 FK 제거) | P4, P5, 4.3 |
| 16 | `verification_action_log` | 확인/조치 처리이력 | P5, 4.3 |
| 25 | `verification_case_trainee`(신규, C3) | 확인 필요 사항-훈련생 N:M 연결 | P4, P5, 4.3 |
| 17 | `detection_rule` | 탐지규칙 마스터 | P4 (STEP 8) |
| 18 | `attachment` | 첨부파일(공용, 다형성) | P3, P6 |
| 19 | `audit_log` | 시스템 전역 감사로그 | 전 구간 |
| 20 | `user_account` | 사용자 계정 | 시스템 관리 |
| 21 | `role` | 역할 마스터 | 시스템 관리 |
| 22 | `user_role` | 사용자-역할 매핑 | 시스템 관리 |
| 23 | `role_permission` | 역할-화면/기능 권한 매핑 | 시스템 관리 |
| 24 | `attendance_source_raw`(옵션) | 공식 출결시스템 연계 원본 적재 | P3 (연동 방식 미확정 — STEP 12 #1) |

### 5.3 테이블별 상세 명세

#### 1. `course`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| course_id | BIGINT | PK | |
| course_name | VARCHAR(200) | NOT NULL | |
| start_date | DATE | NOT NULL | |
| end_date | DATE | NOT NULL | |
| total_hours | INT | NOT NULL | 총 교육시간 |
| training_site | VARCHAR(200) | NOT NULL | 교육장 |
| manager_user_id | BIGINT | FK→user_account, NOT NULL | 담당자(표시·책임 소재용, 접근 제한 아님 — STEP 2.4) |
| status | ENUM | NOT NULL, DEFAULT 준비중 | 준비중/모집중/운영중/종료/중단 (전이 규칙: STEP 1.3) |

삭제정책: 물리 삭제 금지, 상태=중단으로 표현.

#### 2. `trainee`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| trainee_id | BIGINT | PK | |
| name | VARCHAR(50) | NOT NULL | |
| birth_date | DATE | NULL | |
| contact | VARCHAR(50) | NULL | 암호화 저장 권장 |
| registered_at | DATETIME | NOT NULL | 최초 등록일시(인물 기준, 과정 등록일과 다름) |

#### 3. `trainee_enrollment`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| enrollment_id | BIGINT | PK | |
| trainee_id | BIGINT | FK→trainee, NOT NULL | |
| course_id | BIGINT | FK→course, NOT NULL | |
| status | ENUM | NOT NULL, DEFAULT 신청 | 신청/서류확인중/확정/수료/중도포기/제적/취소 |
| applied_at | DATETIME | NOT NULL | |
| confirmed_at | DATETIME | NULL | |
| confirmed_by | BIGINT | FK→user_account, NULL | |
| cancel_reason | VARCHAR(500) | NULL | 취소/제적 시 필수(애플리케이션 검증) |

유효한 건(취소 제외)에 한해 UNIQUE(trainee_id, course_id) — 부분 유니크(WHERE status <> 'CANCELLED'), P1-01 확정: 취소 건은 이력으로 보존하고 재신청은 신규 등록 건. 삭제정책: 논리 삭제(상태=취소).

#### 4. `trainee_change_log` (append-only)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| log_id | BIGINT | PK | |
| entity_type | ENUM | NOT NULL | TRAINEE / ENROLLMENT |
| entity_id | BIGINT | NOT NULL | entity_type에 따라 trainee_id 또는 enrollment_id 참조 |
| changed_by | BIGINT | FK→user_account, NOT NULL | |
| changed_at | DATETIME | NOT NULL | |
| before_value | JSON | NOT NULL | |
| after_value | JSON | NOT NULL | |
| reason | VARCHAR(500) | NOT NULL | |

#### 5. `instructor`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| instructor_id | BIGINT | PK | |
| name | VARCHAR(50) | NOT NULL | |
| contact | VARCHAR(50) | NULL | |
| status | ENUM | NOT NULL, DEFAULT 활동 | 활동/비활동 |

#### 6. `instructor_assignment`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| assignment_id | BIGINT | PK | |
| instructor_id | BIGINT | FK→instructor, NOT NULL | |
| course_id | BIGINT | FK→course, NOT NULL | |
| round_no | INT | NULL | NULL이면 과정 전체 담당 |
| status | ENUM | NOT NULL, DEFAULT 배정 | 배정/배정취소 |
| assigned_at | DATETIME | NOT NULL | |

유효한 배정(status=ASSIGNED)에 한해 UNIQUE(instructor_id, course_id, round_no) — 부분 유니크, P1-02 확정: 취소 배정은 이력으로 보존하고 재배정은 신규 행(round_no NULL인 과정 전체 담당은 유효 배정 기준 course_id당 1건 부분 유니크).

#### 7. `instructor_change_log` (append-only)

trainee_change_log와 동일 패턴: log_id(PK), entity_type(INSTRUCTOR/ASSIGNMENT), entity_id, changed_by(FK), changed_at, before_value(JSON), after_value(JSON), reason(NOT NULL)

#### 8. `class_schedule`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| schedule_id | BIGINT | PK | |
| course_id | BIGINT | FK→course, NOT NULL | |
| round_no | INT | NOT NULL | |
| class_date | DATE | NOT NULL | |
| start_time | TIME | NOT NULL | |
| end_time | TIME | NOT NULL | |
| instructor_id | BIGINT | FK→instructor, NOT NULL | instructor_assignment와 정합성은 애플리케이션 레벨에서 검증 |
| content | VARCHAR(500) | NULL | |
| status | ENUM | NOT NULL, DEFAULT 예정 | 예정/휴강만 저장한다(**베이스라인 정합화**: "진행완료"는 어떤 프로세스도 실제로 설정하지 않는 죽은 값이었다 — C1과 동일한 "완료 전 상태는 계산, 확정 필요한 예외만 저장" 원칙에 따라 화면에서는 `now > end_time`이면 "진행완료"를 계산해 표시하고 DB에는 남기지 않는다). 규칙 03·04의 대상 제외 판정은 저장된 값(휴강) 기준 |

UNIQUE(course_id, round_no)

#### 9. `attendance` — 핵심 테이블

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| attendance_id | BIGINT | PK | |
| trainee_id | BIGINT | FK→trainee, NOT NULL | |
| schedule_id | BIGINT | FK→class_schedule, NOT NULL | |
| check_in_time | DATETIME | NULL | |
| check_out_time | DATETIME | NULL | |
| attendance_status | ENUM | NOT NULL | 출석/지각/조퇴/결석/인정결석 (**C1**: "확인중" 삭제 — 레코드는 생성 시점에 이미 상태가 확정되므로 임시 상태가 불필요) |
| source_type | ENUM | NOT NULL | 공식/내부수기/연계자동 (DEFAULT 없음 — 항상 생성 시점에 값이 정해짐) |
| related_info | JSON | NULL | 출결환경(기기ID, 위치 등) — 규칙 01·02용. **주의**: 내부수기 입력 경로에는 이 값을 채울 UI가 없으므로 실질적으로 공식/연계자동 출처에서만 채워진다(STEP 8.1 참고) |
| last_modified_at | DATETIME | NULL | |

UNIQUE(trainee_id, schedule_id). 삭제정책: 물리 삭제 금지. **생성 원칙(C1)**: 회차 생성·훈련생 확정만으로는 행이 생기지 않으며, 실제 입실/퇴실/결석확정 이벤트가 발생할 때만 INSERT된다. 아직 이벤트가 없는 (trainee_id, schedule_id) 조합은 "미출결"로 계산 표시될 뿐 DB에는 존재하지 않는다. 최초 INSERT는 `attendance_change_log` 대상이 아니며, 그 이후의 모든 수정만 `attendance_change_log` 기록을 동반해야 한다(애플리케이션 트랜잭션 경계로 강제).

#### 10. `attendance_change_log` (append-only, 전용)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| log_id | BIGINT | PK | |
| attendance_id | BIGINT | FK→attendance, NOT NULL | |
| trainee_id | BIGINT | FK→trainee, NOT NULL | 비정규화(규칙 05·06 집계 성능용) |
| actor_type | ENUM | NOT NULL | USER / SYSTEM_BATCH / SYSTEM_API (**베이스라인 추가**: STEP 8.2 공식 대사가 기존 attendance 값을 갱신할 때 사람이 아닌 행위자가 변경이력을 남겨야 하는데 `changed_by`가 NOT NULL이라 표현할 수 없었음 — audit_log와 동일한 방식) |
| changed_by | BIGINT | FK→user_account, NULL | actor_type=USER이면 필수, 그 외 NULL |
| changed_at | DATETIME | NOT NULL | |
| before_value | JSON | NOT NULL | |
| after_value | JSON | NOT NULL | |
| reason | VARCHAR(500) | NOT NULL | 시스템 갱신은 "공식 출결 대사 반영" 등 고정 사유 |

권장 인덱스: (trainee_id, changed_at), (attendance_id, changed_at). **규칙 05·06은 actor_type=USER인 행만 집계한다**(공식 대사에 의한 정상 정정이 "반복 수정"으로 오탐되지 않도록).

#### 11. `operation_log`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| operation_log_id | BIGINT | PK | |
| schedule_id | BIGINT | FK→class_schedule, NOT NULL | course_id는 조인으로 도출(비정규화하지 않음) |
| instructor_id | BIGINT | FK→instructor, NOT NULL | |
| content | TEXT | NOT NULL | |
| participant_count | INT | NOT NULL | |
| issue_note | TEXT | NULL | |
| author_id | BIGINT | FK→user_account, NOT NULL | |
| written_at | DATETIME | NOT NULL | |

UNIQUE(schedule_id) — 회차당 운영일지는 1건이며 수정은 같은 행을 UPDATE한다(베이스라인 확정. 수정 추적은 `audit_log` before/after). 1:N `attachment`(entity_type=OPERATION_LOG). "미작성"은 행이 없는 계산 상태다.

#### 12. `course_issue`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| issue_id | BIGINT | PK | |
| course_id | BIGINT | FK→course, NOT NULL | |
| schedule_id | BIGINT | FK→class_schedule, NULL | 회차 비종속 이슈(시설 등) 대응 |
| category | ENUM | NOT NULL | 시설/민원/안전/기타 |
| content | TEXT | NOT NULL | |
| status | ENUM | NOT NULL, DEFAULT 등록 | 등록/확인중/조치완료 |
| reported_by | BIGINT | FK→user_account, NOT NULL | |
| reported_at | DATETIME | NOT NULL | |

1:N `attachment`(entity_type=COURSE_ISSUE)

#### 13. `submission`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| submission_id | BIGINT | PK | |
| trainee_id | BIGINT | FK→trainee, NOT NULL | |
| course_id | BIGINT | FK→course, NOT NULL | |
| title | VARCHAR(200) | NOT NULL | |
| version | INT | NOT NULL, DEFAULT 1 | 재제출 시 증가 |
| submitted_at | DATETIME | NOT NULL | 훈련생이 실제 제출한 시점(담당자 수기 입력, C2). 행 자체가 등록 이벤트가 있을 때만 생기므로 NULL일 수 없음(**베이스라인 수정**). 시스템 등록 시점은 `created_at` |
| submit_status | ENUM | NOT NULL, DEFAULT 제출됨 | 제출됨/기한후제출만 저장한다(**베이스라인 정합화**: C2 재해석상 `submission`은 실제 등록 이벤트가 있을 때만 생성되므로 "미제출"은 attendance의 "미출결"과 동일하게 행이 없는 상태의 계산값이다 — 죽은 enum 값이었던 "미제출"을 제거) |
| review_status | ENUM | NOT NULL, DEFAULT 대기 | 대기/적합/보완요청/부적합 |

UNIQUE(trainee_id, course_id, title) — 재등록은 같은 행의 `version` 증가로 표현한다(결과물 제출 단위는 STEP 12 #5 확정 시 재검토). 1:N `attachment`(entity_type=SUBMISSION, 버전별 파일은 `attachment.entity_version`으로 구분).

#### 14. `submission_review_log` (append-only)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| log_id | BIGINT | PK | |
| submission_id | BIGINT | FK→submission, NOT NULL | |
| version | INT | NOT NULL | 검토 시점의 submission 버전 |
| reviewer_id | BIGINT | FK→user_account, NOT NULL | |
| reviewed_at | DATETIME | NOT NULL | |
| review_result | ENUM | NOT NULL | 적합/보완요청/부적합 |
| review_comment | TEXT | NULL | |

#### 15. `verification_case` — 내부통제 핵심

**[C3 반영]** `trainee_id`(단일 FK)와 `related_attendance_id`를 제거했다. 규칙 01·02는 본질적으로 여러 훈련생이 동시에 연루되므로 단일 FK로 표현할 수 없었다. 관련 훈련생과 그 근거 출결은 신규 브릿지 테이블 `verification_case_trainee`(#25, 아래 참고)로 이전한다. 훈련생과 무관한 운영 전반 이슈(재정의된 규칙 03 등)는 `verification_case_trainee` 행이 0개인 상태로 존재한다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| case_id | BIGINT | PK | |
| course_id | BIGINT | FK→course, NOT NULL | |
| related_operation_log_id | BIGINT | FK→operation_log, NULL | |
| related_course_issue_id | BIGINT | FK→course_issue, NULL | |
| detection_rule_id | BIGINT | FK→detection_rule, NOT NULL | |
| detected_at | DATETIME | NOT NULL | |
| evidence | JSON | NOT NULL | 탐지근거 스냅샷(사실 데이터만, 해석 문구 없음) |
| status | ENUM | NOT NULL, DEFAULT 확인필요 | 확인필요/우선확인/확인중/확인완료/추가확인/조치필요/조치완료 (전이 규칙: STEP 1.3) |
| assignee_id | BIGINT | FK→user_account, NULL | |
| confirmation_note | TEXT | NULL | 상태를 확인중 이상으로 전환 시 필수(애플리케이션 검증) |
| action_note | TEXT | NULL | 조치필요/조치완료 전환 시 필수 |
| closed_at | DATETIME | NULL | |

근거 검증 규칙(애플리케이션 레벨, **베이스라인 수정**): `evidence.items`에 사실 데이터가 최소 1건 있어야 한다. 훈련생·출결·운영일지·특이사항 연결(`verification_case_trainee`, `related_*`)은 존재하는 경우에만 채운다 — 이전 초안은 "연결 대상 최소 1개"를 요구했으나 규칙 03(회차 운영기록 지연)은 훈련생도 운영일지도 없는 건이라 통과할 수 없었다. 회차는 `evidence.items[].schedule_id`로 가리키며 S23이 이를 링크로 렌더링한다.

#### 25. `verification_case_trainee` (신규, C3)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| case_id | BIGINT | PK, FK→verification_case | |
| trainee_id | BIGINT | PK, FK→trainee | |
| attendance_id | BIGINT | FK→attendance, NULL | 이 훈련생과 관련된 구체적 출결 증거(없을 수 있음) |

PK(case_id, trainee_id). 한 훈련생이 같은 사건에 여러 출결로 연루돼도 행은 1개이며 `attendance_id`에는 대표 출결(최초 매칭 건)만 저장하고 나머지 근거는 `verification_case.evidence.items`에 모두 남긴다(부록 F의 N2 해소). 행은 추가만 하고 삭제·수정하지 않는다(append-only, `created_at`/`created_by`만 보유). 단순 연결 목적이므로 `relation_type` 등 추가 분류 컬럼은 두지 않는다(모두 동등한 "관련 훈련생"). 규칙 04·05·06·MANUAL처럼 훈련생이 1명뿐인 사건도 이 테이블에 1행만 넣어 표현 방식을 통일한다 — `verification_case`에 남겨둔 단일 FK와 브릿지 테이블 두 가지 경로로 훈련생을 찾는 이원화를 피하기 위함이다.

#### 16. `verification_action_log` (append-only)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| log_id | BIGINT | PK | |
| case_id | BIGINT | FK→verification_case, NOT NULL | |
| actor_id | BIGINT | FK→user_account, NOT NULL | |
| action_at | DATETIME | NOT NULL | |
| action_type | ENUM | NOT NULL | 확인/상태변경/조치입력/종결/재오픈 — **사용 규칙(베이스라인 확정)**: 확인 시작(→확인중)=`확인`, 조치 필요 기록(→조치필요)=`조치입력`, 확인완료·조치완료(종결 상태 진입)=`종결`, 추가확인 전환=`재오픈`, `상태변경`은 위 어디에도 속하지 않는 예비값(현재 사용 안 함). 담당자 배정 변경은 `audit_log`로만 기록 |
| previous_status | ENUM | NULL | |
| new_status | ENUM | NOT NULL | |
| note | TEXT | NULL | |

#### 17. `detection_rule`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| rule_id | BIGINT | PK | |
| rule_code | VARCHAR(20) | UNIQUE, NOT NULL | RULE_01~RULE_07 + MANUAL |
| rule_name | VARCHAR(100) | NOT NULL | |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE | MANUAL은 항상 TRUE(비활성화 대상 아님) |
| initial_status | ENUM | NOT NULL | 매칭 시 부여할 초기 상태(확인필요/우선확인) |
| params | JSON | NOT NULL | 임계치 등 파라미터(STEP 8.1 참고). MANUAL은 빈 객체 |
| description | VARCHAR(500) | NULL | |

`rule_code=MANUAL`은 규칙 01~07의 자동 탐지가 아니라 담당자가 특이사항 등에서 수동으로 확인 필요를 생성할 때 사용하는 고정 레코드다. `verification_case.detection_rule_id`를 NOT NULL로 유지하면서 수동 생성 경로를 구분하기 위한 장치다(STEP 8.3).

#### 18. `attachment` (다형성, 공용)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| attachment_id | BIGINT | PK | |
| entity_type | ENUM | NOT NULL | OPERATION_LOG / SUBMISSION / COURSE_ISSUE |
| entity_id | BIGINT | NOT NULL | entity_type이 가리키는 테이블의 PK |
| entity_version | INT | NULL | entity_type=SUBMISSION일 때만 사용 — 재등록(version 증가) 시 교체된 이전 파일을 버전별로 보존·구분(STEP 4.5 절차 6). 그 외 유형은 NULL |
| file_name | VARCHAR(255) | NOT NULL | |
| file_path | VARCHAR(500) | NOT NULL | |
| file_size | BIGINT | NOT NULL | |
| uploaded_by | BIGINT | FK→user_account, NOT NULL | |
| uploaded_at | DATETIME | NOT NULL | |

#### 19. `audit_log` (append-only) — **[C4 반영]**

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| log_id | BIGINT | PK | |
| actor_type | ENUM | NOT NULL | USER / SYSTEM_RULE(규칙기반 자동탐지) / SYSTEM_BATCH(정기배치) / SYSTEM_API(외부연동 수신 등) |
| actor_user_id | BIGINT | FK→user_account, NULL | actor_type=USER이면 필수(단 존재하지 않는 계정의 LOGIN_FAILED만 NULL 허용), actor_type≠USER이면 반드시 NULL |
| action | ENUM | NOT NULL | CREATE/UPDATE/DELETE/VIEW_SENSITIVE/LOGIN/LOGOUT/LOGIN_FAILED/ACCESS_DENIED (**베이스라인 확장**: 로그인·로그아웃·접근거부는 STEP 2.6이 이미 기록을 요구하는데 기존 4값으로는 표현할 수 없었다. DELETE는 hard delete 금지 정책상 사용하지 않는 예약값) |
| target_table | VARCHAR(100) | NOT NULL | 논리적 참조(물리 FK 아님 — 전역 로그 특성상 단일 테이블로 묶을 수 없음). 로그인 계열은 `user_account`, ACCESS_DENIED는 거부된 대상 리소스명 |
| target_id | BIGINT | NULL | LOGIN_FAILED(존재하지 않는 계정)·ACCESS_DENIED(대상 특정 불가)에서만 NULL 허용, 그 외 필수 |
| before_value | JSON | NULL | |
| after_value | JSON | NULL | |
| action_at | DATETIME | NOT NULL | |
| reason | VARCHAR(500) | NULL | actor_type≠USER인 경우 어떤 규칙/배치가 발생시켰는지 식별자를 기록(예: "RULE_04 야간배치", "과정 자동전환 배치") — 별도 컬럼을 추가하지 않고 기존 필드를 재사용 |
| ip_address | VARCHAR(45) | NULL | USER 액션에만 의미 있음 |

**행위자 유형별 기록 규칙**: 사용자의 출결 수정(actor_type=USER, actor_user_id=처리자) · 시스템의 이상징후 탐지(actor_type=SYSTEM_RULE, actor_user_id=NULL, reason에 규칙코드) · 배치에 의한 상태 변경(actor_type=SYSTEM_BATCH) · 관리자의 확인완료/조치완료(actor_type=USER). 알림 생성은 STEP 12 결정사항 #14(알림 채널)가 확정되기 전까지는 해당 기능 자체가 없으므로 기록 대상이 아니며, 확정 시 동일한 actor_type 체계를 적용한다. 단, `verification_action_log.actor_id`는 원래부터 담당자(사람)의 확인/조치 이력만 기록하는 전용 테이블이므로 NOT NULL을 그대로 유지한다 — 자동 탐지 자체는 `verification_case`(detected_at, detection_rule_id)에 남고 `verification_action_log`에는 담당자가 개입한 시점부터 기록되기 때문에 이 테이블은 C4의 영향을 받지 않는다.

#### 20. `user_account`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| user_id | BIGINT | PK | |
| login_id | VARCHAR(50) | UNIQUE, NOT NULL | |
| password_hash | VARCHAR(255) | NOT NULL | |
| name | VARCHAR(50) | NOT NULL | |
| email | VARCHAR(100) | NULL | |
| linked_instructor_id | BIGINT | FK→instructor, NULL | 강사 역할 계정인 경우 연결 — STEP 2.4 데이터 스코프 판정에 사용 |
| status | ENUM | NOT NULL, DEFAULT 활성 | 활성/비활성 |

#### 21~23. `role` / `user_role` / `role_permission`

- `role`: role_id(PK), role_code(ENUM: SYS_ADMIN/OPS_MANAGER/INSTRUCTOR/EXECUTIVE, UNIQUE), role_name
- `user_role`: user_id(FK)+role_id(FK) 복합 PK — 구조적으로 1인 다역할을 허용하되 MVP 운영정책은 1인 1역할 권장
- `role_permission`: role_id(FK)+screen_id(화면ID, STEP 3.2의 S01~S27)+action(ENUM: C/R/U/D/A) 복합 PK, scope_type(ENUM: 전체/본인담당) — STEP 2.2·2.4 매트릭스의 DB 표현

#### 24. `attendance_source_raw` (옵션, 공식 출결 연동 확정 전 임시 구조)

공식 출결시스템 연동 방식(API 실시간/파일 업로드)이 STEP 12 결정사항 #1로 미확정이므로, 원본 데이터를 우선 적재만 해두는 스테이징 테이블로 설계한다: raw_id(PK), received_at, raw_payload(JSON), processed(BOOLEAN), processed_at. 연동 방식 확정 후 `attendance` 반영 배치 로직과 함께 구체화한다.

### 5.4 테이블 간 관계 요약

| 관계 | 유형 | 비고 |
|---|---|---|
| course ↔ trainee_enrollment ↔ trainee | 1:N:1 (배정 테이블로 N:M 해소) | 재수강 시 enrollment 신규 생성 |
| trainee_enrollment ↔ trainee_change_log | 1:N (다형성) | entity_type으로 trainee/enrollment 구분 |
| course ↔ instructor_assignment ↔ instructor | 1:N:1 | 회차 단위 배정 가능 |
| instructor ↔ instructor_change_log | 1:N (다형성) | |
| course ↔ class_schedule | 1:N | 회차 |
| class_schedule ↔ attendance ↔ trainee | 1:N, N:1 | UNIQUE(trainee_id, schedule_id) |
| attendance ↔ attendance_change_log | 1:N | append-only, 전용 |
| class_schedule ↔ operation_log | 1:N(사실상 1:1, 회차당 1건) | |
| operation_log / submission / course_issue ↔ attachment | 1:N × 3 (다형성) | 애플리케이션 레벨 검증 |
| trainee ↔ submission ↔ submission_review_log | 1:N:N | version으로 재제출 표현 |
| course, operation_log, course_issue ↔ verification_case | 1:N, 0:N × 2 | related_operation_log_id/related_course_issue_id 또는 verification_case_trainee 중 1개 이상 필수(C3) |
| verification_case ↔ verification_case_trainee ↔ trainee, attendance | 1:N, N:1, 0:1 | **신규(C3)**. 규칙 01·02의 다중 훈련생 연루를 표현. 훈련생 무관 사건은 0행 |
| detection_rule ↔ verification_case | 1:N | |
| verification_case ↔ verification_action_log | 1:N | append-only, 담당자(사람) 전용 — C4 영향 없음 |
| user_account ↔ role (via user_role) ↔ role_permission | N:M, 1:N | |
| user_account ↔ instructor | 0:1 (linked_instructor_id) | 강사 로그인 계정의 스코프 판정용 |
| 전체 업무 테이블 ↔ audit_log | N:1(actor_user_id, nullable), 논리적 참조(target_table) | **C4 반영**: 사람 행위는 actor_user_id로, 시스템/배치 행위는 actor_type만으로 기록 |

### 5.5 삭제·이력 정책 요약

| 구분 | 정책 |
|---|---|
| 마스터 데이터(course, trainee, instructor 등) | 물리 삭제 금지, 상태값 전환으로 표현 |
| 트랜잭션 데이터(attendance, submission, course_issue 등) | 물리 삭제 금지, 상태값/버전으로 표현 |
| 변경이력(`*_change_log`) | append-only, UPDATE/DELETE 미제공, 사유 필수 |
| 확인/조치 이력(`verification_action_log`) | append-only |
| 감사로그(`audit_log`) | append-only, 보존기간은 STEP 9.2 및 STEP 12 결정사항 #8에 따름 |
| 첨부파일(`attachment`) | 원본 레코드 삭제 금지, 참조 엔티티가 논리 삭제되어도 첨부는 보존(사후 감사 목적) |

---

## STEP 6. 화면 목록

| 화면ID | 화면명 | 소속 메뉴 |
|---|---|---|
| S01 | 대시보드 | 대시보드 |
| S02 | 대상자 확인 목록/처리 | 훈련생 관리 |
| S03 | 훈련생 목록 | 훈련생 관리 |
| S04 | 훈련생 등록/수정 | 훈련생 관리 |
| S05 | 훈련생 상세 | 훈련생 관리 |
| S06 | 훈련생 변경이력 | 훈련생 관리 |
| S07 | 일일 출결 | 출결 관리 |
| S08 | 과정별 출결 | 출결 관리 |
| S09 | 출결 수정 팝업/화면 | 출결 관리 |
| S10 | 출결 수정이력 | 출결 관리 |
| S11 | 강사 목록 | 강사 관리 |
| S12 | 강사 등록/수정 | 강사 관리 |
| S13 | 강의 일정(교육일정 캘린더/목록) | 강사 관리 / 과정 운영(STEP 3.4 참고, 진입점 2곳·화면 1개) |
| S14 | 강사 변경이력 | 강사 관리 |
| S15 | 과정 목록 | 과정 운영 |
| S16 | 과정 등록/수정/상세(종료 체크리스트 포함) | 과정 운영 |
| S17 | 회차별 운영일지 목록/작성 | 과정 운영 |
| S18 | 특이사항 목록/등록/상세("확인 필요로 전환" 액션 포함) | 과정 운영 |
| S19 | 결과물 제출현황 | 결과물 관리 |
| S20 | 결과물 미제출 목록 | 결과물 관리 |
| S21 | 결과물 검토(상세+검토입력) | 결과물 관리 |
| S22 | 확인 필요 목록 | 확인/조치 관리 |
| S23 | 확인 필요 상세(확인/조치 입력) | 확인/조치 관리 |
| S24 | 조치이력 조회 | 확인/조치 관리 |
| S25 | 사용자 목록/등록/수정 | 시스템 관리 |
| S26 | 권한(역할) 관리 | 시스템 관리 |
| S27 | 감사로그 조회 | 시스템 관리 |

총 27개 화면(팝업/모달 성격 제외 시 25개 페이지 + 2개 모달: S09, 그리고 대상자 확인/훈련생 등록 등에 포함된 서브 모달은 별도 계수하지 않음). 화면ID는 STEP 3.2 메뉴 매핑, STEP 4 업무 프로세스, STEP 7 상세설계 전반에서 공통으로 참조한다.

---

## STEP 7. 핵심 화면 상세설계

### 7.1 대시보드 [S01]

- **목적**: 오늘의 운영현황과 확인이 필요한 업무를 한눈에 파악
- **주요 사용자**: 전 역할(역할별 범위 필터링)
- **화면 구성**:
  - 상단: 오늘 진행되는 과정/회차 리스트(표 형태 — 카드 남발 금지 원칙 준수)
  - 좌측/중단: "확인 필요 사항" 요약 테이블(상태별 건수 + 최근 N건 리스트, 클릭 시 상세 이동)
  - 우측 또는 하단: 결과물 미제출/미검토 건수, 출결 미처리(퇴실 누락 등) 건수
- **검색조건/필터**: 날짜(기본 오늘), 과정, 담당자
- **테이블 컬럼(확인 필요 요약)**: 발생일시 / 과정 / 대상(관련 훈련생 0~N명, S22와 동일 표시 규칙 — **C3**) / 탐지유형 / 상태 / 담당자
- **버튼**: 없음(대시보드는 조회 전용) — 각 행 클릭 시 상세 이동
- **상태값**: 확인필요(강조 색상 1개만 사용) / 그 외는 중립색
- **클릭 시 이동**: 확인 필요 행 → 확인 필요 상세, 과정 행 → 과정 상세
- **저장되는 데이터**: 없음(읽기 전용)
- **권한**: EXECUTIVE/OPS_MANAGER는 전체 또는 소속 범위, INSTRUCTOR는 본인 과정만
- **예외 상황**: 데이터 없음 시 "오늘 예정된 교육이 없습니다" 등 텍스트 안내(빈 그래프/일러스트 사용 금지)

### 7.2 확인 필요 목록 [S22]

- **목적**: 확인이 필요한 사항(출결·운영일지 자동 탐지 + 특이사항 수동 전환 포함)을 규칙/상태별로 목록화하여 처리 누락 방지
- **주요 사용자**: OPS_MANAGER, EXECUTIVE
- **화면 구성**: 상단 검색/필터 바 + 하단 테이블(페이지네이션)
- **검색조건**: 기간(발생일 범위), 과정, 훈련생명, 담당자
- **필터**: 탐지유형(RULE_01~07 + MANUAL 체크박스), 상태(확인필요/우선확인/확인중/확인완료/추가확인/조치필요/조치완료 멀티셀렉트, 기본값=진행중 상태만 — STEP 3.5)
- **테이블 컬럼**: 사건ID / 발생일시 / 과정명 / 관련 훈련생(**C3**: `verification_case_trainee` 기준 0~N명, 2명 초과 시 "홍길동 외 N명"으로 축약 표시) / 탐지유형(규칙코드 또는 "수동") / 우선순위(저장 컬럼 없음 — status=우선확인이면 "우선", 그 외 "일반"으로 계산 표시) / 상태 badge / 담당자 / 최종처리일시
- **버튼**: 담당자 일괄지정, 엑셀 내보내기(선택), 행별 "상세보기"
- **상태값 badge 색상 예시**: 확인필요(주황 계열 1색), 확인중(회색), 확인완료/조치완료(연녹색), 그 외 무채색 — 포인트 컬러 최소화 원칙 준수
- **클릭 시 이동**: 행 클릭 → 확인 필요 상세(S23)
- **저장되는 데이터**: 없음(목록 조회), 담당자 일괄지정 시 `verification_case.assignee_id` 업데이트 + 감사로그
- **권한**: OPS_MANAGER(조회+처리), EXECUTIVE(조회+승인성 처리), INSTRUCTOR 메뉴 자체 미노출(본인 관련 건은 대시보드 요약에서만 확인 — STEP 2.2·3.6)
- **예외 상황**: 동시에 여러 담당자가 동일 건을 처리 시도할 경우 낙관적 잠금(마지막 상태값 비교) 처리, 충돌 시 새로고침 안내

### 7.3 확인 필요 상세 [S23]

- **목적**: 왜 확인이 필요한지 근거를 제시하고 담당자의 확인/조치 내용을 기록
- **주요 사용자**: OPS_MANAGER, EXECUTIVE
- **화면 구성**:
  1. 상단 요약 바: 사건ID, 탐지유형(규칙코드 또는 "수동생성"), 발생일시, 현재 상태 badge
  2. 탐지 근거 섹션: 자동 탐지 건은 탐지규칙 설명 + 비교 데이터(예: "동일 기기 ID로 10:02~10:05 사이 5명 출결 발생" 형태의 사실 나열, 판단적 문구 금지)를 표시하고, 수동 생성 건(detection_rule_id=MANUAL)은 원본 특이사항 내용과 등록자를 표시
  3. 연관 정보 섹션(**C3 반영**): `verification_case_trainee` 목록을 테이블로 표시 — 훈련생명 / 관련 출결 레코드(있으면 입퇴실시간·출결상태 링크, 없으면 "-") 를 훈련생 수만큼 반복 렌더링(규칙 01·02는 여러 행, 규칙 04·05·06·MANUAL은 보통 1행, 훈련생 무관 사건은 0행). 그 외 관련 운영일지 링크, 관련 특이사항 링크(해당 시)
  4. 처리 섹션: 상태 변경 드롭다운, 확인내용 입력란(textarea), 조치내용 입력란(textarea, 조치 필요 상태 진입 시 활성화)
  5. 처리이력 타임라인: `verification_action_log` 시간순 표시
- **검색조건/필터**: 해당 없음(단건 상세)
- **입력 필드**: 상태, 확인내용(필수 — 상태를 확인중 이상으로 바꿀 때), 조치내용(조치필요/조치완료 전환 시 필수)
- **버튼**: 저장, 상태전환(확인 시작 / 조치 필요로 전환 / 조치 완료 / 확인 완료 종결 / **재오픈(추가확인 전환, 사유 필수)** — STEP 2.5와 일치), 취소
- **상태값**: 확인필요 → 확인중 → (조치필요 → 조치완료) or 확인완료 → (필요 시 추가확인으로 재오픈 가능)
- **클릭 시 이동**: 연관 훈련생 각 행 → 훈련생 상세(S05), 연관 출결 각 행 → 과정별 출결(S08, 해당 행 하이라이트), 연관 특이사항 → 특이사항 상세(S18)
- **저장되는 데이터**: `verification_case` 상태/내용 업데이트, `verification_action_log` insert, `audit_log` insert(actor_type=USER)
- **권한**: 상태전환/조치입력은 OPS_MANAGER, EXECUTIVE만. 조회는 두 역할 모두. MVP 베이스라인은 OPS_MANAGER·EXECUTIVE 누구든 단독으로 종결할 수 있다(STEP 2.5와 동일). 2단계 승인이 필요한지는 STEP 12 결정사항 #13 확정 후 확장
- **예외 상황**: 필수 입력값(확인내용/조치내용) 누락 시 저장 차단, 이미 종결된 건을 재오픈하려는 경우 사유 입력 요구(추가확인 상태로 전환 시)

---

## STEP 7-A. 화면별 상세 명세 (S02~S21, S24~S27)

S01(대시보드)·S22(확인 필요 목록)·S23(확인 필요 상세)는 STEP 7에서 이미 상세화했다. 이 섹션은 나머지 24개 화면을 동일한 형식(목적/주요 사용자/화면 구성/검색조건·필터/테이블 컬럼/입력 필드/버튼/상태값/클릭 시 이동/저장되는 데이터/권한/예외 상황)으로 명세하며, 모든 필드명·상태값·권한은 STEP 5(DB)·STEP 2(권한)·STEP 4(프로세스)와 동일한 용어를 사용한다.

### 훈련생 관리 (S02~S06)

#### S02. 대상자 확인 목록/처리

- **목적**: 신청/서류확인중 상태의 대상자를 검토해 확정 여부를 결정(STEP 4.1 절차 2~3)
- **주요 사용자**: OPS_MANAGER
- **화면 구성**: 상단 필터바 + 목록 테이블 + 행별 처리 패널(인라인 확장 또는 모달)
- **검색조건**: 과정, 성명, 신청일 범위
- **필터**: `trainee_enrollment.status`(신청/서류확인중 기본 노출, 확정·취소는 별도 탭)
- **테이블 컬럼**: 성명 / 생년월일 / 과정명 / 신청일(applied_at) / 상태 badge / 처리
- **입력 필드**: 확정 처리는 별도 입력 없음(상태 전이만), 반려/취소 시 사유(`cancel_reason`, 필수)
- **버튼**: 확인 착수(신청→서류확인중), 확정(서류확인중→확정), 반려/취소, 새로고침
- **상태값**: 신청 / 서류확인중 / 확정 / 취소
- **클릭 시 이동**: 성명 클릭 → 훈련생 상세(S05)
- **저장되는 데이터**: `trainee_enrollment.status`·`confirmed_at`·`confirmed_by` 갱신, `trainee_change_log`(entity_type=ENROLLMENT) insert, `audit_log` insert
- **권한**: OPS_MANAGER(CRUD), SYS_ADMIN·EXECUTIVE(R)
- **예외 상황**: 동일 trainee가 같은 과정에 이미 유효하게(취소 제외) 등록되어 있으면(유효 등록 건 부분 유니크 위반) 신규 생성 대신 기존 건으로 안내. 반려 시 사유 미입력이면 저장 차단.

#### S03. 훈련생 목록

- **목적**: 확정된 훈련생을 과정별로 조회·검색
- **주요 사용자**: OPS_MANAGER, EXECUTIVE, INSTRUCTOR(본인 과정)
- **화면 구성**: 필터바 + 목록 테이블
- **검색조건**: 과정, 성명, 연락처
- **필터**: `trainee_enrollment.status`=확정(기본, STEP 3.5), 수료/중도포기/제적은 별도 필터
- **테이블 컬럼**: 성명 / 생년월일 / 연락처(마스킹 표시) / 과정명 / 확정일 / 상태 badge
- **버튼**: 신규 등록(→S04), 엑셀 내보내기(선택)
- **클릭 시 이동**: 행 클릭 → 훈련생 상세(S05)
- **저장되는 데이터**: 없음(조회 전용)
- **권한**: OPS_MANAGER·EXECUTIVE(전체 R), INSTRUCTOR(R, `instructor_assignment` 기준 본인 배정 과정만 — STEP 2.4)
- **예외 상황**: 검색 결과 없음 시 안내 문구만 표시(빈 일러스트 금지, UX 원칙)

#### S04. 훈련생 등록/수정

- **목적**: 신규 훈련생 인적정보·과정 등록 생성, 또는 기존 정보 수정
- **주요 사용자**: OPS_MANAGER
- **화면 구성**: 단일 폼(인적정보 섹션 + 과정 등록 섹션) + 엑셀 일괄 업로드 옵션
- **입력 필드**: 성명(필수), 생년월일, 연락처, 과정 선택(필수), 신청일(기본값=오늘)
- **버튼**: 저장, 취소, 엑셀 업로드
- **상태값**: 저장 시 `trainee_enrollment.status`=신청으로 초기화
- **클릭 시 이동**: 저장 후 대상자 확인(S02) 또는 훈련생 상세(S05)
- **저장되는 데이터**: `trainee` insert(신규 인물) 또는 기존 인물 선택, `trainee_enrollment` insert(status=신청), 정보 수정 시 `trainee_change_log`(entity_type=TRAINEE) insert
- **권한**: OPS_MANAGER(CRUD)
- **예외 상황**: 성명+생년월일이 일치하는 기존 `trainee`가 있으면 신규 인물 생성 대신 "기존 훈련생 선택 후 과정 등록"으로 안내(기존 인물을 검색해 새 과정에만 등록하는 경로가 곧 "과정 배정"). 선택한 인물이 이미 그 과정에 유효하게(취소 제외) 등록돼 있으면(유효 등록 건 부분 유니크) 저장하지 않고 기존 등록 건(S02/S05)으로 안내. 과정이 종료·중단 상태면 등록 불가, 운영중 과정의 중도 등록 허용 여부는 STEP 12 결정사항 #21. 필수값 누락 시 저장 차단. 엑셀 업로드 시 형식 오류 행은 별도 목록으로 표시하고 정상 행만 반영.

#### S05. 훈련생 상세

- **목적**: 훈련생 1인의 인적정보·등록이력·출결요약·결과물현황을 종합 조회
- **주요 사용자**: 전 역할(스코프 제한 적용)
- **화면 구성**: 상단 기본정보 요약 + 탭(등록이력 / 출결요약 / 결과물 / 확인필요 관련이력 — `verification_case_trainee`로 이 훈련생이 연결된 사건 목록 조회, C3)
- **테이블 컬럼(출결요약 탭)**: 회차 / 교육일 / 입실 / 퇴실 / 출결상태 badge
- **버튼**: 정보 수정(→S04), 변경이력 전체 보기(→S06)
- **상태값**: `trainee_enrollment.status` badge 상단 표시
- **클릭 시 이동**: 출결 행 → 과정별 출결(S08), 확인필요 이력 항목 → 확인 필요 상세(S23)
- **저장되는 데이터**: 없음(조회 전용)
- **권한**: OPS_MANAGER·EXECUTIVE(전체 R), INSTRUCTOR(본인 과정 훈련생만 R)
- **예외 상황**: 한 사람이 여러 과정에 등록된 경우 상단에 과정 선택 드롭다운을 노출해 등록 건(enrollment)별로 전환 조회

#### S06. 훈련생 변경이력

- **목적**: `trainee_change_log` 조회
- **주요 사용자**: OPS_MANAGER, EXECUTIVE, SYS_ADMIN
- **검색조건**: 훈련생명, 기간, entity_type(TRAINEE/ENROLLMENT)
- **테이블 컬럼**: 변경일시 / 대상 구분 / 변경자 / 변경 전 / 변경 후 / 사유
- **버튼**: 없음(조회 전용)
- **저장되는 데이터**: 없음
- **권한**: R only. INSTRUCTOR 접근 불가(STEP 2.2)
- **예외 상황**: before/after JSON은 필드 단위 diff로 하이라이트해 표시

### 출결 관리 (S07~S10)

#### S07. 일일 출결 — **[C1 반영]**

- **목적**: 특정 일자·회차의 훈련생별 입실/퇴실/결석을 확인·기록(STEP 4.2)
- **주요 사용자**: OPS_MANAGER, INSTRUCTOR(본인 회차)
- **화면 구성**: 상단 날짜/과정/회차 선택 + 훈련생별 출결 테이블
- **조회 로직(C1)**: 저장된 출결만 조회하지 않는다. `trainee_enrollment`(status=확정, course=해당 회차 소속 과정) 전체를 `attendance`(schedule_id=해당 회차)에 LEFT JOIN해 만든 목록을 보여준다. 매칭되는 attendance 행이 없으면 "미출결"로 표시하고 attendance_id는 없음(null) 상태로 렌더링한다.
- **검색조건**: 조회일(기본 오늘, STEP 3.5), 과정, 회차
- **필터**: `attendance_status` + "미출결"(계산값이므로 별도 옵션으로 필터 가능해야 함)
- **테이블 컬럼**: 훈련생명 / 입실시간 / 퇴실시간 / 출결상태 badge(**"미출결"은 저장값이 아닌 계산 badge로 별도 스타일**) / 출처(공식/내부수기/연계자동, 미출결 행은 공란) / 액션
- **입력 필드**: (미출결 행) 입실 확인(체크 또는 시간) / (기존 행) 퇴실 확인(체크 또는 시간)
- **버튼**: 입실 일괄확인(선택된 미출결 대상자 일괄 INSERT), 퇴실 일괄확인(기존 행 일괄 UPDATE), "결석 확정"(미출결 대상자를 결석으로 신규 INSERT, 개별/일괄), 개별 "수정"(→S09, 기존 행에만 노출)
- **상태값**: 출석/지각/조퇴/결석/인정결석(저장값) + 미출결(비저장 계산값)
- **클릭 시 이동**: 훈련생명 → 훈련생 상세(S05), 수정 → 출결 수정(S09)
- **저장되는 데이터**: 미출결 행에 대한 "입실 확인"·"결석 확정"은 `attendance` **INSERT**(최초 생성이므로 `attendance_change_log` 대상 아님), 기존 행에 대한 "퇴실 확인"은 `attendance.check_out_time` **UPDATE**(마찬가지로 최초 확정 값 채우기이므로 change_log 대상 아님 — change_log는 이미 채워진 값을 다시 바꿀 때만 발생)
- **권한**: OPS_MANAGER(CRUD, 결석 확정 포함), INSTRUCTOR(본인 회차 입실·퇴실 확인만 — **결석 확정은 OPS_MANAGER 전용**으로 베이스라인 기본값 확정, 강사에게 허용할지는 STEP 12 결정사항 #20. 기존 값 수정은 S09를 통해 OPS_MANAGER만 — STEP 2.2), SYS_ADMIN·EXECUTIVE(R)
- **예외 상황**: `class_schedule.status`=휴강인 회차는 애초에 조회 대상에서 제외되고 "미출결" 계산도 하지 않는다(휴강 안내만 표시). `source_type`=공식으로 이미 반영된 값은 읽기전용으로 표시(수정은 S09 경유). 동일 (trainee_id, schedule_id)에 입실확인과 결석확정이 동시에 시도되면 UNIQUE(trainee_id, schedule_id) 위반이므로 먼저 처리된 쪽만 반영되고 나머지는 "이미 처리됨" 안내 후 화면 새로고침.

#### S08. 과정별 출결

- **목적**: 과정 전체 회차에 걸친 출결 현황을 훈련생×회차 매트릭스로 조회
- **주요 사용자**: OPS_MANAGER, EXECUTIVE, INSTRUCTOR(본인 배정 회차만)
- **화면 구성**: 과정 선택 + 훈련생(행) × 회차(열) 매트릭스
- **검색조건**: 과정(필수)
- **필터**: 훈련생명, 출결상태
- **테이블 컬럼**: 훈련생명(고정 열) / 회차1..N(각 셀에 출결상태 약어 badge, attendance 행이 없는 셀은 "미출결"로 계산 표시 — **C1**) / 출석률(분모는 미출결 포함 전체 회차 수)
- **버튼**: 셀 클릭 시 상세/수정 진입(미출결 셀 클릭 시 입실확인/결석확정, 기존 셀 클릭 시 S09)
- **클릭 시 이동**: 셀 → 출결 수정(S09), 훈련생명 → 훈련생 상세(S05)
- **저장되는 데이터**: 없음(조회), 수정은 S09에서 처리
- **권한**: OPS_MANAGER(CRUD 진입점), EXECUTIVE(R), INSTRUCTOR(R, 본인 배정 회차 열만 노출)
- **예외 상황**: 회차 수가 많아 가로 스크롤이 생기면 훈련생명 열을 고정(sticky)

#### S09. 출결 수정(모달)

- **목적**: **이미 존재하는** 출결 건을 사유와 함께 정정(STEP 4.4). 아직 attendance 행이 없는 "미출결" 대상자의 최초 입실확인·결석확정은 S07에서 직접 처리하며 이 화면(S09)의 대상이 아니다(**C1**: 최초 생성과 이후 수정을 구분).
- **주요 사용자**: OPS_MANAGER
- **화면 구성**: 모달 — 변경 전 값 표시 + 변경 후 입력 폼
- **입력 필드**: 입실시간, 퇴실시간, 출결상태, 수정사유(필수)
- **버튼**: 저장, 취소
- **클릭 시 이동**: 저장 후 모달 닫힘, 호출 화면(S07/S08) 갱신
- **저장되는 데이터**: `attendance` update + `attendance_change_log` insert + `audit_log` insert(단일 트랜잭션)
- **권한**: OPS_MANAGER만(STEP 2.2 — 출결 수정은 강사·책임자 권한 없음)
- **예외 상황**: 사유 미입력 시 저장 차단. 이 수정으로 규칙 05·06 임계치를 초과하게 되면 저장은 허용하되 "이 수정으로 확인 필요 사항이 생성될 수 있습니다" 안내 배너 노출.

#### S10. 출결 수정이력

- **목적**: `attendance_change_log` 조회(규칙 05·06의 판단 근거와 동일 데이터)
- **주요 사용자**: OPS_MANAGER, EXECUTIVE, SYS_ADMIN
- **검색조건**: 과정, 훈련생명, 기간
- **테이블 컬럼**: 변경일시 / 훈련생명 / 회차 / 변경 전(입실/퇴실/상태) / 변경 후 / 변경자 / 사유
- **버튼**: 없음(조회 전용)
- **클릭 시 이동**: 훈련생명 → 훈련생 상세(S05)
- **권한**: R only. INSTRUCTOR 접근 불가
- **예외 상황**: 동일 건 반복 수정은 시간순으로 전체 이력을 노출(일부만 보여주지 않음)

### 강사 관리 (S11~S14)

#### S11. 강사 목록

- **목적**: 강사 인적정보 및 담당 과정 현황 조회
- **주요 사용자**: OPS_MANAGER, EXECUTIVE, INSTRUCTOR(본인만)
- **검색조건**: 성명, 상태
- **테이블 컬럼**: 성명 / 연락처 / 상태(활동/비활동) badge / 담당 과정 수
- **버튼**: 신규 등록(→S12), 배정 관리(→S13)
- **클릭 시 이동**: 행 클릭 → 강사 상세 정보(S12 재사용, 조회 모드)
- **저장되는 데이터**: 없음(조회), 등록/수정은 S12
- **권한**: OPS_MANAGER(CRUD), INSTRUCTOR(본인 R), EXECUTIVE(R)
- **예외 상황**: 비활동으로 전환 시 진행중인 `instructor_assignment`가 있으면 경고 표시(전환은 허용, 대체 배정 필요 안내)

#### S12. 강사 등록/수정

- **목적**: 강사 인적정보 입력/수정
- **입력 필드**: 성명(필수), 연락처, 상태(활동/비활동)
- **버튼**: 저장, 취소
- **저장되는 데이터**: `instructor` insert/update, 수정 시 `instructor_change_log`(entity_type=INSTRUCTOR) insert
- **권한**: OPS_MANAGER(CRUD)
- **예외 상황**: `user_account.linked_instructor_id`로 연결된 로그인 계정이 있으면 계정 정보를 읽기전용으로 함께 표시(계정 자체 관리는 S25)

#### S13. 강의 일정 / 교육일정

- **목적**: 회차별 일정 생성·조회, 강사 배정(STEP 3.4 — 강사관리/과정운영 두 진입점, 데이터·화면은 1개)
- **주요 사용자**: OPS_MANAGER(CRUD), INSTRUCTOR(R, 본인만)
- **화면 구성**: 캘린더 뷰 + 리스트 뷰 토글
- **검색조건**: 강사 진입 시 `instructor_id`, 과정 진입 시 `course_id`(STEP 3.4)
- **테이블 컬럼**: 회차 / 교육일 / 시작~종료시간 / 강사명 / 내용 / 상태(저장값 예정/휴강 + 계산값 진행완료 — 베이스라인 정합화)
- **입력 필드**: 회차(round_no), 교육일, 시작/종료시간, 강사 선택, 내용, 상태
- **버튼**: 신규 회차 추가, 휴강 처리, 강사 재배정
- **상태값**: 예정 / 진행완료 / 휴강
- **클릭 시 이동**: 회차 클릭 → 회차별 운영일지(S17) 해당 회차
- **저장되는 데이터**: `class_schedule` insert/update, `instructor_assignment` 연동 갱신, 강사 변경 시 `instructor_change_log`(entity_type=ASSIGNMENT) insert
- **권한**: OPS_MANAGER(CRUD), INSTRUCTOR(R, 본인 배정 회차만 — STEP 2.4)
- **예외 상황**: UNIQUE(course_id, round_no) 위반 방지, 동일 강사·동일 시간대 중복 배정 시 경고. 휴강 처리 시 사유 입력을 요구하고 해당 회차의 출결 입력(S07)을 비활성화한다(STEP 8.1 규칙 03·04 제외 처리와 연동).

#### S14. 강사 변경이력

- **목적**: `instructor_change_log` 조회
- **테이블 컬럼**: 변경일시 / 대상 구분(INSTRUCTOR/ASSIGNMENT) / 변경자 / 변경 전 / 변경 후 / 사유
- **버튼**: 없음(조회 전용)
- **권한**: R only. INSTRUCTOR 접근 불가

### 과정 운영 (S15~S18)

#### S15. 과정 목록

- **목적**: 전체 과정 조회·검색
- **주요 사용자**: 전 역할(스코프에 따라 R)
- **검색조건**: 과정명, 상태, 기간, 담당자
- **테이블 컬럼**: 과정명 / 기간 / 교육장 / 담당자 / 상태 badge / 확정 훈련생 수
- **버튼**: 신규 과정 등록(→S16)
- **클릭 시 이동**: 행 클릭 → 과정 상세(S16)
- **권한**: R(전체), OPS_MANAGER(C 추가)

#### S16. 과정 등록/수정/상세(+ 종료 체크리스트)

- **목적**: 과정 기본정보 관리 및 상태 전이(운영중 전환, 종료 처리) 수행(STEP 4.1, 4.6)
- **화면 구성**: 기본정보 폼 + 탭(훈련생 / 강사배정 / 교육일정 요약 / 종료 체크리스트)
- **입력 필드**: 과정명, 시작일, 종료일, 총교육시간, 교육장, 담당자, 상태
- **버튼**: 저장, 운영중 전환, 종료 처리(체크리스트 모달), 중단 처리
- **상태값**: 준비중 / 모집중 / 운영중 / 종료 / 중단(전이 규칙: STEP 1.3)
- **종료 체크리스트 항목**: 출결 미처리 건수(→S08), 확인 필요 미종결 건수(→S22), 운영일지 누락 건수(→S17), 결과물 미완료율(→S19) — 각 항목 클릭 시 해당 화면으로 이동
- **저장되는 데이터**: `course` insert/update, 상태 전이 시 `audit_log`에 스냅샷 포함 기록
- **권한**: OPS_MANAGER(CRUD), 나머지 R
- **예외 상황**: 확정 훈련생 0명 상태에서 운영중 전환 시 경고 후 진행 허용. 종료를 강행할 경우 사유 입력 모달을 필수로 띄운다(STEP 4.6 예외 흐름).

#### S17. 회차별 운영일지 목록/작성

- **목적**: 회차별 운영일지 작성·조회
- **주요 사용자**: INSTRUCTOR(작성), OPS_MANAGER(검수)
- **화면 구성**: 회차 목록 + 작성/조회 폼
- **검색조건**: 과정, 회차, 작성일
- **테이블 컬럼(목록)**: 회차 / 교육일 / 강사 / 작성여부 badge / 참여인원
- **입력 필드**: 교육내용(필수), 참여인원(필수), 특이사항(선택), 첨부파일
- **버튼**: 저장, 첨부파일 추가, 특이사항으로 등록(→S18 연계)
- **저장되는 데이터**: `operation_log` insert/update, `attachment`(entity_type=OPERATION_LOG) insert
- **권한**: INSTRUCTOR(본인 회차 CRUD), OPS_MANAGER(R, 검수 목적 U — STEP 2.2)
- **예외 상황**: 미작성 회차는 대시보드(S01)·종료 체크리스트(S16)에서 누락 건수로 집계. 휴강 회차는 작성 대상에서 제외.

#### S18. 특이사항 목록/등록

- **목적**: 교육 중 발생한 특이사항 기록 및 확인 필요 전환(STEP 8.3 수동 생성 경로)
- **주요 사용자**: INSTRUCTOR(등록), OPS_MANAGER(처리)
- **검색조건**: 과정, 회차, 상태
- **테이블 컬럼**: 등록일 / 과정 / 회차 / 카테고리 badge / 내용 요약 / 상태 badge / 등록자
- **입력 필드**: 카테고리(시설/민원/안전/기타), 내용(필수), 관련 회차(선택)
- **버튼**: 등록, "확인 필요로 전환"(OPS_MANAGER·EXECUTIVE만), 조치완료 처리
- **상태값**: 등록 / 확인중 / 조치완료. **연동 규칙(H6 베이스라인 확정)**: "확인 필요로 전환"을 실행하면 `course_issue.status`가 자동으로 확인중이 된다. 이후 두 상태는 독립적으로 관리한다 — 연결된 `verification_case`가 종결돼도 `course_issue.status`는 자동 변경되지 않으며 OPS_MANAGER가 "조치완료 처리"로 직접 닫는다. S18 목록은 연결된 확인 건의 현재 상태를 참고 열로 함께 보여준다.
- **클릭 시 이동**: "확인 필요로 전환" 클릭 → 확인 필요 상세(S23) 신규 생성 후 이동
- **저장되는 데이터**: `course_issue` insert/update, 전환 시 `verification_case` insert(`detection_rule_id`=MANUAL, `related_course_issue_id` 연결) + 관련 훈련생을 선택했다면 `verification_case_trainee` insert(선택 사항 — STEP 8.3, C3)
- **권한**: INSTRUCTOR(C, 본인 회차 한정), OPS_MANAGER(CRUD+전환), EXECUTIVE(R+전환)
- **예외 상황**: 이미 확인 필요로 전환된 특이사항을 재전환 시도하면 신규 생성 대신 기존 사건으로 안내(STEP 8.4 중복 방지 원칙과 동일)

### 결과물 관리 (S19~S21)

#### S19. 결과물 제출현황 — **[C2 반영, D-01 확정: 담당자 등록]**

- **목적**: 과정별 결과물 제출 현황 조회 및 **운영담당자에 의한 결과물 등록**
- **조회 로직**: `trainee_enrollment`(확정)를 `submission`에 LEFT JOIN — 매칭 없으면 "미제출"로 계산 표시(C1과 동일 원칙)
- **검색조건**: 과정, 훈련생명
- **테이블 컬럼**: 훈련생명 / 과정 / 제출일(submitted_at, 훈련생이 실제 제출한 시점) / 등록일시(created_at, 담당자가 시스템에 등록한 시점) / 제출상태 badge(미제출=계산값·행 없음 / 제출됨·기한후제출=저장값) / 검토상태 badge(대기/적합/보완요청/부적합) / 버전 / 등록자(created_by)
- **입력 필드(결과물 등록 시)**: 훈련생 선택, 제목, 파일, 원본 제출 일시(submitted_at, 수기 입력)
- **버튼**: "결과물 등록"(미제출 대상자 대상, submission 신규 INSERT), 재등록(기존 대상, version 증가 + 파일 교체), 행별 "검토"(→S21)
- **클릭 시 이동**: 행 클릭 → 결과물 검토(S21)
- **저장되는 데이터**: `submission` insert(신규 등록) 또는 update(재등록, version 증가), `attachment`(entity_type=SUBMISSION) insert
- **권한**: OPS_MANAGER(CRUD — 등록 포함), EXECUTIVE(R), INSTRUCTOR(R, 본인 배정 과정만 — STEP 2.2)
- **재검토 조건**: 운영정책이 훈련생 직접 제출로 바뀌면 이 화면의 "결과물 등록"은 대리입력 기능으로 남고 훈련생 전용 제출 화면·TRAINEE 역할이 추가된다(D-01 재검토, 부록 F 비교표).

#### S20. 결과물 미제출 목록

- **목적**: 미제출자만 필터링해 독려 관리
- **필터**: `submission` 레코드 자체가 없는 대상자(계산상 미제출, **C1과 동일 원칙**) + `submit_status`=기한후제출, 제출기한 경과 여부
- **테이블 컬럼**: 훈련생명 / 과정 / 제출기한 / 경과일수 / 연락처
- **버튼**: 없음(조회 전용, 독려 연락은 시스템 외부 조치이며 시스템에 기록하지 않는다 — C2 재해석상 미제출 대상자는 `submission` 행이 없어 메모를 저장할 곳이 없으므로 기존 "독려 메모" 기능을 제거. "결과물 등록"은 S19에서 수행)
- **저장되는 데이터**: 없음(조회 전용). **[결정 필요]** "제출기한 경과" 판정과 경과일수 표시에 필요한 제출기한을 저장할 컬럼이 현재 스키마에 없음 — STEP 12 결정사항 #5(결과물 제출 단위)와 함께 확정 전까지 이 두 항목은 개발 보류
- **권한**: OPS_MANAGER(R,U), EXECUTIVE(R), INSTRUCTOR(R, 본인 배정 과정만 — STEP 2.2)

#### S21. 결과물 검토(상세+검토입력)

- **목적**: 결과물 열람 및 검토결과 기록
- **화면 구성**: 파일 미리보기/다운로드 + 검토 폼 + 검토이력 타임라인(버전별)
- **입력 필드**: 검토결과(적합/보완요청/부적합), 검토내용
- **버튼**: 저장, 보완요청(→훈련생에게 시스템 외부로 전달, 담당자가 S19에서 재등록 대기)
- **저장되는 데이터**: `submission_review_log` insert(version 포함), `submission.review_status` 갱신
- **권한**: OPS_MANAGER(CRUD). INSTRUCTOR 접근 불가(STEP 2.2·STEP 4.5 — 결과물 검토는 운영담당자 권한만, H4 수정 반영). EXECUTIVE(R)
- **예외 상황**: 보완요청 후 재제출 대기 중인 상태에서 담당자가 S19에서 새 버전을 등록하면 이전 버전 검토이력과 구분해 표시(version 필드 기준)

### 확인/조치 관리 (S24)

S22(확인 필요 목록)·S23(확인 필요 상세)는 STEP 7 참고.

#### S24. 조치이력 조회

- **목적**: `verification_action_log`를 사건 단위가 아닌 통합 뷰로 조회(운영 현황 파악·감사 목적)
- **주요 사용자**: OPS_MANAGER, EXECUTIVE, SYS_ADMIN
- **검색조건**: 과정, 담당자, 기간, action_type
- **테이블 컬럼**: 처리일시 / 사건ID / 액션유형(확인/상태변경/조치입력/종결/재오픈) / 처리자 / 이전상태→이후상태 / 메모
- **클릭 시 이동**: 사건ID 클릭 → 확인 필요 상세(S23)
- **저장되는 데이터**: 없음(조회 전용)
- **권한**: R(OPS_MANAGER, EXECUTIVE, SYS_ADMIN). INSTRUCTOR 접근 불가

### 시스템 관리 (S25~S27)

#### S25. 사용자 목록/등록/수정

- **목적**: 계정 생성, 역할 부여, 비활성화
- **입력 필드**: 로그인ID, 이름, 이메일, 역할(MVP는 1인 1역할 권장), 강사 연결(`linked_instructor_id`, INSTRUCTOR 역할 부여 시)
- **버튼**: 저장, 비밀번호 초기화, 비활성화
- **저장되는 데이터**: `user_account` insert/update, `user_role` insert/update
- **권한**: SYS_ADMIN만(STEP 2.2)
- **예외 상황**: INSTRUCTOR 역할 부여 시 `linked_instructor_id`가 없으면 저장 차단(STEP 2.4 데이터 스코프 판정의 필수 전제)

#### S26. 권한(역할) 관리

- **목적**: `role_permission`(화면×기능 권한) 조정
- **화면 구성**: 역할×화면ID×액션(C/R/U/D/A) 매트릭스 편집 화면
- **버튼**: 저장
- **저장되는 데이터**: `role_permission` update
- **권한**: SYS_ADMIN만
- **예외 상황**: MVP는 STEP 2.2 매트릭스에 대응하는 4개 역할 고정 조회·조정 위주로 제공하며, 커스텀 역할 생성은 STEP 12 결정사항 #7에 따라 향후 확장

#### S27. 감사로그 조회

- **목적**: `audit_log` 조회
- **검색조건**: 사용자, 대상 테이블, action, 기간(필수 — 대용량 방지)
- **테이블 컬럼**: 작업일시 / 사용자 / 액션 / 대상 테이블 / 대상ID / IP / 사유
- **클릭 시 이동**: 행 클릭 → 상세 팝업(before/after JSON diff)
- **권한**: SYS_ADMIN, EXECUTIVE만(STEP 2.2)
- **예외 상황**: 기간 미지정 조회는 차단하고 기본 조회범위(예: 최근 30일)를 강제한다

---

## STEP 8. 확인 필요 사항 탐지 규칙 (MVP: 규칙 기반)

### 8.1 규칙 정의

모든 규칙은 실행 결과로 `verification_case`를 생성하며, 초기 상태는 "확인 필요"(우선순위가 높다고 판단되는 규칙은 "우선 확인")로 설정한다. 파라미터는 `detection_rule.params`에서 기관이 조정 가능하도록 설계한다(하드코딩 금지). 모든 규칙은 대상 회차의 `class_schedule.status`≠휴강인 경우에만 평가한다.

| 규칙 | 코드 | 조건(제안 기본값) | 판단 데이터 | 연루 훈련생(verification_case_trainee) |
|---|---|---|---|---|
| 01 동일 환경 복수 출결 | RULE_01 | 동일 `related_info.device_id`(또는 위치)에서 서로 다른 훈련생 N명(기본 3명) 이상의 출결이 M분(기본 10분) 이내 발생. **적용 범위(H5)**: `related_info`가 채워지는 공식/연계자동 출결 건에만 적용되며, 내부수기 입력에는 사실상 적용되지 않는다 | attendance.related_info, check_in_time | **N명**(매칭된 전원, C3) |
| 02 짧은 시간 내 복수 계정 출결 | RULE_02 | 동일 출결 채널에서 K건(기본 5건) 이상이 T분(기본 5분) 이내 연속 발생. 적용 범위는 RULE_01과 동일(H5) | attendance.check_in_time | **N명**(매칭된 전원, C3) |
| 03 회차 운영기록 지연 | RULE_03 | **[C5 재정의]** 회차 종료시간(class_schedule.end_time) 경과 후 Z시간(기본 3시간) 지나도 해당 회차의 `operation_log`가 존재하지 않음(대상 회차 status≠휴강). 기존의 "입실 후 60분 내 현장정보 미확인"(훈련생 개별 현장 확인) 의미는 폐기 — 상세는 8.1-A 참고 | class_schedule.end_time, class_schedule.status, operation_log 존재 여부 | **0명**(회차·운영 단위 이슈, 훈련생 무관) |
| 04 퇴실정보 누락 | RULE_04 | 교육 종료시간(class_schedule.end_time) 경과 후 Y시간(기본 2시간, 또는 익일 배치) 지나도 check_out_time NULL, **단 attendance_status IN (출석, 지각)인 행만 대상**(대상 회차 status≠휴강). **C1 재설계 중 신규 발견**: attendance_status=결석/인정결석 행도 check_out_time이 항상 NULL이므로 이 조건을 넣지 않으면 정상적인 결석 확정 건까지 "퇴실 누락"으로 오탐한다 — 부록 F 참고. attendance 행이 아예 없는 "미출결"(무단결석 가능성 포함)은 이 규칙의 대상이 아니다 — 미출결은 STEP 4.6 종료 체크리스트의 "출결 미처리"로 별도 집계 | attendance.check_out_time, attendance.attendance_status, class_schedule.end_time, class_schedule.status | **1명**(해당 훈련생, C3) |
| 05 반복적인 출결 수정 | RULE_05 | 동일 trainee_id(또는 동일 과정) 기준 Z일(기본 30일) 내 출결 수정 건수가 N회(기본 3회) 이상 | attendance_change_log 집계(trainee_id 비정규화 컬럼 활용, **actor_type=USER 행만**) | **1명**(해당 훈련생, C3) |
| 06 출결상태 반복 변경 | RULE_06 | 동일 attendance_id 또는 동일 trainee_id에서 특정 상태 조합(예: 결석↔출석)이 N회(기본 2회) 이상 반복 | attendance_change_log.before_value/after_value(**actor_type=USER 행만**) | **1명**(해당 훈련생, C3) |
| 07 공식-내부 정보 불일치 | RULE_07 | 공식 출결 데이터(`attendance_source_raw`로 수신)와 기존 `attendance`(source_type=내부수기/연계자동) 레코드 간 상태/시간 차이가 임계치(기본 15분 또는 상태 불일치) 초과 — 상세 처리 흐름은 8.2 | attendance_source_raw, attendance | **1명**(해당 훈련생, C3) |
| — (수동 생성) | MANUAL | 규칙 조건 없음 — 담당자가 특이사항 등에서 직접 "확인 필요로 전환"을 클릭한 경우 | course_issue 등 (STEP 8.3) | **0~1명**(특이사항이 특정 훈련생과 관련된 경우 담당자가 수동으로 연결, 그 외 0명) |

### 8.1-A 규칙 03 재정의 근거 (C5)

- **기존 문제**: "입실 후 60분 내 현장정보 미확인"의 판단 데이터로 `operation_log.written_at`을 썼으나, 운영일지는 STEP 4.2 프로세스상 교육 종료 후 작성되는 것이 정상이다. 60분보다 긴 회차는 사실상 매번 오탐되는 구조였다.
- **검토한 대안**: (1) 회차 중간에 훈련생별 현장 재확인 이벤트(예: `attendance_verification_event` 신설)를 새로 만드는 안, (2) 기존 데이터(운영일지·회차 종료시각)만으로 판단 범위를 축소하는 안.
- **채택한 방향**: (2)를 채택했다. 훈련생 개별의 "현장에 실제로 있는지"를 중간에 재확인할 데이터 소스가 현재 시스템에 전혀 없으므로(카드 재태깅, 중간 QR 등 없음), 근거가 불충분한 규칙을 무리하게 유지하는 대신 **판단 가능한 것만 규칙화**했다 — "회차가 끝났는데도 운영기록 자체가 없다"는 사실은 기존 데이터로 확실히 판단할 수 있으므로 이를 규칙 03으로 재정의했다. 이 규칙은 특정 훈련생의 부정을 시사하지 않으며, 운영 공백을 담당자에게 알리는 course/schedule 단위 이슈로 분류한다(`verification_case_trainee` 0행).
- **새 이벤트 데이터 소스가 생기면**: 향후 기관이 중간 출결 재확인 장비/절차를 도입하면 별도 규칙(예: RULE_08)으로 "훈련생 개별 중간 현장 확인"을 다시 설계할 수 있다. 이 시점의 데이터 구조(신규 이벤트 테이블 신설 여부 포함)는 그때 재검토한다 — STEP 12 결정사항에 이 도입 여부를 새 항목으로 추가했다.

### 8.1-B 다중 훈련생 사건 생성 규칙 (C3)

- 규칙 01·02가 매칭되면, 매칭된 모든 훈련생에 대해 `verification_case_trainee` 행을 각각 생성한다(1 case : N trainee).
- 동일 사건 활성 기간 중 추가로 연루된 훈련생이 발견되면(예: 같은 device_id에서 시차를 두고 추가 출결 발생), 신규 case를 만들지 않고 기존 case에 `verification_case_trainee` 행만 추가한다(STEP 8.4 중복 방지 원칙의 연장).
- 규칙 04·05·06·07 및 MANUAL은 기존과 동일하게 훈련생 0~1명을 연결한다.

### 8.1-C 중복 판정 키(dedupe_key)

활성(종결 전) 건 중 아래 키가 같은 건이 있으면 신규 생성 대신 `evidence.items`에 추가한다(STEP 8.4). RULE_01: `course·schedule·device_id` / RULE_02: `schedule·출결채널` / RULE_03: `schedule` / RULE_04: `attendance_id` / RULE_05: `trainee·집계기간 시작일` / RULE_06: `trainee·상태조합` / RULE_07: `attendance_id`. MANUAL은 중복 판정 대상이 아니며 같은 특이사항의 재전환만 차단한다(STEP 7-A S18).

### 8.2 공식-내부 출결 대사(reconciliation) 처리 흐름

`attendance`는 훈련생×회차당 1개 레코드만 존재하므로(UNIQUE(trainee_id, schedule_id)), 공식 데이터와 내부 데이터를 별도 행으로 병존시키지 않는다. 대신 공식 데이터는 `attendance_source_raw`에 우선 적재한 뒤 아래 배치 로직으로 병합한다. (C1과의 정합성: attendance는 "실제 이벤트가 있을 때만 생성"되므로, 아래 3번 케이스의 "레코드 없으면 신규 생성"이 곧 최초 이벤트 발생 시점의 생성이다 — 별도 placeholder를 미리 만들어 두지 않는다.)

1. 공식 출결 데이터 수신 → `attendance_source_raw`에 적재(processed=false)
2. 배치가 미처리 raw 레코드를 순회하며 동일 (trainee_id, schedule_id)의 `attendance` 존재 여부 확인
3. 레코드가 없으면 → 공식 데이터로 `attendance` 신규 생성(source_type=공식), raw.processed=true
4. 레코드가 있고 이미 source_type=공식이면 → 정정 성격으로 판단해 최신 공식값으로 갱신(`attendance_change_log` 기록), raw.processed=true
5. 레코드가 있고 source_type≠공식(내부수기/연계자동)이면 값을 비교한다:
   - 임계치 이내 일치 → 공식값으로 갱신하고 source_type을 공식으로 전환("공식 출결정보가 존재하면 기준 데이터로 사용" 원칙 반영), `attendance_change_log` 기록, raw.processed=true
   - 임계치 초과 불일치 → `attendance`는 변경하지 않고 규칙 07 `verification_case`를 생성(evidence에 공식값·내부값을 그대로 병기), raw.processed=true(케이스로 이관됨). 담당자가 확인 필요 상세(S23)에서 검토 후 필요 시 별도로 `attendance`를 수정한다(자동 덮어쓰기 없음)

### 8.3 수동 생성 경로 (특이사항 → 확인 필요)

규칙 01~07은 출결·운영일지 데이터에 대한 자동 탐지에 한정된다. 특이사항(`course_issue`)에서 기인하는 확인 필요 사항은 자동으로 탐지되지 않으므로, 담당자가 특이사항 상세(S18)에서 "확인 필요로 전환" 버튼을 눌러 수동으로 생성한다.

- 생성되는 `verification_case`는 `detection_rule_id`=MANUAL, `related_course_issue_id`=해당 특이사항, `evidence`=특이사항 원문 스냅샷으로 채워진다. 특이사항이 특정 훈련생과 관련된 경우 담당자가 전환 시 훈련생을 선택해 `verification_case_trainee`에 1행을 추가할 수 있다(선택 사항, C3).
- 이후 처리 흐름(확인중 → 조치필요/확인완료 → 조치완료)은 자동 탐지 건과 완전히 동일하다(STEP 4.3).

### 8.4 공통 처리 원칙

- 탐지 결과 상태값은 반드시 다음 7개 중립 상태만 사용한다: **확인 필요 / 우선 확인 / 확인 중 / 확인 완료 / 추가 확인 / 조치 필요 / 조치 완료**
- 탐지근거(`evidence`)는 반드시 "무엇을 비교해서 어떤 조건에 매칭되었는지"를 데이터 그대로 기록한다(예: "10:02, 10:03, 10:04에 device_id=A에서 3건의 입실 기록"). 원인이나 의도에 대한 해석 문구를 시스템이 생성하지 않는다.
- 동일 원인으로 중복 이벤트가 반복 생성되지 않도록, 활성(미종결) 상태의 동일 규칙/동일 대상 이벤트가 이미 있으면 새로 생성하지 않고 기존 건에 근거만 누적한다. **누적 구조(베이스라인 확정)**: `evidence`는 `{"dedupe_key": "...", "items": [ {detected_at, 사실 데이터...}, ... ]}` 형태의 JSON이며, 근거 추가는 `items` 배열에 append만 한다(기존 항목 수정 금지). 추가할 때마다 `audit_log`(actor_type=SYSTEM_RULE, action=UPDATE, before/after)에 남긴다. 중복 판정 키(`dedupe_key`)는 규칙별로 8.1의 표에 정의한다.
- 규칙 파라미터(N, T, X, Y, Z 등)는 시스템 관리자가 `detection_rule` 화면(시스템 관리 하위, MVP 이후 확장 가능)에서 조정 가능하도록 설계하되, MVP에서는 설정 파일/DB 시드값으로 시작해도 무방하다.

---

## STEP 9. 변경이력 및 감사로그 구조

### 9.1 두 체계의 역할 구분

| 구분 | 목적 | 대상 | 노출 대상 | 필수 입력 |
|---|---|---|---|---|
| 변경이력(`*_change_log`) | 업무적으로 "왜 바뀌었는지"를 설명 | 훈련생/강사/출결 등 핵심 업무 데이터의 **수정**(최초 생성은 대상 아님, 아래 참고) | 실무자(운영담당자 등) | 변경사유 |
| 감사로그(`audit_log`) | 시스템 전역의 "누가(또는 무엇이) 무엇을 했는지" 기술적 증적 | 전체 테이블의 CUD(및 민감 조회) — 사람/시스템 행위 모두 포함(**C4**) | 시스템관리자/책임자 | 사유 선택(시스템 행위는 `reason`에 규칙/배치 식별자 필수) |

두 로그는 중복 저장되더라도 목적이 다르므로 통합하지 않는다. 예: 출결 수정 1건 발생 시 → `attendance` UPDATE + `attendance_change_log` INSERT(업무이력) + `audit_log` INSERT(actor_type=USER, 전역기록) 3개가 동시에 발생.

**C1 반영 — 생성과 수정의 구분**: `attendance`(및 동일 원칙을 따르는 `submission`)는 최초 INSERT(입실확인/결석확정/제출등록)가 "무엇을 바꿨는지"를 설명할 대상 자체가 없으므로 `attendance_change_log`를 남기지 않는다. 이미 존재하는 값을 다시 바꿀 때만(S09 출결 수정 등) `attendance_change_log`가 발생한다. 반면 `audit_log`는 생성이든 수정이든 모든 CUD에 대해 남는다 — "미출결에서 출석으로" 최초 확정되는 순간도 `audit_log`에는 CREATE로 기록되지만, `attendance_change_log`에는 남지 않는다.

### 9.2 구조 정책

- **불변성**: `*_change_log`, `audit_log`, `verification_action_log`는 모두 append-only. UPDATE/DELETE API를 제공하지 않는다(애플리케이션 레벨과 DB 권한 레벨 이중 통제 권장).
- **생성 시점**: 트랜잭션 내에서 원본 데이터 변경과 이력 저장이 원자적으로 처리되어야 한다(둘 중 하나만 성공하는 상황 방지).
- **보존기간**: 법정 보존기간(개인정보보호법, 근로기준법 등 관련 법령) 확인 후 정책 수립 필요 — STEP 12 결정사항 참고. 기본안은 최소 5년 보관 후 아카이빙.
- **조회 권한**: 감사로그는 SYS_ADMIN, EXECUTIVE만 조회 가능. 변경이력은 해당 업무 화면 접근 권한을 가진 자는 조회 가능(OPS_MANAGER 포함).
- **자동화 지점**: 감사로그는 개별 화면 개발자가 매번 코드를 작성하는 대신, 서비스/ORM 레이어의 공통 미들웨어에서 자동 기록하도록 아키텍처를 설계한다(누락 방지). 이 부분은 Phase 1부터 프레임워크로 구축한다.
- **행위자 유형 결정(C4)**: 이 미들웨어는 요청 컨텍스트에 로그인 사용자가 있으면 `actor_type=USER`로, 배치·스케줄러 컨텍스트에서 실행되면 `actor_type=SYSTEM_BATCH`로, 탐지 엔진(STEP 8) 실행 컨텍스트면 `actor_type=SYSTEM_RULE`로 자동 태깅한다. 이 태깅 기준을 Phase 1 감사로그 프레임워크 설계 시 함께 확정한다.

---

## STEP 10. MVP 개발 우선순위

### Phase 1 — 기반 구축 (마스터 데이터 + 인프라)
- 사용자/권한(로그인, 역할 기반 접근 제어)
- 과정, 훈련생(대상자 포함 상태모델), 강사, 교육일정 CRUD
- **감사로그 기록 미들웨어**(화면/조회 UI는 후순위여도 기록 로직은 이 시점부터 반드시 가동, `actor_type`/`actor_user_id` 태깅 기준 포함 — **C4**)

### Phase 2 — 핵심 운영 (일상 업무)
- 출결: **미출결 계산 조회(LEFT JOIN) + 입실확인/결석확정/퇴실확인 시에만 attendance 생성**(C1), 출결 수정 및 전용 수정이력
- 회차별 운영일지, 특이사항
- 훈련생/강사 변경이력 화면

### Phase 3 — 내부통제 핵심가치 (시스템의 존재 이유)
- 탐지규칙 01~06 엔진 구현(배치 or 이벤트 기반). 규칙 03은 회차 종료 후 운영기록 지연 여부만 판단하도록 축소 재정의되어 별도 이벤트 데이터 없이 구현 가능(**C5**). 규칙 07은 공식 연동이 아직 없다면 "내부수기 vs 연계자동" 등 이중 입력 소스 간 비교로 축소 운영(공식 연동 확정 전까지의 임시 모드)
- `verification_case_trainee` 브릿지 테이블 및 규칙 01·02의 다중 훈련생 연결 로직(**C3**)
- 특이사항(S18) → 확인 필요 수동 전환 기능(MANUAL 경로, STEP 8.3)
- 확인/조치 관리(목록/상세/조치이력) 전체 워크플로우
- 대시보드(확인 필요 요약 포함)

### Phase 4 — 결과물 및 종료 프로세스
- 결과물 제출/미제출/검토 — **[결정 필요, C2]** 안 B(운영담당자 등록) 기준이면 S19에 등록 기능만 추가하면 되므로 기존 계획과 동일한 규모로 진행 가능. 안 A(훈련생 직접 제출) 채택 시 Phase 1로 TRAINEE 역할·로그인 체계가 소급 반영되어야 하므로 착수 전 반드시 확정 필요
- 과정 종료 체크리스트(미처리 출결 — 미출결·퇴실미확인 포함, 미종결 확인사항, 운영일지 누락, 결과물 완료율 검증)

### Phase 5 — 관리 고도화
- 감사로그 조회 UI 정식 제공(시스템 관리)
- 탐지규칙 파라미터 관리 화면(관리자용)
- 공식 출결시스템 연계(API/파일 연동 방식 확정 후) + `attendance_source_raw` 스테이징·대사(reconciliation) 배치 구현(STEP 8.2) → 규칙 07 정식 가동
- 권한 세분화, 엑셀 내보내기 등 편의 기능

> Phase 1~3까지 완료된 시점이 "출결관리 앱이 아니라 내부통제 시스템"이라는 목표가 실질적으로 달성되는 지점이다. Phase 3을 Phase 4보다 먼저 두는 이유는 요구사항 원문이 명시한 핵심 목적(판단이 아닌 확인 지원)이 결과물 관리보다 우선순위가 높기 때문이다.

---

## STEP 11. 향후 AI 분석 기능의 적용 위치

원칙: AI는 항상 "확인 필요 사항 식별을 보조"하는 위치에만 들어가며, 최종 상태 전이(조치완료 등)는 항상 사람이 수행한다. UI 문구에 "AI", "스마트", "지능형" 등의 마케팅 표현은 사용하지 않는다(원칙 10 준수 — 내부 업무시스템 톤 유지).

| 적용 후보 위치 | 방식 | 사람의 역할 유지 방법 |
|---|---|---|
| 탐지규칙 08 이후 확장(패턴/이상치 기반) | 규칙 기반으로 못 잡는 복합 패턴(예: 여러 규칙이 약하게 동시 발생)에 대해 스코어링 모델을 보조 신호로 추가 | 스코어는 `verification_case.evidence`에 참고 수치로만 추가, 상태 자동변경 금지 |
| 운영일지 초안 보조 | 강사가 입력한 메모를 정리된 문장으로 다듬는 보조(작성 보조, 자동 제출 아님) | 강사가 반드시 검토/수정 후 저장 |
| 결과물 유사도 검사 | 표절/유사 제출 여부를 참고 지표로 제공 | 검토자가 최종 판단, "부적합" 자동 처리 금지 |
| 공식-내부 데이터 불일치 설명 보조 | 규칙07 매칭 시 차이 내역을 사람이 읽기 쉬운 요약으로 변환 | 요약은 사실 나열만, 원인 추정 문구 생성 금지 |
| 감사로그/변경이력 대량 조회 시 검색 보조 | 자연어 질의 → 필터 조건 변환(예: "지난달 출결 수정 3회 이상 훈련생") | 검색 결과만 필터링, 데이터 자체는 변경하지 않음 |

이 확장 기능들은 모두 Phase 5 이후, 그리고 반드시 별도 옵트인 설정(기관이 켜고 끌 수 있음)으로 설계할 것을 권장한다.

---

## 개발에 들어가기 전에 추가로 결정해야 하는 사항

아래 항목은 추측으로 결정할 경우 데이터 구조/화면/개발 순서에 직접 영향을 주므로, 실제 개발 착수 전 반드시 확인이 필요하다.

1. **공식 출결시스템의 존재 및 연동 방식** — 이미 사용 중인 공식 출결 시스템이 있는가? 있다면 실시간 API 연동인가, 일 단위 파일(엑셀/CSV) 업로드인가, 없다면 이 시스템이 공식 출결의 1차 입력창구 역할까지 겸하는가? (attendance.source_type 설계, `attendance_source_raw`의 필요 여부, 규칙 07의 정식 가동 시점(STEP 8.2)에 직접 영향. 공식 시스템이 아예 없다면 `attendance_source_raw`는 불필요하며 규칙 07은 내부 입력 소스 간 비교로 대체하거나 제외한다.)
2. **출결 확인 환경/방식** — 카드 태깅, 생체인식, 모바일 QR, 수기 서명 중 무엇을 사용하는가? (규칙 01, 02의 `related_info` 항목 설계에 필요)
3. **[확정 2026-09-21, D-03] 단일 기관 운영** — 멀티테넌시·조직 계층 테이블은 두지 않는다. 다지점/다기관으로 운영 범위가 바뀌면 이 결정을 재검토하고 전 테이블·권한·API를 함께 변경한다
4. **훈련 대상자 모집 절차의 실제 형태** — 별도 모집공고/선발 절차를 거치는지, 단순 신청 후 서류 확인만 하는지 (trainee 상태모델의 세분화 수준 결정)
5. **결과물 제출 단위** — 과정 전체 1회 제출인지 회차별 제출인지, 파일 형식/용량 제한
6. **강사의 소속 형태** — 내부 소속 강사인지 외부 위촉 강사인지, 계약정보/강사료 관련 정보까지 이 시스템이 관리해야 하는지(현재 범위에는 없으나 향후 확장 가능성 확인)
7. **역할의 확장성 요구** — 제시된 4개 역할 고정으로 충분한지, 향후 기관이 커스텀 역할을 만들 수 있어야 하는지(권한 테이블 설계의 유연성 수준 결정)
8. **감사로그/변경이력 법정 보존기간** — 관련 법령(개인정보보호법 등) 기준 최소 보존기간 및 파기 절차 요구사항
9. **확인 필요 사항 처리 기한(SLA) 필요 여부** — "우선 확인" 건에 대해 기한 초과 시 에스컬레이션(상급자 자동 알림 등)이 필요한지
10. **모바일 접근 필요 여부** — 강사가 현장에서 모바일로 운영일지를 작성해야 하는지, 반응형 웹으로 충분한지 별도 앱이 필요한지
11. **정부/외부 시스템 연계 필요 여부** — HRD-Net 등 정부 보고 시스템과의 데이터 연계나 보고서 양식 출력이 필요한지
12. **첨부파일 저장 인프라** — 온프레미스 스토리지인지 클라우드(S3 등) 사용 가능한지, 파일 용량/보안(암호화) 요구수준
13. **확인 필요 사항 종결 시 승인 단계 필요 여부** — 운영담당자 단독 종결이 가능한지, EXECUTIVE의 최종 승인이 필요한 2단계 워크플로우인지
14. **알림/통지 채널** — 확인 필요 사항 발생 시 이메일/SMS/사내 메신저 등 외부 알림이 필요한지, 시스템 내 알림만으로 충분한지
15. **[확정 2026-09-21, D-01] 결과물 제출 주체 = 운영담당자 등록** — 훈련생은 시스템 사용자가 아니며 TRAINEE 역할·계정을 만들지 않는다. 훈련생 직접 제출로 정책이 바뀌면 재검토하고 STEP 2(역할)·STEP 5(user_account)·STEP 6/7-A(신규 화면)·API·권한을 함께 변경한다(부록 F 비교표 참고)
16. **[C5] 훈련생 개별 중간 현장확인 이벤트 도입 여부** — 카드 재태깅, 중간 QR 스캔 등 교육 중간에 훈련생의 실제 현장 존재를 재확인할 별도 장비/절차를 도입할 계획이 있는가? 있다면 그 데이터 소스에 맞춰 향후 규칙(예: RULE_08)과 신규 이벤트 테이블 설계가 필요하다(STEP 8.1-A 참고)
17. **과정 종료 시 미해결 항목 차단/경고 정책** — 출결 미처리(미출결 포함)·확인 필요 미종결·운영일지 누락·결과물 미완료 건이 있을 때 종료 자체를 차단할지, 경고 후 사유 입력으로 강행을 허용할지(STEP 4.6). 베이스라인은 항목별 기본 분류를 `baseline.md` 9절에 잠정 정의했으며 이 정책 확정 시 함께 조정한다
18. **[확정 2026-09-21, D-02] 운영담당자는 전체 과정 접근** — `course.manager_user_id`는 표시·책임 소재용이며 접근 제한에 쓰지 않는다. 담당 과정 제한 등으로 정책이 바뀌면 재검토하고 STEP 2.4 스코프와 모든 조회·수정 API 조건·권한을 함께 변경한다
19. **시스템 관리자의 업무 데이터 예외 수정 권한** — 현재 베이스라인은 조회 전용. 장애 대응 등으로 SYS_ADMIN이 업무 데이터를 직접 고쳐야 하는 경우를 허용할지(허용 시 범위·사유 입력·감사 방식 필요)
20. **결석 확정 권한** — 현재 베이스라인은 OPS_MANAGER 전용. 강사도 본인 회차의 결석을 확정할 수 있게 할지(결석은 수료·훈련비와 직결되는 판단성 기록이므로 권한 주체를 임의로 정할 수 없음)
21. **운영중 과정의 중도 등록 허용 여부** — 개강 후 신규 훈련생 등록을 허용할지, 허용한다면 별도 승인이 필요한지(STEP 1.2 P1 트리거 조건이 준비중/모집중으로만 서술됨)
22. **지각·조퇴 판정 기준** — 입실 유예시간(지각)과 조기 퇴실 기준(조퇴)을 시스템이 시각으로 자동 판정할지, 담당자가 선택할지(`attendance_status` 생성 시점의 값 결정 방식)
23. **수료/중도포기/제적 판정 기준과 처리 화면** — `trainee_enrollment.status`를 수료·중도포기·제적으로 바꾸는 기준(출석률 등)과 이를 수행하는 화면·권한이 현재 27개 화면에 없음
24. **결과물 제출기한의 저장 위치와 기준** — 기한후제출 판정과 S20의 경과일수 계산에 필요한 제출기한이 어느 엔티티(과정 단위/결과물 단위)에 속하는지(#5와 연동)
25. **출결 수정 허용 범위** — 수정 가능한 기간(예: 당월 한정), 과정 종료 후 수정 허용 여부와 그 승인 절차(STEP 4.6 예외 흐름의 "예외적 수정 경로")
26. **확인 건 조치 기준과 초기 상태 배정** — 어떤 규칙을 "우선 확인"으로 시작시킬지(`detection_rule.initial_status` 시드값), 확인완료와 조치필요를 가르는 판단 기준·조치 종류
27. **결석 확정 마감 시각** — 당일 미출결을 언제까지 확정해야 하는지(부록 F의 N1). 시스템은 자동으로 결석 처리하지 않으므로 마감 원칙이 없으면 미출결이 누적됨
28. **첨부파일·결과물 파일 보존기간** — 감사로그·변경이력 보존기간(#8)과 별개로 파일의 보존·파기 기준
29. **세션·비밀번호 정책값** — 세션 유효시간, 동시 로그인 허용, 비밀번호 복잡도·변경주기, 로그인 실패 잠금 횟수(감사로그 LOGIN_FAILED와 연동)
30. **과정 종료·강제 종료·중단 승인 권한** — 종료 실행은 OPS_MANAGER 단독인지, EXECUTIVE 승인이 필요한지, 경고 항목 강행(사유 입력)을 누가 할 수 있는지(#17·#13과 함께 확정)

---

# 개발 전 최종 검증 (부록)

> 이 부록은 기존 STEP 1~11 및 결정사항 목록의 내용을 변경하지 않고, "문서상으로는 맞지만 실제 개발 시 충돌하는 부분"만을 찾아내기 위해 작성한 별도 감사 결과다. 번호 충돌을 피하기 위해 STEP 대신 "부록 B/C/D"로 표기한다. 새로운 화면·기능은 추가하지 않았으며, 모든 발견사항은 본문(STEP 1~8, STEP 7-A)의 기존 서술을 근거로 한다.

> **[갱신 안내]** 아래 부록 B~D는 CRITICAL 5건(C1~C5)을 수정하기 **이전** 시점의 감사 스냅샷이다. C1~C5는 부록 F에서 해결되었으며, 그 결과 이 스냅샷에 등장하는 `attendance.attendance_status`="확인중", `verification_case.trainee_id`, `audit_log.user_id` 등 일부 필드명은 현재 STEP 5와 다르다(현재 정의가 항상 최신 기준이다). 이 기록은 "무엇이 왜 문제였는지"의 이력 보존을 위해 그대로 남겨둔다.

## 부록 B. 실제 업무 시나리오 검증 (20단계 추적)

아래 표는 시나리오 1~20단계를 실제 사용자가 수행한다고 가정하고 화면·데이터·권한·상태값·감사로그 관점에서 추적한 결과다. "⚠"로 표시된 셀은 부록 D의 findings 테이블 ID를 가리킨다.

| # | 단계 | 역할 | 화면 | 조회 데이터 | 생성/수정 데이터 | 상태값 변화 | 권한 확인 | 감사로그 | 다음 단계 조건 | 예외/문제 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 과정 생성 | OPS_MANAGER | S16 | 없음(신규) | `course` insert | (신규)→준비중 | ⚠STEP 2.2에 "과정" 행 자체가 없음(**H1**) | O | course_id 존재 | — |
| 2 | 교육생 등록 | OPS_MANAGER | S04 (STEP 4.1은 S02도 등록 경로로 언급하나 S02는 등록 입력 UI가 없음, **H2**) | 동일 성명+생년월일 `trainee` 존재 여부 | `trainee` insert(신규 시), `trainee_enrollment` insert(status=신청) | (신규)→신청 | 정상(STEP 2.2 "훈련생 등록/확정") | O | enrollment_id 존재 | 이미 등록된 과정에 동일 훈련생 재등록 시 UNIQUE 위반 처리 누락(**M5**) |
| 3 | 교육생 과정 배정 | OPS_MANAGER | 없음(S04가 등록과 배정을 한 액션으로 겸함, **M4**) | 2번과 동일 | 2번과 동일 | 2번과 동일 | 2번과 동일 | 2번과 동일 | — | **M4** |
| 4 | 강사 배정 | OPS_MANAGER | STEP 4.1은 S11이라 하나 실제 저장은 S13(**H3**) | `instructor`(status=활동) | `instructor_assignment` insert | 없음(status=배정 고정) | 정상(화면 지시만 불일치) | O | instructor_assignment 존재 | H3 |
| 5 | 교육일정 등록 | OPS_MANAGER | S13 | course, instructor_assignment | `class_schedule` insert(N건) | (신규)→예정 | 정상 | O | 회차 1개+배정 강사 존재(STEP 4.1 사후조건) | UNIQUE(course_id, round_no) |
| 6 | 교육 당일 출석(입실) | OPS_MANAGER/INSTRUCTOR | S07 | class_schedule(당일), 확정 훈련생 목록 | `attendance` insert/update(check_in_time) | 확인중→출석/지각/결석 | 정상 | O(단, 자동입력 시 행위자 모호) | 없음(회차 종료까지 지속) | **행 생성 시점(사전생성 vs 입실 시 생성) 자체가 불명확 → C1** |
| 7 | 퇴실 처리 | 동일 | S07 | 대상 attendance | check_out_time update | (조기퇴실만) 출석→조퇴, 판정기준 불명확(**M6**) | 정상 | O | 없음 | M6 |
| 8 | 미퇴실 발생 | 시스템(배치) | 없음(백엔드) | attendance(check_out_time NULL) — **행 자체가 없으면 조회 대상에서 누락(C1 연동)** | `verification_case` insert(RULE_04) | (신규)→확인필요/우선확인 | 해당없음(시스템 액션) | **행위자 없음 → C4** | 대시보드/목록 반영 | 무단결석(체크인 자체 없음)은 규칙04로 탐지 안 될 가능성 |
| 9 | 출결 수정 | OPS_MANAGER | S09 | 대상 attendance | attendance update + attendance_change_log insert + audit_log insert | 임의 상태 변경(사유 필수) | 정상(OPS_MANAGER만) | O | 없음 | 반복 수정 시 근거 누적 메커니즘 불명확(**M1**) |
| 10 | 동일 기기/환경 복수 출결 | 시스템(실시간) | 없음 | attendance.related_info — **S07에 캡처 입력경로 없음(H5)** | `verification_case` insert(RULE_01) | (신규)→확인필요/우선확인 | 해당없음 | C4 | 목록 반영 | **다수 훈련생을 단일 trainee_id로 표현 불가 → C3** |
| 11 | 확인 필요 항목 생성 | 시스템 | 없음→S01/S22 | detection_rule.params | verification_case insert | 확인필요/우선확인 | 해당없음 | C4 | 담당자 배정 | C3, C4 |
| 12 | 담당자 확인 | OPS_MANAGER/EXECUTIVE | S22→S23 | verification_case, evidence, 연관정보 | status 갱신, verification_action_log insert | 확인필요/우선확인→확인중 | 정상, INSTRUCTOR 메뉴 미노출 | O | 확인내용 입력 완료 | 동시처리 낙관적 잠금 |
| 13 | 확인 결과 및 조치 기록 | OPS_MANAGER/EXECUTIVE | S23 | 없음(입력 중심) | confirmation_note/action_note/status, verification_action_log insert | 확인중→확인완료 또는 조치필요→조치완료 | ⚠STEP 2.5(단독 종결 허용)와 STEP 7.3("결정 필요")이 서로 다른 전제(**M2**) | O | 없음(종결) | 필수입력 누락 시 차단 |
| 14 | 운영일지 작성 | INSTRUCTOR | S17 | class_schedule(본인 회차) | operation_log insert, attachment insert | 없음 | 정상 | O | 없음 | **규칙03의 60분 기준과 실제 작성 시점(교육 종료 후) 충돌 → C5** |
| 15 | 특이사항 등록 | INSTRUCTOR/OPS_MANAGER | S18 | 없음(신규) | course_issue insert, (전환 시) verification_case insert(MANUAL) | course_issue.status와 verification_case.status가 별도 생애주기(**H6**) | 정상 | O | 없음 | H6 |
| 16 | 결과물 제출 | 훈련생/강사 대리 | **S19~21 어디에도 업로드(CREATE) 기능 없음 → C2** | 해당없음 | submission insert — 화면 불명 | (신규)→제출됨, "미제출" 레코드 생성 시점도 불명 | 훈련생은 STEP 2.1 역할 체계에 없음 | 행위자 불명 | 없음 | **C2** |
| 17 | 결과물 검토 | ⚠STEP 4.5는 "운영담당자/강사"라 하나 STEP 2.2·S21은 INSTRUCTOR 접근불가(**H4**) | S21 | submission, attachment | submission_review_log insert, review_status update | 대기→적합/보완요청/부적합 | H4 모순 | O | 없음 | 재제출 시 버전 구분 |
| 18 | 과정 종료 | OPS_MANAGER | S16 | attendance, verification_case, operation_log, submission(체크리스트 4종) | course.status update | 운영중→종료 | 정상 | O(스냅샷 포함) | 체크리스트 통과 또는 강제종료 사유 입력 | 차단 여부 정책 미정(**M3**) |
| 19 | 과정 종료 전 최종 점검 | (18과 동일 체크리스트) | S16 | 동일 4개 지표 | — | — | — | — | — | "결과물 완료율"의 정의(제출 vs 검토)가 불명확(**M7**) |
| 20 | 감사로그 확인 | SYS_ADMIN/EXECUTIVE | S27 | audit_log(기간 필수) | 없음 | 없음 | 정상 | 해당없음(조회 자체는 로그 대상 아님) | 없음 | **C4로 인해 시스템 자동 행위 다수가 여기서 조회되지 않음** |

### 특히 주목할 3가지 유형

- **중간에 필요한 데이터가 존재하지 않는 단계**: 6단계(출결 레코드 존재 여부 자체가 불명, C1), 10단계(related_info 입력경로 없음, H5), 16단계(결과물 업로드 화면 자체가 없음, C2)
- **권한 때문에 업무가 막히는 단계**: 2단계(S02로 유도되지만 실제 등록 불가, H2), 17단계(프로세스 문서는 강사도 검토 가능하다지만 화면·권한 문서는 차단, H4)
- **상태값이 서로 충돌하는 단계**: 6단계("확인중" 상태의 존재 시점, C1), 13단계(종결 권한에 대한 두 절의 전제 불일치, M2), 15단계(특이사항과 확인필요 사항의 이중 생애주기, H6)

## 부록 C. 내부통제 검증 (이상징후 유형별 7단계 생애주기)

각 유형에 대해 "발견→전달→확인→판단→조치→이력→재검토"가 실제 화면·DB에서 끊기지 않고 연결되는지 검증했다. 공통적으로 판단 단계의 상태값은 7개 중립 상태(확인 필요/우선 확인/확인 중/확인 완료/추가 확인/조치 필요/조치 완료)만 사용하도록 되어 있고, 실제로 STEP 8.1·8.4·`verification_case.status` 정의 전체에서 "부정행위/부정수급" 등 판정성 표현은 발견되지 않았다 — 이 원칙 자체는 문서 전반에서 일관되게 지켜지고 있다.

| 유형 | 발견 | 전달 | 확인 | 판단 | 조치 | 이력 | 재검토 | 검증 결과 |
|---|---|---|---|---|---|---|---|---|
| 01 동일 환경 복수 출결 | attendance 저장 시 실시간 평가 | S01/S22 | S23 evidence + 연관정보(단일 훈련생 링크만) | verification_case.status(중립 상태 유지) | action_note | verification_action_log | 가능(단, S23 버튼 목록에 재오픈 버튼 누락, M8) | **문제**: related_info 캡처 경로 없음(H5), 다중 훈련생 표현 불가(C3) |
| 02 짧은 시간 내 복수 계정 출결 | 동일(실시간) | S01/S22 | S23(동일 제약) | 동일 | 동일 | 동일 | 동일 | **문제**: H5, C3 동일 적용 |
| 03 입실 후 장시간 현장정보 미확인 | 배치(15~30분 주기), 판단 데이터=operation_log.written_at | S01/S22 | S23 | 중립 상태 유지 | action_note | verification_action_log | 가능 | **문제**: 발견 조건 자체가 실제 운영일지 작성 시점(교육 종료 후, STEP 4.2)과 충돌 → 정상 수업 대부분이 상시 오탐 소지(C5) |
| 04 퇴실정보 누락 | 배치(일 1회), 판단 데이터=check_out_time NULL | S01/S22 | S23 | 중립 상태 유지 | action_note | verification_action_log | 가능 | **문제**: attendance 행 존재를 전제로 하므로 완전 무단결석은 탐지 누락 가능(C1 연동) |
| 05 반복적인 출결 수정 | 배치(일 1회), attendance_change_log 집계 | S01/S22 | S23(단, 근거는 스냅샷 1건) | 중립 상태 유지 | action_note | verification_action_log | 가능 | **문제**: 반복 수정마다 근거를 누적할 구조가 없음(M1) |
| 06 출결상태 반복 변경 | 배치(일 1회), before/after 조합 비교 | S01/S22 | S23(동일 제약) | 중립 상태 유지 | action_note | verification_action_log | 가능 | **문제**: M1 동일 적용 |

## 부록 D. 개발 전 최종 정합성 감사

| ID | 구분 | 문제 화면/테이블 | 현재 정의 | 발견된 문제 | 영향 | 수정안 | 우선순위 |
|---|---|---|---|---|---|---|---|
| C1 | DB↔상태값 | `attendance` | `attendance_status` DEFAULT=확인중("입실 전" 상태로 STEP 1.3에 정의), `source_type`은 NOT NULL이나 DEFAULT 없음 | 훈련생×회차별 attendance 행이 회차 생성 시 사전 일괄 생성되는지, 입실 확인 시점에 그때그때 생성되는지 문서 어디에도 명시되지 않음. 사전 생성이라면 아직 출처를 모르는 상태에서 source_type NOT NULL을 채울 값이 없고, 입실 시 생성이라면 "확인중(입실 전)" 상태는 실제로는 존재할 수 없는 상태가 됨 | 규칙 03·04 탐지 로직, 결석 판정, S07 초기 렌더링 전부가 이 결정에 좌우됨 | 회차 확정 시 확정 훈련생 전원에 대해 attendance를 배치로 사전 생성하고 `source_type`에 임시값(예: 미확인)을 허용하도록 ENUM을 보강하거나, 반대로 "확인중"을 실제 행이 아닌 프론트엔드 표시상의 가상 상태로 명시 | CRITICAL |
| C2 | 화면↔DB | S19/S20/S21, `submission` | STEP 4.5는 "훈련생(또는 강사 대리입력)이 결과물을 제출"한다고 하고 S19를 "제출 경로"로 지칭하나, S19·S20·S21의 STEP 7-A 명세는 전부 "저장되는 데이터: 없음(조회 전용)" 또는 검토 전용으로만 정의됨 | 27개 화면 어디에도 `submission`을 최초 생성(업로드)하는 CREATE 기능이 없음. STEP 2.1에는 애초에 "훈련생" 역할 자체가 없어 훈련생이 직접 시스템에 접근한다는 전제도 성립하지 않음 | 결과물 제출/검토/미제출 관리(STEP 4.5, S19~21) 전체가 입력 지점 없이 조회만 존재하는 상태 | 새 화면을 만들지 않고, 기존 S19(제출현황) 또는 S21(검토)에 담당자가 훈련생을 대신해 결과물을 등록하는 C(생성) 기능을 추가 — "운영담당자가 접수한 결과물을 대리 등록"하는 흐름으로 STEP 4.5를 보완 | CRITICAL |
| C3 | DB↔상태값 | `verification_case` | `trainee_id`가 단일 FK(nullable) | 규칙 01(동일 환경 복수 출결)·02(짧은 시간 복수 계정)는 정의상 여러 훈련생이 동시에 연루되는데, 사건 하나당 훈련생 1명만 연결 가능. S23의 "연관 정보 섹션"도 "관련 훈련생 기본정보 링크"로 단수 표현 | 두 핵심 탐지 규칙의 결과를 시스템이 온전히 표현·조회할 수 없음(연루자 목록이 evidence JSON 텍스트에만 존재) | related_* 구조를 바꾸지 않는 선에서, evidence JSON 안에 연루 훈련생 ID 목록을 구조화된 배열로 명시하고 S23이 이를 목록 형태로 렌더링하도록 명세를 보강(다대다 브릿지 테이블 신설은 범위 밖이므로 지양) | CRITICAL |
| C4 | 변경기능↔감사로그 | `audit_log` | `user_id`가 FK NOT NULL | 규칙 기반 자동 탐지(P4), 과정 자동 상태 전환(준비중→운영중) 등 "시스템(자동)"이 주체인 다수의 액션에는 사람 행위자가 없음 | 시스템 자동 행위가 감사로그에 남지 않거나, 남기려면 NOT NULL을 위반하게 됨 — S27(감사로그 조회)에서 자동 탐지·자동 전환 이력을 조회할 방법이 없음 | 시스템 액션 전용 고정 계정(예: SYSTEM 서비스 계정)을 `user_account`에 등록하거나 `user_id`를 nullable로 변경 | CRITICAL |
| C5 | 이상징후규칙↔업무프로세스 | 규칙 03(STEP 8.1), `operation_log` | 판단 데이터로 `operation_log.written_at`을 사용, 기본 임계치 60분 | STEP 4.2 프로세스상 운영일지는 "교육 실시 후" 작성되는 것으로 기술되어 있어, 60분보다 긴 대부분의 정규 교육에서 입실 60분 시점에는 아직 운영일지가 없는 것이 정상 상태 | 규칙 03이 사실상 매 회차 상시 발동하는 구조가 되어 "예외적 확인 필요"라는 취지가 무력화됨 | "현장 확인정보"를 운영일지 최종 제출이 아닌 별도의 경량 신호(예: 중간 출결 재확인, 강사 체크인)로 재정의하거나, 임계치를 회차 종료 이후 기준으로 재설계 | CRITICAL |
| H1 | 화면↔권한 | STEP 2.2 권한 매트릭스 | 대시보드~감사로그까지 항목이 나열되어 있으나 "과정"(S15/S16) 행이 없음 | STEP 7-A에는 S15/S16 권한이 별도로 명시되어 있어 매트릭스와 화면 명세를 대조할 기준이 한 곳에 없음 | 신규 개발자가 STEP 2.2만 보고 과정 관리 권한을 놓칠 수 있음 | STEP 2.2에 "과정 목록/상세" 행 추가(값은 이미 STEP 7-A에 있는 R(전체)/OPS_MANAGER(C) 그대로 반영) | HIGH |
| H2 | 프로세스↔화면 | STEP 4.1 vs S02 | STEP 4.1 절차 2가 "훈련생 등록(S04) 또는 대상자 확인(S02)"에서 "명단 업로드 또는 개별 등록"이 가능하다고 기술 | S02(STEP 7-A) 명세는 입력 필드가 반려 사유뿐이고 신규 등록 기능이 없음(조회+상태전이 전용) | 실제 구현 시 개발자가 S02에 없는 등록 기능을 요구받는 것으로 오독할 수 있음 | STEP 4.1 절차 2를 "훈련생 등록(S04)"으로만 수정 | HIGH |
| H3 | 프로세스↔화면 | STEP 4.1 vs S11/S13 | STEP 4.1 절차 4가 "강사 목록(S11)에서 담당 강사 선택 → instructor_assignment 생성"이라 기술 | S11(STEP 7-A)에는 배정 입력 기능이 없고, 실제 instructor_assignment 저장은 S13 명세에만 있음("저장되는 데이터: class_schedule insert/update, instructor_assignment 연동 갱신") | 배정이 어느 화면의 책임인지 문서 내에서 이원화됨 | STEP 4.1 절차 4를 "강사 목록(S11)에서 담당 강사 확인 후 교육일정(S13)에서 배정"으로 수정 | HIGH |
| H4 | 프로세스↔권한 | STEP 4.5 vs STEP 2.2/S21 | STEP 4.5 절차 4가 "운영담당자/강사"가 결과물 검토(S21)를 수행한다고 기술 | STEP 2.2("결과물 검토: INSTRUCTOR —")와 S21 자체 명세("INSTRUCTOR 접근 불가")가 정반대로 규정 | 강사용 화면 개발 여부가 문서 내에서 상충 | STEP 4.5 절차 4의 행위자를 "운영담당자"로만 수정(강사 제외) | HIGH |
| H5 | 이상징후규칙↔화면 | 규칙 01·02(STEP 8.1), S07 | 판단 데이터로 `related_info`(기기ID/위치) 사용 | S07의 입력 필드는 입실/퇴실 확인뿐이며 기기·위치 정보를 캡처하는 필드가 없음 — 내부수기 입력 경로로는 애초에 값이 채워질 수 없음 | 규칙 01·02가 공식/연계자동 출결에만 사실상 적용 가능하다는 제약이 문서화되어 있지 않아, 내부수기 위주로 운영되는 기관에서는 두 규칙이 사실상 작동하지 않음 | STEP 8.1에 "규칙 01·02는 related_info가 존재하는 공식/연계자동 출결 건에만 적용됨"을 명시 | HIGH |
| H6 | 이상징후규칙↔DB | `course_issue.status` vs `verification_case.status` | 특이사항은 등록/확인중/조치완료 3단계, 확인 필요 사항은 7단계 상태를 각각 독립적으로 가짐 | MANUAL 전환 이후 두 상태값이 동기화되는지(예: verification_case가 조치완료되면 course_issue도 자동으로 조치완료가 되는지) 규정이 없음 | 동일 사안에 대해 두 화면(S18, S23)이 서로 다른 상태를 보여줄 수 있음 | STEP 8.3에 "MANUAL 전환 후 course_issue.status는 verification_case.status와 별개로 운영담당자가 독립적으로 관리한다" 또는 "verification_case 종결 시 course_issue.status도 함께 조치완료로 갱신한다" 중 하나를 명시 | HIGH |
| H7 | 권한 우회 | STEP 2 전반 | 권한 통제가 "메뉴 미노출"·"버튼 미노출"·"URL 접근 시 403" 등 화면/라우팅 계층 중심으로만 서술됨 | STEP 2.4의 데이터 스코프(본인 배정 과정/회차)가 서버·API 계층에서 반드시 재검증되어야 한다는 원칙이 명시적으로 선언되어 있지 않음. 강사가 API를 직접 호출해 타 강사 과정의 훈련생 정보를 조회하는 시나리오를 화면 숨김만으로는 막을 수 없음 | 화면단 통제만 구현하고 서버단 검증을 누락하는 구현 리스크 | STEP 2.6에 "모든 STEP 2.4 스코프 규칙과 STEP 2.2 CRUD 권한은 화면 렌더링과 무관하게 서버/API 레이어에서 매 요청마다 재검증한다"는 원칙을 명시적으로 추가 | HIGH |
| M1 | DB↔상태값 | `verification_case.evidence` | 단일 JSON 스냅샷 컬럼 | STEP 4.3·4.4·8.4가 요구하는 "동일 건에 근거만 누적"을 저장할 구조가 없음(덮어쓰기만 가능) | 반복 탐지 시 최초 근거만 남고 이후 근거는 유실되거나 별도 관리 필요 | evidence를 배열(JSON 배열)로 구조화하거나, 근거 추가는 verification_action_log의 note에 누적 기록하도록 STEP 8.4에 명시 | MEDIUM |
| M2 | 화면↔프로세스 | STEP 2.5 vs STEP 7.3/S23 | STEP 2.5는 OPS_MANAGER·EXECUTIVE 모두 "조치완료로 종결" 가능하다고 명시, STEP 7.3은 같은 사안을 "EXECUTIVE 승인 필요 여부는 결정 필요"로 유보 | 두 절이 같은 기능에 대해 서로 다른 확정도를 가짐 | 개발자가 어느 쪽을 구현 기준으로 삼을지 혼동 | STEP 7.3의 해당 문구를 삭제하거나, STEP 2.5를 "MVP는 단독 종결 허용, 2단계 승인은 STEP 12 결정사항 #13 확정 후 확장"으로 통일 | MEDIUM |
| M3 | 과정종료↔미처리데이터 | STEP 4.6, S16 | 종료 체크리스트 4개 항목이 "존재 시 경고(차단 여부는 정책에 따름)"로만 기술 | 이 "정책"이 STEP 12 결정사항 목록 14개 항목 어디에도 없어 누가 언제 정할지 불명 | 종료 로직 구현 시 차단/경고 여부를 개발자가 임의로 정하게 될 위험 | STEP 12 결정사항에 "과정 종료 시 미해결 항목(출결/확인필요/운영일지/결과물)이 있으면 종료를 차단할지, 경고 후 강행을 허용할지"를 15번 항목으로 추가 | MEDIUM |
| M4 | 프로세스↔화면 | STEP 4.1 vs S04 | "교육생 등록"과 "교육생 과정 배정"이 시나리오상 별개 단계이나 시스템에는 S04 하나의 액션으로만 존재 | 이미 시스템에 있는 인물을 신규 과정에만 추가로 배정하는 흐름의 UX가 문서에 명확히 그려지지 않음(S04 예외상황에 "재등록"으로만 언급) | 재직자/재수강생 등록 시나리오에서 혼동 가능 | S04 명세에 "기존 훈련생 검색 후 선택" 경로를 입력 필드 설명에 한 줄 추가(신규 화면 아님, 기존 폼의 동작 명확화) | MEDIUM |
| M5 | 예외처리 누락 | S04 | 예외 상황에 "동일 성명+생년월일 기존 인물 병합" 안내만 있음 | 이미 해당 과정에 등록된 훈련생을 같은 과정에 재차 등록하려는 시도(UNIQUE(trainee_id, course_id) 위반)에 대한 처리가 명시되지 않음 | 저장 시 DB 제약 위반 에러가 사용자에게 그대로 노출될 위험 | S04 예외 상황에 "이미 등록된 과정 재선택 시 기존 등록 건으로 안내"를 추가 | MEDIUM |
| M6 | 상태값↔프로세스 | `attendance_status`(STEP 1.3), S07 | "출석/지각 → 조퇴(조기 퇴실 확인 또는 담당자 수정)" | 조기 퇴실 여부를 시스템이 `class_schedule.end_time` 대비 자동 판정하는지, 담당자가 매번 수동으로 "조퇴"를 선택해야 하는지 불명 | 동일 상황이 운영자마다 다르게 기록될 수 있음 | STEP 1.3에 "퇴실시간 < end_time인 경우 조퇴를 기본값으로 제안하되 최종 확정은 담당자가 선택"으로 명시 | MEDIUM |
| M7 | 정의 모호 | STEP 4.6/S16 종료 체크리스트 | "결과물 제출/검토 완료율" | 제출완료(submit_status)만 보는지 검토완료(review_status)까지 보는지 불명확 | 종료 가능 여부 판단 기준이 사람마다 달라질 수 있음 | STEP 4.6에 "완료율 = review_status가 대기가 아닌 건의 비율(제출+검토 모두 완료 기준)"로 명시 | MEDIUM |
| M8 | 화면 명세 누락 | S23(STEP 7.3) 버튼 목록 | 버튼: 저장, 상태전환(확인중 시작/조치필요 전환/조치완료/확인완료 종결), 취소 | "추가확인(재오픈)"이 STEP 2.5 권한표에는 있으나 STEP 7.3 자체 버튼 목록에는 빠짐 | 사소하지만 화면 명세만 보고 구현하면 재오픈 버튼이 누락될 수 있음 | STEP 7.3 버튼 목록에 "재오픈(추가확인 전환)" 추가 | MEDIUM |
| M9 | 상태값↔프로세스 | STEP 1.2(P1 트리거) | P1 트리거 조건이 "course.status = 준비중/모집중"으로 한정 | 과정이 이미 "운영중"으로 전환된 이후에도 중도 입과가 발생할 수 있는지, 발생한다면 허용/차단 여부가 없음 | 중도입과가 잦은 기관이라면 실제 운영과 문서상 트리거 조건이 어긋남 | STEP 1.2 P1 트리거에 "운영중 상태에서의 추가 등록은 허용하되 별도 승인 없이 즉시 확정 가능"과 같이 명시하거나, 의도적으로 차단한다면 그 사유를 STEP 4.1에 추가 | MEDIUM |
| L1 | 개인정보 최소화 | `attendance.related_info` | JSON, "기기ID, 위치 등"으로만 서술 | 정밀 GPS 좌표를 상시 저장할 경우 목적 대비 과도한 위치정보 수집이 될 수 있음(STEP 12 결정사항 #2와 연동) | 개인정보보호법상 최소수집 원칙 저촉 소지 | 좌표 대신 device_id/네트워크 식별자 위주로 저장하고, 위치가 꼭 필요하면 정밀 좌표 대신 구역 단위(geofence zone id) 또는 반올림된 좌표만 저장하도록 STEP 8.1에 명시 | LOW |
| L2 | 배치 안정성 | `attendance_source_raw`(STEP 5.3 #24) | processed(BOOLEAN) 플래그만 존재 | 배치 처리 실패 시 재시도/실패 이력에 대한 언급이 없음 | 공식 데이터 유실 시 원인 추적이 어려울 수 있음(연동 방식 미확정 상태이므로 현재는 경미) | 연동 방식이 확정되는 시점(STEP 12 #1)에 raw 처리 실패 상태(예: processed ENUM에 '실패' 추가)를 함께 설계 | LOW |

### 추가 검증 A~F 결과

**A. 데이터 삭제** — 확인 결과 STEP 5.5(삭제·이력 정책 요약)에 따라 출결/출결수정이력/확인필요항목/운영일지/감사로그 모두 물리 삭제 UI가 문서 어디에도 없고, 전부 상태값 전환 또는 append-only로 설계되어 있다. **이 부분은 현재 구조 그대로 유지해도 된다.**

**B. 수정 이력** — 출결 수정 시 changed_by/changed_at/before_value/after_value/reason이 `attendance_change_log`에 모두 정의되어 있어 "누가/언제/무엇을/이전값/변경값/사유" 요건을 충족한다. **현재 구조로 충분하다.**

**C. 권한 우회** — H7 참고. 화면 단위 통제(메뉴 숨김, 버튼 숨김, 403)는 STEP 2.6에 기술되어 있으나, 서버/API 레벨에서 STEP 2.4 스코프 규칙을 매 요청 재검증해야 한다는 원칙이 문서에 명시적으로 없다. **서버 레벨 재검증이 반드시 필요한 항목**: S03/S05(훈련생 조회 스코프), S08/S09(출결 조회·수정 스코프), S11/S13(강사·일정 스코프), S17(운영일지 작성 스코프), S18(특이사항 등록 스코프), S19/S20(결과물 조회 스코프) — 이 화면들은 모두 STEP 2.4에 따라 강사의 조회 범위가 "본인 배정"으로 제한되므로, 각 화면이 호출하는 모든 조회·저장 API가 요청자의 `instructor_assignment` 소속 여부를 서버에서 다시 검사해야 한다.

**D. 과정 종료** — M3, M7 참고. 4개 체크리스트 항목 모두 현재는 "경고"로만 기술되어 차단 여부가 정책 미정 상태다.

**E. 개인정보** — L1 참고. `related_info`의 위치정보 최소화가 필요하다. 그 외 `trainee.contact`는 이미 "암호화 저장 권장"으로 명시되어 있어 추가 문제는 발견되지 않았다.

**F. AI 기능** — STEP 8(규칙 01~07)과 STEP 11(AI 확장 위치)을 대조한 결과, 현재 MVP 범위의 7개 규칙은 전부 SQL 집계·시간창 비교로 구현 가능한 규칙 기반 로직이며 AI가 반드시 필요한 항목은 없다. STEP 11이 이미 "AI는 보조 신호로만 추가, 상태 자동변경 금지"라는 원칙과 함께 확장 위치를 규칙 기반과 명확히 분리해 두었으므로 **이 부분은 수정할 필요가 없다.**

## 최종 출력

### 1. 개발 착수 전 반드시 수정해야 할 항목 (CRITICAL + HIGH)
- C1: attendance 레코드 생성 시점(사전생성 vs 입실 시 생성) 확정
- C2: 결과물 제출(submission 생성) 화면/주체를 기존 화면(S19 또는 S21) 안에 명시적으로 보강
- C3: 규칙 01·02의 다중 훈련생 연루를 evidence 구조로 표현하는 방법 확정
- C4: 시스템 자동 행위의 감사로그 처리 방식(서비스 계정 또는 nullable user_id) 확정
- C5: 규칙 03의 "현장 확인정보" 정의를 실제 운영일지 작성 시점과 맞게 재정의
- H1~H7: STEP 2.2 매트릭스에 과정 권한 행 추가, STEP 4.1/4.5의 화면·행위자 서술을 실제 화면 명세와 일치시키기, 규칙 01·02의 적용 범위 명시, 특이사항↔확인필요 상태 동기화 규칙 명시, 서버 레벨 권한 재검증 원칙 명시

### 2. MVP 개발 중 수정 가능한 항목 (MEDIUM)
M1(근거 누적 구조), M2(종결 승인 절 통일), M3(종료 차단 정책을 결정사항에 추가), M4(등록·배정 UX 설명 보강), M5(중복등록 예외처리), M6(조퇴 판정 기준), M7(완료율 정의), M8(재오픈 버튼 명세 보강), M9(중도입과 허용 여부 명시)

### 3. 현재 구조 그대로 개발해도 되는 항목
데이터 삭제 정책(전면 논리삭제·append-only, STEP 5.5), 출결 수정이력의 추적 항목 완전성(STEP 5.3 #10), 변경이력/감사로그의 목적 분리 원칙(STEP 9.1), 확인 필요 사항의 중립적 상태값 체계(STEP 8.4), 역할별 메뉴·버튼 노출 규칙의 내적 일관성(STEP 2.2·2.5·2.6, 단 서버 재검증 원칙은 C 항목 보강 필요)

### 4. 향후 AI 기능으로 확장할 항목
STEP 11에 이미 정리된 5개 항목(패턴 기반 스코어링, 운영일지 작성 보조, 결과물 유사도 검사, 불일치 설명 보조, 로그 검색 보조) 그대로 유효하며 추가로 확장할 항목은 발견되지 않았다. L1(위치정보 최소화)은 AI가 아니라 수집 설계 자체의 문제이므로 별도 처리.

### 현재 설계가 실제 개발에 들어갈 준비가 되었는지

**준비된 부분**: 업무 프로세스 전체 흐름(STEP 1~4), 메뉴·화면 구조와 27개 화면 명세(STEP 3, 6, 7, 7-A), 테이블 24개의 컬럼·제약·삭제정책 대부분(STEP 5), 규칙 기반 탐지의 원칙과 중립적 상태값 체계(STEP 8), 변경이력과 감사로그의 목적 분리(STEP 9), 논리삭제·append-only 원칙(STEP 5.5) — 이 구조들은 서로 참조가 가능할 만큼 견고하게 짜여 있다.

**남은 위험요소**: 이번 감사에서 발견된 CRITICAL 5건은 문서를 다듬는 수준이 아니라 데이터 모델 자체의 결정(레코드 생성 시점, 다대다 관계 표현, 시스템 행위자 처리, 규칙 임계치의 전제)이 필요한 사안이다. 특히 C1(출결)과 C2(결과물)는 같은 패턴("완료 전 placeholder 행이 언제 생기는가")이 두 군데서 반복되고 있어, 이 패턴에 대한 일관된 원칙을 한 번에 정하지 않으면 다른 테이블에서도 같은 문제가 재발할 수 있다.

**개발 전에 결정해야 할 사항**: 기존 STEP 12의 14개 항목은 여전히 유효하며, 이번 감사로 다음이 추가로 필요하다 — (1) 출결·결과물 등 "완료 전 상태"를 가지는 테이블의 레코드 생성 시점 원칙, (2) 다수 훈련생이 연루되는 탐지 이벤트의 표현 방식, (3) 시스템 자동 행위를 감사로그에 남기는 방식, (4) 규칙 03이 실제로 무엇을 "현장 확인"으로 볼 것인지의 재정의, (5) 과정 종료 시 미해결 항목에 대한 차단/경고 정책(기존 STEP 12 목록에 15번으로 추가 필요).

---

# 부록 F. CRITICAL 5건 해결 및 연쇄 영향 분석

> 이 부록은 부록 B~D(수정 전 감사)의 CRITICAL 5건(C1~C5)을 실제로 해결한 결과다. STEP 1·4·5·7·7-A·8·9·10·12 본문은 이미 이 결정에 맞춰 수정을 반영했으며, 여기서는 "무엇을 왜 어떻게 바꿨는지"를 변경이력 표로 정리하고 연쇄 영향과 새로 드러난 문제를 추가로 검증한다.

## F-1. 변경사항 목록

| ID | 수정 대상 | 기존 정의 | 변경 정의 | 변경 이유 | 영향 화면 | 영향 DB | 영향 API |
|---|---|---|---|---|---|---|---|
| C1-1 | `attendance.attendance_status` | 확인중/출석/지각/조퇴/결석/인정결석, DEFAULT=확인중 | 출석/지각/조퇴/결석/인정결석(확인중 제거, DEFAULT 없음) | 레코드가 생성되는 시점에 이미 상태가 확정되므로 임시 상태가 불필요 | S07, S08 | `attendance` | 출결 조회가 LEFT JOIN 계산 로직 필요 |
| C1-2 | `attendance` 생성 시점 원칙 | 불명확(사전생성/이벤트생성 미정) | 실제 이벤트(입실/퇴실/결석확정) 발생 시에만 INSERT, 미출결은 `trainee_enrollment`+`class_schedule` 기준 비저장 계산값 | `source_type` NOT NULL 충돌 해소, "확인중(입실 전)" 상태 모순 제거 | S01, S07, S08, S16 | `attendance` | GET 일일출결(LEFT JOIN), POST 입실확인/결석확정 |
| C1-3 | S07 화면 액션 | 입실확인/퇴실확인만 존재 | "결석 확정"(개별/일괄) 액션 신설 | 미출결→결석 전이를 사람이 명시적으로 확정하도록 함 | S07 | `attendance` insert | POST 결석확정 |
| C1-4 | `attendance_change_log` 적용범위 | 모든 수정 대상으로 암묵적 서술 | 최초 생성(입실확인/결석확정/퇴실확인)은 대상 아님, 이후 재수정(S09)만 대상 | 생성과 수정의 의미를 구분 | S07, S09, S10 | `attendance_change_log` | POST 출결수정(S09)만 change_log 기록 |
| C1-5 | 규칙 04 조건 | check_out_time NULL이면 매칭(상태 조건 없음) | `attendance_status IN (출석, 지각)`인 행만 대상으로 제한 | **C1 재설계 중 신규 발견**: 결석 확정 행도 check_out_time이 항상 NULL이라 그대로 두면 정상 결석까지 "퇴실 누락"으로 오탐 | S22, S23 | `detection_rule`(RULE_04 params) | 탐지엔진 배치 쿼리 조건 추가 |
| C2-1 | STEP 4.5 절차 행위자 | "훈련생(또는 강사 대리입력)"이 제출 | "운영담당자가 등록"(안 B, **[결정 필요]**) | 훈련생 역할이 STEP 2에 없는 것과의 충돌 해소 | S19 | 없음(스키마 불변) | POST submission 생성 주체 변경 |
| C2-2 | S19 화면 기능 | 조회 전용 | "결과물 등록"/"재등록" 버튼 추가 | 27개 화면 중 어디에도 없던 CREATE 경로 보강 | S19 | `submission`, `attachment` | POST submission, PUT submission(재등록) |
| C2-3 | `submission.submitted_at` / `created_at` 의미 | submitted_at만 정의, 의미 모호 | submitted_at=원본 제출 시점(담당자 수기입력), created_at(공통 감사컬럼)=시스템 등록 시점 | 두 시점을 구분해야 한다는 요구를 스키마 변경 없이 충족 | S19 | `submission`(재해석만, 컬럼 추가 없음) | 없음(필드 매핑만) |
| C3-1 | `verification_case` | `trainee_id`(단일 FK), `related_attendance_id` 보유 | 두 컬럼 제거 | 규칙 01·02의 다중 훈련생 연루를 단일 FK로 표현 불가 | S01, S22, S23 | `verification_case` | 사건 조회 API가 훈련생 목록을 조인 조회 |
| C3-2 | `verification_case_trainee`(신규) | 없음 | (case_id, trainee_id) PK + attendance_id(nullable) | N:M 관계를 최소 구조로 표현(관계형 컬럼 relation_type 등은 불필요 판단) | S22, S23, S05 | 신규 테이블 | POST 확인필요 생성 시 N건 insert, GET 사건상세 시 조인 |
| C3-3 | 규칙 01·02 케이스 생성 로직 | 단일 verification_case + 단일 trainee_id | 매칭된 훈련생 전원에 대해 `verification_case_trainee` 각각 생성, 추가 연루자는 근거만 누적 | 실제 다중 연루 데이터를 손실 없이 반영 | S22, S23 | `verification_case_trainee` | 탐지엔진(배치/실시간) 로직 |
| C4-1 | `audit_log.user_id` | NOT NULL FK | `actor_type`(USER/SYSTEM_RULE/SYSTEM_BATCH/SYSTEM_API, NOT NULL) + `actor_user_id`(nullable FK) | 시스템 자동 행위(배치, 탐지엔진)에는 사람 행위자가 없어 NOT NULL을 만족할 수 없었음 | S27 | `audit_log` | 감사로그 기록 미들웨어, GET 감사로그 필터에 actor_type 추가 |
| C4-2 | 감사로그 기록 미들웨어 규칙 | 없음 | 요청 컨텍스트별 actor_type 자동 태깅(로그인 세션=USER, 배치 잡=SYSTEM_BATCH, 탐지엔진=SYSTEM_RULE) | 구현 일관성 확보, 누락 방지 | 전체 화면(간접) | `audit_log` | 공통 미들웨어 계층 |
| C5-1 | 규칙 03 정의 | "입실 후 60분 내 `operation_log.written_at` 미확인" | "회차 종료(`class_schedule.end_time`) 후 Z시간 내 `operation_log` 부재"로 축소 재정의, 명칭도 "회차 운영기록 지연"으로 변경 | 운영일지가 교육 종료 후 작성되는 실제 흐름과 원래 조건이 정면 충돌(정상 수업 상시 오탐) | S22, S23 | `detection_rule`(RULE_03 description/params) | 탐지엔진 배치 쿼리 변경 |
| C5-2 | 규칙 03 훈련생 연결 | 암묵적으로 훈련생 관련 이슈로 취급 | `verification_case_trainee` 0행(회차/운영 단위 이슈로 명시) | 특정 훈련생의 부정을 시사하지 않는 운영 이슈이므로 | S22, S23 | `verification_case_trainee` | 탐지엔진 |

## F-2. C2 비교표 (안 A vs 안 B)

| 관점 | 안 A: 훈련생 직접 제출 | 안 B: 운영담당자 등록(잠정 채택) |
|---|---|---|
| 데이터 | `user_account.linked_trainee_id`(신규, `linked_instructor_id`와 동형) 추가, `submission` 스키마는 그대로 사용 가능 | `submission` 스키마 변경 없음. `submitted_at`(원본 제출시점)·`created_at`(등록시점)만 재해석 |
| 권한(STEP 2) | TRAINEE 역할 신규 추가 필요 — 역할 정의(2.1), 권한 매트릭스(2.2), 데이터 스코프(2.4, "본인 데이터만") 전부 확장 | 역할 체계 변경 없음(기존 4역할 유지) |
| 화면 | 훈련생 전용 로그인·제출 화면(신규 S-코드) 최소 1개 필요, 파일 업로드 보안 검토(악성파일, 용량제한) 추가 | S19에 등록 버튼 1개 추가로 해결(신규 화면 없음) |
| 운영 | 훈련생 계정 발급·비밀번호 관리·개인정보 처리방침 고지 등 계정 운영 부담 발생 | 기존 운영담당자 업무 흐름(운영일지, 출결과 동일한 "직원이 기록") 안에 자연스럽게 편입 |
| 감사·이력 | 제출 자체가 훈련생의 행위이므로 `audit_log.actor_type=USER, actor_user_id=훈련생 계정` | 제출은 "훈련생이 전달, 담당자가 등록"으로 이원화 — actor는 항상 담당자, submission.trainee_id로 원 소유자 구분 |
| 구현 복잡도 | 높음(신규 역할·인증·화면·보안 전 계층) | 낮음(기존 구조 재해석 + 버튼 1개) |

**결정 결과(2026-09-21)**: 안 B(운영담당자 등록)로 확정했다(STEP 12 #15, D-01). 훈련생 직접 제출 요건이 생기면 안 A로 재검토한다.

## F-3. 연쇄 영향 추적 (STEP 2 → 3 → 4 → 5 → 7 → 7-A → 8 → 9 → 10 → 11)

| STEP | C1~C5로 인한 영향 | 처리 |
|---|---|---|
| STEP 2(역할·권한) | 권한 매트릭스의 값 자체는 변경 없음(어떤 화면을 누가 CRUD하는지는 그대로). C2 안 B 채택 시에도 "결과물 검토/제출현황" 권한 행은 기존 값 유지 | 반영할 변경 없음(기존 H1 등 별개 이슈는 이번 범위 밖) |
| STEP 3(메뉴구조) | 신규 메뉴·화면 추가 없음(S19 버튼 추가는 메뉴 구조에 영향 없음) | 변경 없음 |
| STEP 4(프로세스) | 4.2(당일 운영), 4.3(확인필요 처리 표의 관련 테이블), 4.5(결과물), 4.6(종료 체크리스트)에 직접 영향 | 모두 수정 완료 |
| STEP 5(DB) | attendance, verification_case 컬럼 변경, verification_case_trainee 신규, audit_log 컬럼 변경, 테이블 수 24→25 | 모두 수정 완료 |
| STEP 7(핵심화면) | S01·S22·S23의 "훈련생" 단수 표현을 다건 표현으로 수정 | 모두 수정 완료 |
| STEP 7-A(전체화면) | S05, S07, S08, S09, S18, S19, S20, S21에 직접 영향 | 모두 수정 완료 |
| STEP 8(탐지규칙) | 규칙 01·02·03·04 조건문, 신규 8.1-A/8.1-B 하위절 | 모두 수정 완료 |
| STEP 9(이력·감사) | `*_change_log` 적용범위(생성 제외) 명시, `audit_log` actor 구조 반영 | 모두 수정 완료 |
| STEP 10(MVP우선순위) | Phase 1(감사로그 actor 태깅), Phase 2(미출결 계산 로직), Phase 3(브릿지 테이블, 규칙03 축소), Phase 4(C2 결정 대기 표시) | 모두 수정 완료 |
| STEP 11(AI확장) | 직접 영향 없음 — 규칙 03 축소나 다중훈련생 표현 방식은 모두 규칙 기반 구조 내의 조정이며, AI 확장 위치(패턴 스코어링, 불일치 설명 보조 등)의 전제를 바꾸지 않는다 | 변경 없음(확인만 수행) |

## F-4. 최종 출력

### A. CRITICAL 5건 해결 결과

| 항목 | 해결 여부 | 최종 설계 | 변경된 테이블 | 변경된 화면 | 변경된 프로세스 | 남은 결정사항 |
|---|---|---|---|---|---|---|
| C1 | 해결 | 이벤트 발생시에만 attendance 생성, 미출결은 계산값 | `attendance` | S01, S07, S08, S16 | STEP 4.2 | 결석 확정을 "언제까지 반드시 수행해야 하는지"의 운영 SLA(F-5 N1 참고) |
| C2 | 해결·**확정(D-01)** | 안 B(운영담당자 등록), 스키마 변경 없음 | 없음 | S19 | STEP 4.5 | 없음(정책 변경 시 재검토) |
| C3 | 해결 | `verification_case_trainee` 브릿지 테이블로 N:M 표현 | `verification_case`, `verification_case_trainee`(신규) | S01, S05, S22, S23 | STEP 4.3, STEP 8.1-B | 없음(구조 확정) |
| C4 | 해결 | `actor_type`+`actor_user_id`(nullable)로 분리 | `audit_log` | S27(조회 범위 확대) | STEP 9 | 없음(구조 확정), 단 알림 관련 actor 기록은 결정사항 #14 확정 후 적용 |
| C5 | 해결 | 훈련생 개별 현장확인 대신 "회차 운영기록 지연"으로 축소 재정의, 신규 테이블 미도입 | 없음(기존 컬럼 재사용) | S22, S23 | STEP 8.1, 8.1-A | **[결정 필요] 훈련생 개별 중간 현장확인 이벤트 도입 여부**(STEP 12 #16) |

### B. 연쇄 변경 목록

STEP 1.2(P3·P5 트리거), STEP 1.3(attendance 상태표), STEP 4.2, STEP 4.3(관련 테이블 열), STEP 4.5, STEP 4.6(체크리스트 항목), STEP 5.1(구조 수정 목록), STEP 5.2(테이블 목록), STEP 5.3(#9 attendance, #15 verification_case, #19 audit_log, #25 신규), STEP 5.4(관계 요약), STEP 7(S01·S22·S23), STEP 7-A(S05·S07·S08·S09·S18·S19·S20·S21), STEP 8.1(규칙 01·02·03·04, 신규 8.1-A·8.1-B), STEP 8.2(대사 흐름 각주), STEP 8.3(MANUAL 경로), STEP 9.1·9.2, STEP 10(Phase 1~4), STEP 12(결정사항 15~17번 추가) — 위 목록 전체가 이번 변경으로 함께 수정되었다.

### C. 새롭게 발견된 문제

| 우선순위 | 내용 |
|---|---|
| HIGH (즉시 반영 완료) | 규칙 04가 결석 확정 건까지 "퇴실 누락"으로 오탐하는 문제(C1-5) — 발견 즉시 `attendance_status IN (출석, 지각)` 조건을 추가해 해결함 |
| MEDIUM | **N1**: "결석 확정"을 담당자가 언제까지 수행해야 하는지 운영 주기(SLA)가 정의되어 있지 않다 — 정의하지 않으면 "미출결"이 여러 날 무기한 쌓일 수 있다. STEP 4.2에 "당일 마감(예: 익일 정오까지) 결석 확정 원칙"을 명시할 필요 |
| MEDIUM | **N2**: `verification_case_trainee`의 PK가 (case_id, trainee_id) 복합키라서, 동일 훈련생이 동일 사건 내에서 서로 다른 출결 건(attendance_id)으로 두 번 이상 연루되는 경우 attendance_id를 1개만 저장할 수 있다 — evidence(JSON)에 전체 근거를 남기고 attendance_id는 대표값(최초 매칭)만 저장하는 것으로 완화 필요 |
| LOW | **N3**: 대시보드(S01)·확인필요목록(S22)에서 사건마다 관련 훈련생 수만큼 `verification_case_trainee`를 조인해야 하므로, 목록 조회 성능을 위해 사건별 훈련생 수 등 집계값의 캐시(비정규화) 필요 여부는 실제 데이터량을 보고 추후 결정 |
| LOW | **N4**: 안 B 모델에서 "훈련생이 실제로 누구에게(강사 현장수령/이메일 등) 결과물을 전달했는지" 전달 경로 자체는 기록하지 않는다 — 현재 요구사항 범위에는 없으므로 추가하지 않되, 필요해지면 `submission`에 `delivery_channel` 같은 선택 필드를 추가 검토 |

### D. 개발 착수 전 결정사항 (개발자가 임의로 판단하면 안 되는 것)

1. **[최우선] 결과물 제출 주체(C2, STEP 12 #15)** — 안 A(훈련생 직접 제출) vs 안 B(담당자 등록). 이 하나의 결정이 STEP 2(역할)·STEP 5(계정 스키마)·STEP 6/7-A(신규 화면 필요 여부)의 범위를 좌우하므로 반드시 개발 착수 전에 확정한다.
2. 훈련생 개별 중간 현장확인 이벤트 도입 여부(C5, STEP 12 #16) — 미도입 시 규칙 03은 현재의 "운영기록 지연" 범위로 확정 운영.
3. 과정 종료 시 미해결 항목 차단/경고 정책(STEP 12 #17).
4. "결석 확정"의 운영 주기·책임자(N1) — 일일 마감 룰을 정책으로 명시해야 미출결 누적을 방지할 수 있다.
5. 기존 STEP 12의 1~14번 항목(공식 출결 연동 방식, 출결 확인 환경 등)은 C1~C5 해결과 무관하게 여전히 유효하다.

### E. 개발 가능 여부

**1. 바로 개발 가능한 영역**: 출결 조회·생성 로직 전체(C1 원칙 확정 — LEFT JOIN 기반 미출결 계산, 이벤트 기반 생성, S07/S08/S09), `audit_log`의 actor_type 구조(C4 확정) 및 감사로그 미들웨어, `verification_case_trainee` 스키마와 규칙 01·02의 다중 훈련생 케이스 생성 로직(C3 확정), 규칙 03의 재정의된 조건(C5 확정, 신규 테이블 없이 기존 데이터로 구현), 규칙 04의 보강 조건(C1-5).

**2. 설계 확정 후 개발해야 하는 영역**: 결과물 제출/등록 화면과 그 상위 프로세스 전체(C2 — 안 A/B 확정 전까지 S19의 최종 UI 형태와 STEP 2 역할 체계 확장 여부를 착수할 수 없음), 훈련생 개별 중간 현장확인 관련 향후 규칙(도입 결정 전까지는 설계 자체가 없음).

**3. 실제 운영정책 확인이 필요한 영역**: 결석 확정 운영 SLA(N1, 몇 시간/며칠 내 마감할지는 기관 운영 방식에 따름), 과정 종료 시 미해결 항목 차단/경고 정책(#17), 탐지규칙 파라미터 실측값(N/M/T/X/Y/Z — 기관의 실제 출결 패턴을 보고 조정 필요, STEP 8.4 기존 원칙과 동일).
