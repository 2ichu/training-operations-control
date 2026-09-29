# 개발 기준선 (Baseline) — 훈련과정 통합관리 및 내부통제 시스템

> **문서 위상**: 이 문서는 새로운 원본이 아니다. Single Source of Truth는 여전히 `system-design.md`(텍스트 원본)와 훈련과정 ERD(**v5**, 시각화)이며, 이 문서는 그 둘을 개발자가 그대로 옮길 수 있도록 **표준 형태(상태값 사전, 권한 매트릭스, API 요구사항, 규칙 표, 감사·삭제·종료·보안 정책)로 정리한 파생 기준선**이다.
> 이 기준선 작성 중 발견한 충돌은 모두 `system-design.md`와 ERD에 먼저 반영했다(11절 참고). 따라서 세 문서 사이에 남은 차이는 없어야 하며, 있다면 `system-design.md`가 우선한다.
> 표기: `[결정 필요]` = 운영정책 확인 전에는 개발자가 임의로 정할 수 없는 항목(12절). 이번 단계에서 새 기능·화면은 추가하지 않았다.

---

## 1. 기준 문서 간 차이점

"ERD v3"는 지난 단계에서 확정한 버전이다. 이후 `system-design.md`를 개발 기준선 검증으로 보정하면서 차이가 생겼고, 아래 표는 그 차이와 처리 결과다. 차이는 한쪽을 임의로 고르지 않고 **텍스트 원본(system-design.md)에 맞춰 ERD를 v5로 갱신**하는 것으로 정리했다(ERD는 원본을 시각화하는 문서이므로).

| # | 항목 | system-design.md | ERD v3 | 처리 |
|---|---|---|---|---|
| 1 | `attendance_source_raw` | STEP 5.2·5.3 #24에 옵션 스테이징 테이블로 정의 | 어떤 도메인 다이어그램에도 없음 | ERD v5 ② 도메인에 관계선 없는 옵션 엔티티로 추가(논리적 관계, 연동 방식 #1 확정 전) |
| 2 | `audit_log.action` | 개발 기준선에서 LOGIN/LOGOUT/LOGIN_FAILED/ACCESS_DENIED 추가, DELETE는 예약값 | CREATE/UPDATE/DELETE/VIEW_SENSITIVE 4값 | ERD v5 반영. `target_id`도 NULL 허용(LOGIN_FAILED·ACCESS_DENIED만) |
| 3 | `attachment.entity_version` | 재등록 시 버전별 파일 보존을 위해 신규(nullable) | 없음 | ERD v5 반영 |
| 4 | `class_schedule.status` | 저장값 예정/휴강, "진행완료"는 계산값 | 예정/진행완료/휴강 | ERD v5 반영 |
| 5 | `submission.submit_status` | 저장값 제출됨/기한후제출, "미제출"은 계산값 | 미제출/제출됨/기한후제출 | ERD v5 반영 |
| 6 | `submission.submitted_at` | NOT NULL(담당자가 실제 제출 시점 입력) | 제약 미표기 | ERD v5 주석 반영 |
| 7 | `attendance_change_log` | `actor_type`(USER/SYSTEM_BATCH/SYSTEM_API) 추가, `changed_by` nullable | changed_by만 존재 | ERD v5 반영(공식 대사 갱신 이력 기록용) |
| 8 | 도메인 설명문 | — | "24개 테이블", verification_case가 출결·운영일지·특이사항 FK를 선택 보유한다는 구 설명 | ERD v5에서 25개(옵션 포함)·브릿지 테이블 구조 설명으로 교체 |
| 9 | UNIQUE·INDEX·NOT NULL 세부 | 원본(STEP 5.3) | 키 컬럼 위주로만 표시(의도적 생략), 타 도메인 참조는 PK만 표시한 stub | 차이 아님 — 컬럼·제약의 원본은 항상 system-design.md. 2절에 전체 제약 표를 별도로 정리 |
| 10 | 부록 B~D의 구 필드명 | `attendance_status=확인중`, `verification_case.trainee_id`, `audit_log.user_id` 등 | — | 부록 앞 "갱신 안내"에 수정 전 감사 스냅샷임을 명시. 현재 정의가 항상 최신 |

---

## 2. DB 최종 정합성 검사

범례: 생성/수정일시 — ●●=공통 감사컬럼(`created_at`,`created_by`,`updated_at`,`updated_by`) 보유, ●=생성 정보만 보유(append-only 로그성). 감사 대상 — 해당 테이블의 CUD가 `audit_log`에 자동 기록되는지 여부(로그 테이블 자체의 INSERT는 원본 이벤트의 audit_log가 대신하므로 "—").
엔진(MySQL/PostgreSQL 등) 미선택 상태이므로 부분 유니크·JSON 표현식 인덱스는 "요구사항"으로만 명시하고 구현 방식은 엔진 선택 후 결정한다.

| 테이블 | PK | FK → 대상 | NULL 허용 컬럼 | UNIQUE | 권장 INDEX | 상태값 컬럼 | 생성/수정 | 삭제·비활성 | 감사 대상 |
|---|---|---|---|---|---|---|---|---|---|
| `course` | course_id | manager_user_id → user_account | 없음 | — | (status), (start_date, end_date) | status(5) | ●● | 삭제 금지, SUSPENDED로 표현 | O |
| `trainee` | trainee_id | — | birth_date, contact | — (동일인 판정은 앱: 성명+생년월일) | (name, birth_date) | — | ●● | 삭제 금지 | O (개인정보 마스킹 기록) |
| `trainee_enrollment` | enrollment_id | trainee_id → trainee, course_id → course, confirmed_by → user_account | confirmed_at, confirmed_by, cancel_reason | **부분 UNIQUE (trainee_id, course_id) WHERE status <> 'CANCELLED'** (P1-01: 취소 건은 이력 보존, 재신청은 신규 행) | (course_id, status) | status(7) | ●● | CANCELLED(논리) | O |
| `trainee_change_log` | log_id | changed_by → user_account (entity_id는 다형성, FK 없음) | 없음 | — | (entity_type, entity_id, changed_at) | — | ● | 불변 | — |
| `instructor` | instructor_id | — | contact | — | (status) | status(2) | ●● | INACTIVE | O |
| `instructor_assignment` | assignment_id | instructor_id → instructor, course_id → course | round_no(NULL=과정 전체) | **부분 UNIQUE (instructor_id, course_id, round_no) WHERE status='ASSIGNED'** (P1-02: 취소 배정은 이력 보존, 재배정은 신규 행) + 과정 전체 담당(유효 배정)은 course당 1건 | (course_id, status) | status(2) | ●● | CANCELLED | O |
| `instructor_change_log` | log_id | changed_by → user_account | 없음 | — | (entity_type, entity_id, changed_at) | — | ● | 불변 | — |
| `class_schedule` | schedule_id | course_id → course, instructor_id → instructor | content | (course_id, round_no) | (class_date), (instructor_id, class_date) | status(2) | ●● | CANCELLED(휴강) | O |
| `attendance` | attendance_id | trainee_id → trainee, schedule_id → class_schedule | check_in_time, check_out_time, related_info, last_modified_at | (trainee_id, schedule_id) | (schedule_id), (check_in_time), related_info 내 device_id 조회용 생성컬럼/표현식 인덱스 | attendance_status(5), source_type(3) | ●● | 삭제 금지, 정정은 S09만 | O (생성·수정 전부) |
| `attendance_change_log` | log_id | attendance_id → attendance, trainee_id → trainee, changed_by → user_account | changed_by(시스템 갱신 시) | — | (trainee_id, changed_at), (attendance_id, changed_at) | actor_type(3) | ● | 불변 | — |
| `operation_log` | operation_log_id | schedule_id → class_schedule, instructor_id → instructor, author_id → user_account | issue_note | **(schedule_id)** | — | — (작성 여부는 계산) | ●● | 삭제 금지, 수정 시 audit before/after | O |
| `course_issue` | issue_id | course_id → course, schedule_id → class_schedule, reported_by → user_account | schedule_id | — | (course_id, status) | status(3) | ●● | 삭제 금지 | O |
| `submission` | submission_id | trainee_id → trainee, course_id → course | 없음 (submitted_at NOT NULL) | **(trainee_id, course_id, title)** | (course_id, review_status) | submit_status(2), review_status(4) | ●● | 삭제 금지, 교체는 version 증가 | O |
| `submission_review_log` | log_id | submission_id → submission, reviewer_id → user_account | review_comment | — | (submission_id, version) | review_result(3) | ● | 불변 | — |
| `verification_case` | case_id | course_id → course, related_operation_log_id → operation_log, related_course_issue_id → course_issue, detection_rule_id → detection_rule, assignee_id → user_account | related_operation_log_id, related_course_issue_id, assignee_id, confirmation_note, action_note, closed_at | 활성 건 중복은 evidence.dedupe_key 기준 앱 검증 | (status, detected_at), (course_id, status), (assignee_id, status), (detection_rule_id, status) | status(7) | ●● | 삭제 금지, 종결 상태로 표현 | O (actor 다양) |
| `verification_case_trainee` | (case_id, trainee_id) | case_id → verification_case, trainee_id → trainee, attendance_id → attendance | attendance_id | PK가 곧 유니크 | (trainee_id) | — | ● | 삭제 금지, 추가만 | O |
| `verification_action_log` | log_id | case_id → verification_case, actor_id → user_account | previous_status, note | — | (case_id, action_at) | action_type(5) | ● | 불변 | — |
| `detection_rule` | rule_id | — | description | (rule_code) | — | is_active | ●● | 삭제 금지, is_active=false | O |
| `attachment` | attachment_id | uploaded_by → user_account (entity_id는 다형성) | entity_version | — | (entity_type, entity_id, entity_version) | — | ● | 삭제 금지 | O (업로드·다운로드) |
| `audit_log` | log_id | actor_user_id → user_account | actor_user_id, before_value, after_value, reason, ip_address, target_id(조건부) | — | (action_at), (actor_user_id, action_at), (target_table, target_id) | actor_type(4), action(8) | ● | 삭제·수정 금지 | 자체 조회만 VIEW_SENSITIVE |
| `user_account` | user_id | linked_instructor_id → instructor | email, linked_instructor_id | (login_id), (linked_instructor_id) — NULL 제외, 강사 1인 1계정 | — | status(2) | ●● | INACTIVE | O (password_hash 값은 기록 금지) |
| `role` | role_id | — | 없음 | (role_code) | — | — | ●● | 삭제 금지 | O |
| `user_role` | (user_id, role_id) | user_id → user_account, role_id → role | 없음 | PK | — | — | ● | 설정 데이터 교체 허용 | O |
| `role_permission` | (role_id, screen_id, action) | role_id → role | 없음 | PK | — | scope_type(2) | ●● | 설정 데이터 교체 허용 | O (before/after) |
| `attendance_source_raw`(옵션) | raw_id | — | processed_at | — | (processed, received_at) | processed | ●(received_at, processed_at) | 삭제 금지(원본 보존) | O (actor SYSTEM_API) |

### 2-1. attendance 집중 검증

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| 실제 출결 이벤트 발생 시 생성 | 확정 | 입실 확인(출석/지각), 결석 확정(결석), 공식 데이터 반영(STEP 8.2)만이 INSERT 경로. 회차 생성·훈련생 확정은 INSERT를 유발하지 않는다 |
| 미출결은 저장하지 않는 계산값 | 확정 | `trainee_enrollment`(CONFIRMED) LEFT JOIN `attendance`(해당 회차)에서 매칭 행이 없으면 화면·API가 "미출결"(NOT_CHECKED)을 계산. 휴강(CANCELLED) 회차는 계산 대상에서 제외 |
| 결석 확정 시 attendance 생성 | 확정 | 결석 확정 = attendance INSERT(ABSENT, check_in_time NULL, source_type=내부수기). 최초 생성이므로 change_log 대상 아님, audit_log CREATE는 기록 |
| 출결 수정은 원본을 덮어쓰지 않고 이력 보존 | 확정 | 이미 값이 있는 필드의 변경은 S09(`correct`)만 가능하며 같은 트랜잭션에서 before/after 스냅샷을 `attendance_change_log`에 INSERT. "원본을 덮어쓰지 않는다"는 의미는 attendance 행이 최신값을 갖되 이전 값이 이력에 영구 보존된다는 뜻 — 이 이력은 UPDATE·DELETE가 불가능(append-only) |
| 최초 기록과 정정의 구분 | 확정 | check_out_time이 NULL일 때의 퇴실 확인은 "최초 기록"(change_log 없음). 이미 값이 있으면 `correct`로만 변경 가능(API가 409 반환) |
| 오입력 정정 | 확정 | attendance 행은 삭제되지 않는다. 잘못 만든 입실 기록은 S09에서 ABSENT 등으로 정정(사유 필수)하며 "미출결로 되돌리기"는 지원하지 않는다 |

### 2-2. verification_case 집중 검증

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| 특정 훈련생 1명에 종속되지 않음 | 확정 | `trainee_id`·`related_attendance_id` 컬럼 없음 |
| 관련 훈련생은 verification_case_trainee로 연결 | 확정 | 0명(회차·운영 단위: RULE_03, 훈련생 무관 MANUAL), 1명(RULE_04·05·06·07, 훈련생 관련 MANUAL), N명(RULE_01·02) |
| 관련 출결 데이터 연결 | 확정 | `verification_case_trainee.attendance_id`(훈련생별 대표 출결 1건). 같은 훈련생의 추가 출결 근거는 `evidence.items`에 append |
| 근거 검증 | 확정(수정) | `evidence.items` ≥ 1건이면 유효. 연결 대상이 하나도 없는 RULE_03이 기존 검증 규칙("연결 대상 1개 이상")을 통과하지 못하던 결함을 수정 |
| 훈련생 추가 연루 | 확정 | 활성 건에 훈련생이 추가로 연루되면 `verification_case_trainee` 행만 추가(삭제·수정 없음) |

### 2-3. audit_log 행위자 유형 정의

| actor_type | actor_user_id | 의미 | 생성 조건 (예) |
|---|---|---|---|
| USER | 필수(존재하지 않는 계정의 LOGIN_FAILED만 NULL) | 로그인한 사람이 화면·API로 수행한 행위 | 출결 수정, 확인 완료·조치 완료, 과정 종료, 사용자·권한 변경, 로그인·로그아웃, 접근 거부, 파일 다운로드 |
| SYSTEM_RULE | NULL | 탐지 엔진(RULE_01~07)이 규칙 평가 결과로 수행한 행위 | verification_case 생성, evidence.items 추가, verification_case_trainee 추가. reason에 규칙 코드 기록 |
| SYSTEM_BATCH | NULL | 스케줄러가 시간 기반으로 수행한 행위 | 과정 자동 상태 전환(준비중/모집중→운영중), 공식 대사 배치의 attendance 생성·갱신. reason에 배치 식별자 기록 |
| SYSTEM_API | NULL | 외부 시스템이 호출한 인터페이스가 수행한 행위 | 공식 출결 데이터 수신(`attendance_source_raw` INSERT). 공식 출결을 실시간 푸시로 받을지 배치 수집으로 받을지는 STEP 12 #1 확정 후 이 유형과 SYSTEM_BATCH 중 하나로 확정 |

행위자 유형 규칙: (1) 한 이벤트는 정확히 한 유형이다. (2) 사람이 트리거한 액션이 내부적으로 시스템 처리를 유발해도(예: 출결 저장 후 규칙 01 평가) 각각 별도 이벤트로 기록하며 유형은 실제 수행 주체를 따른다. (3) `verification_action_log`는 사람의 확인·조치 이력 전용이므로 actor_id NOT NULL을 유지한다.

### 2-4. 결과물(result = submission) 반영

- 결과물 제출 주체는 운영담당자 등록으로 **확정**(2026-09-21, D-01, STEP 12 #15)되어 **스키마에는 TRAINEE 계정·훈련생 로그인 관련 컬럼이 없다.** `user_account`는 STEP 2의 4개 역할만 대상으로 하며, 개발 단계에서 임의로 TRAINEE 역할·계정을 만들지 않는다.
- 잠정 안 B(운영담당자 등록): `submission.trainee_id`=결과물의 주인, `submitted_at`=훈련생이 실제 제출한 시점(수기 입력), `created_at`=시스템 등록 시점, `created_by`=등록한 담당자. 안 A로 바뀌어도 `submission` 스키마는 그대로 쓸 수 있고 추가되는 것은 계정·역할·화면뿐이다.
- 제출기한 저장 위치는 스키마에 없다(`[결정 필요]` #24). 기한후제출 자동 판정과 S20 경과일수는 이 결정 전까지 개발 보류.

---

## 3. 상태값 Dictionary

### 3-0. 표기 원칙

- DB에는 **영문 대문자 코드**를 저장하고, API는 코드를 주고받으며, 화면은 **한글 표시명**을 사전에서 조회해 보여준다(`system-design.md`의 한글 값은 표시명과 동일). 코드 체계는 개발 표준 제안이며, 표시명과 의미는 system-design.md가 원본이다.
- **계산값**(DB에 저장하지 않는 표시 상태)은 표에서 "계산"으로 표시한다. 계산값은 enum에 넣지 않는다.
- 서로 다른 도메인이 같은 표시명을 쓰는 경우(확인중, 조치완료 등)는 코드가 달라도 무방하다(컬럼이 다르므로 충돌하지 않음). 화면에서는 항상 도메인 맥락(과정 진행 vs 확인 건)을 함께 표시한다.
- 통합안: (a) 죽은 값 제거 — `attendance_status`의 확인중, `class_schedule.status`의 진행완료, `submit_status`의 미제출을 저장 enum에서 제거하고 계산값으로 대체(C1과 동일 원칙: 사건이 있을 때만 저장, 그 전 상태는 계산). (b) 훈련생 상태 = `trainee_enrollment.status`(인물 `trainee`에는 상태 없음).

### 3-1. 과정 상태 — `course.status`

| 코드 | 표시명 | 의미 | 생성 조건 | 다음 상태 | 변경 가능 역할 |
|---|---|---|---|---|---|
| PREPARING | 준비중 | 개설 후 개강 전 | 과정 등록(S16) | RECRUITING, IN_PROGRESS, SUSPENDED | OPS_MANAGER |
| RECRUITING | 모집중 | 대상자 모집 중 | 준비중에서 모집 시작 | IN_PROGRESS, SUSPENDED | OPS_MANAGER |
| IN_PROGRESS | 운영중 | 교육 진행 | 수동 전환 또는 자동 전환(첫 교육일 도래 + 확정 훈련생 ≥ 1, SYSTEM_BATCH) | CLOSED, SUSPENDED | OPS_MANAGER (자동 전환은 시스템) |
| CLOSED | 종료 | 종료 체크리스트를 거쳐 종결 | 종료 처리(S16) | 없음(최종) | OPS_MANAGER 단독(EXECUTIVE 승인 없음, decisions.md D-06 확정 2026-09-22). API 구현은 Phase 2~4 이후(P1-03) |
| SUSPENDED | 중단 | 개설 취소 또는 강제 중단 | 사유 입력 후 중단 처리 | 없음(최종) | OPS_MANAGER |

### 3-2. 훈련생 상태 — `trainee_enrollment.status`

| 코드 | 표시명 | 의미 | 생성 조건 | 다음 상태 | 변경 가능 역할 |
|---|---|---|---|---|---|
| APPLIED | 신청 | 등록됐으나 검토 전 | S04 등록 | REVIEWING, CANCELLED | OPS_MANAGER |
| REVIEWING | 서류확인중 | 자격·서류 검토 중 | S02 확인 착수 | CONFIRMED, CANCELLED | OPS_MANAGER |
| CONFIRMED | 확정 | 입과 확정(출결·결과물 대상) | S02 확정 | COMPLETED, DROPPED, EXPELLED | OPS_MANAGER, S02(`/enrollments/{id}/complete`\|`/drop`\|`/expel`), 사유 필수, 자동 판정 없음(decisions.md D-05·P1-04 확정 2026-09-22) |
| COMPLETED | 수료 | 과정 이수 | S02 수료 처리 | 없음(최종) | 자동 판정 기준(출석률 등)은 미도입, 담당자 재량(D-05·P1-04) |
| DROPPED | 중도포기 | 본인 사유로 중단 | S02 중도포기 처리 | 없음(최종) | 〃 |
| EXPELLED | 제적 | 기관 조치로 제외 | S02 제적 처리 | 없음(최종) | 〃 |
| CANCELLED | 취소 | 자격 미달·반려·중복 신청 | 사유(cancel_reason) 입력 | 없음(재신청은 신규 등록 건) | OPS_MANAGER |

### 3-3. 출결 상태 — `attendance.attendance_status` 와 계산값

| 코드 | 표시명 | 저장/계산 | 의미 | 생성 조건 | 다음 상태 | 변경 가능 역할 |
|---|---|---|---|---|---|---|
| (NOT_CHECKED) | 미출결 | **계산** | 확정 훈련생인데 해당 회차의 attendance 행이 없음 | 계산 조건: enrollment=CONFIRMED, 회차≠CANCELLED, 행 없음 | PRESENT, LATE, ABSENT(행 생성) | 입실 확인: OPS_MANAGER·INSTRUCTOR(본인 회차), 결석 확정: OPS_MANAGER(`[결정 필요]` #20) |
| PRESENT | 출석 | 저장 | 정상 입실 | 입실 확인 또는 공식 데이터 반영 | EARLY_LEAVE, 수정으로 임의 상태 | 최초 확인은 위와 동일, 수정은 OPS_MANAGER(S09) |
| LATE | 지각 | 저장 | 지각 입실 | 입실 확인 시 지각 판정(`[결정 필요]` #22) | EARLY_LEAVE, 수정으로 임의 상태 | 동일 |
| EARLY_LEAVE | 조퇴 | 저장 | 조기 퇴실 | 조기 퇴실 확인(자동 판정 여부 #22) 또는 수정 | 수정으로 임의 상태 | OPS_MANAGER |
| ABSENT | 결석 | 저장 | 결석 확정 | 결석 확정 액션 | EXCUSED, 수정으로 임의 상태 | OPS_MANAGER |
| EXCUSED | 인정결석 | 저장 | 사유서 확인된 결석 | 결석에서 수정 | 수정으로 임의 상태 | OPS_MANAGER(S09, 사유 필수) |

`source_type`: OFFICIAL 공식 / MANUAL 내부수기 / LINKED 연계자동. 생성 시점에 확정되며 NOT NULL.
`attendance_change_log.actor_type`: USER / SYSTEM_BATCH / SYSTEM_API.

### 3-4. 확인 건 상태 — `verification_case.status`

| 코드 | 표시명 | 의미 | 생성 조건 | 다음 상태 | 변경 가능 역할 |
|---|---|---|---|---|---|
| NEEDS_CHECK | 확인필요 | 탐지·수동 전환 직후 기본 상태 | 규칙 매칭(detection_rule.initial_status) 또는 MANUAL 전환 | IN_REVIEW | 생성: 시스템 또는 OPS_MANAGER·EXECUTIVE(수동), 전이: OPS_MANAGER·EXECUTIVE |
| PRIORITY_CHECK | 우선확인 | 우선 처리 대상으로 시작 | initial_status=우선확인인 규칙(어떤 규칙인지 `[결정 필요]` #26) | IN_REVIEW | 동일 |
| IN_REVIEW | 확인중 | 담당자가 근거를 확인 중 | 확인 시작(confirmation_note 필수) | CONFIRMED, ACTION_REQUIRED | OPS_MANAGER, EXECUTIVE |
| CONFIRMED | 확인완료 | 조치 없이 종결 | 확인중에서 종결 | FOLLOW_UP(재오픈) | OPS_MANAGER, EXECUTIVE |
| ACTION_REQUIRED | 조치필요 | 조치가 필요하다고 판단 | 확인중에서 전환(action_note 필수) | ACTION_DONE | OPS_MANAGER, EXECUTIVE |
| ACTION_DONE | 조치완료 | 조치까지 종결 | 조치필요에서 종결 | FOLLOW_UP(재오픈) | OPS_MANAGER, EXECUTIVE |
| FOLLOW_UP | 추가확인 | 종결 후 재검토 | 종결 건 재오픈(사유 필수) | IN_REVIEW | OPS_MANAGER, EXECUTIVE |

종결(terminal-like) 상태 = CONFIRMED, ACTION_DONE. 종결 건 판정용 "미종결" = NEEDS_CHECK, PRIORITY_CHECK, IN_REVIEW, FOLLOW_UP, ACTION_REQUIRED. 화면의 "우선순위" 열은 저장 컬럼이 아니라 status=PRIORITY_CHECK 여부로 계산한다. 어떤 상태도 "부정행위"·"부정수급" 등 판정 표현을 쓰지 않는다.

`verification_action_log.action_type` 사용 규칙: 확인 시작=CHECK / 조치 필요 기록=ACTION_ENTRY / 확인완료·조치완료=CLOSE / 추가확인=REOPEN / STATUS_CHANGE=예비(미사용). 담당자 배정은 audit_log로만 기록.

### 3-5. 결과물 상태 — `submission`

| 코드 | 표시명 | 저장/계산 | 의미 | 생성 조건 | 다음 상태 | 변경 가능 역할 |
|---|---|---|---|---|---|---|
| (NOT_SUBMITTED) | 미제출 | **계산** | 확정 훈련생인데 submission 행 없음 | 행 없음 | SUBMITTED, LATE_SUBMITTED(등록) | OPS_MANAGER(등록) |
| SUBMITTED | 제출됨 | 저장 `submit_status` | 기한 내 등록 | 결과물 등록 | 재등록 시 version 증가(상태 유지) | OPS_MANAGER |
| LATE_SUBMITTED | 기한후제출 | 저장 `submit_status` | 기한 이후 등록 | 결과물 등록(기한 기준 위치 `[결정 필요]` #24) | 재등록 시 version 증가 | OPS_MANAGER |
| PENDING | 대기 | 저장 `review_status` | 검토 전 | 등록 직후, 재등록 직후(검토 결과 초기화) | APPROVED, REVISION_REQUESTED, REJECTED | OPS_MANAGER |
| APPROVED | 적합 | 저장 | 검토 통과 | 검토 저장 | (재등록 불가) | OPS_MANAGER |
| REVISION_REQUESTED | 보완요청 | 저장 | 보완 후 재등록 필요 | 검토 저장 | PENDING(재등록 시) | OPS_MANAGER |
| REJECTED | 부적합 | 저장 | 부적합 판정 | 검토 저장 | 재등록 허용 여부는 `[결정 필요]` #5 | OPS_MANAGER |

검토 결과(`submission_review_log.review_result`)는 적합/보완요청/부적합 3값이며 검토할 때마다 version과 함께 append된다. INSTRUCTOR는 검토 권한이 없다.

### 3-6. 과정 회차 상태 — `class_schedule.status`

| 코드 | 표시명 | 저장/계산 | 의미 | 생성 조건 | 다음 상태 | 변경 가능 역할 |
|---|---|---|---|---|---|---|
| SCHEDULED | 예정 | 저장(기본값) | 정상 편성 | 교육일정 등록(S13) | CANCELLED | OPS_MANAGER |
| CANCELLED | 휴강 | 저장 | 휴강 확정(사유 필수) | 휴강 처리 | 휴강 해제 기능은 명세에 없음(필요 시 별도 정의) | OPS_MANAGER |
| (COMPLETED) | 진행완료 | **계산** | 휴강이 아니고 현재 시각이 종료 시각을 지남 | now > class_date+end_time | — | 변경 불가(계산) |

### 3-7. 운영일지 상태

`operation_log`에는 상태 컬럼이 없다. 표시용 계산 상태만 존재한다.

| 코드 | 표시명 | 저장/계산 | 의미 | 조건 | 비고 |
|---|---|---|---|---|---|
| (NOT_WRITTEN) | 미작성 | **계산** | 해당 회차의 운영일지 행이 없음 | 회차≠CANCELLED, 행 없음 | 종료 체크리스트·RULE_03·대시보드 집계 기준 |
| (WRITTEN) | 작성됨 | **계산** | 행이 존재 | UNIQUE(schedule_id)에 의해 회차당 1건 | 수정은 같은 행 UPDATE, 이력은 audit_log |

### 3-8. 기타 상태·코드

| 도메인 | 코드(표시명) | 비고 |
|---|---|---|
| 특이사항 `course_issue.status` | REGISTERED(등록) → IN_REVIEW(확인중) → RESOLVED(조치완료) | "확인 필요로 전환" 실행 시 자동으로 IN_REVIEW. 이후 verification_case와 독립적으로 관리, RESOLVED는 OPS_MANAGER가 직접 처리 |
| 강사 `instructor.status` | ACTIVE(활동) / INACTIVE(비활동) | OPS_MANAGER |
| 강사 배정 `instructor_assignment.status` | ASSIGNED(배정) / CANCELLED(배정취소) | OPS_MANAGER |
| 사용자 `user_account.status` | ACTIVE(활성) / INACTIVE(비활성) | SYS_ADMIN |
| 역할 `role.role_code` | SYS_ADMIN / OPS_MANAGER / INSTRUCTOR / EXECUTIVE | 4개 고정, 커스텀 역할은 `[결정 필요]` #7 |
| 권한 범위 `role_permission.scope_type` | ALL(전체) / OWN_ASSIGNED(본인담당) | |
| 탐지 규칙 `detection_rule.is_active` | true/false | MANUAL은 항상 true |
| 감사 `audit_log.actor_type` | USER / SYSTEM_RULE / SYSTEM_BATCH / SYSTEM_API | 2-3절 |
| 감사 `audit_log.action` | CREATE / UPDATE / DELETE(예약) / VIEW_SENSITIVE / LOGIN / LOGOUT / LOGIN_FAILED / ACCESS_DENIED | 7절 |
| 다형성 `entity_type` | change_log: TRAINEE, ENROLLMENT / INSTRUCTOR, ASSIGNMENT. attachment: OPERATION_LOG, SUBMISSION, COURSE_ISSUE | 앱 레벨 검증 필수 |

---

## 4. 권한 최종 매트릭스

### 4-1. 기준 충돌 해소

- **시스템 관리자**: STEP 2.2(이전 초안)는 업무 데이터 CRUD를 주었으나 STEP 7-A의 화면 명세(S02·S04·S12·S13·S16 등)는 모두 OPS_MANAGER 전용이었다. 화면 명세와 "시스템 관리자는 업무 데이터를 만지지 않는다"는 원칙을 따라 **업무 데이터는 조회 전용**으로 통일했다(STEP 2.2 수정 완료). 예외 수정 필요 여부는 `[결정 필요]` #19.
- **운영담당자 과정 범위**: 전체 과정 접근으로 **확정**(2026-09-21, D-02, STEP 12 #18). `manager_user_id`는 표시용이다. 정책 변경 시 재검토하고 스코프·API·권한을 함께 변경한다.
- **결석 확정**: S07에서 강사에게도 허용된 것처럼 적혀 있었으나 판단성 기록이므로 기본값을 OPS_MANAGER 전용으로 정정(`[결정 필요]` #20).

### 4-2. 역할 × 기능 상세

범례: O=허용, R=조회만, —=불가, ◎=서버/API에서 소속(행 단위 스코프) 재검증 필수. "삭제/취소"는 hard delete가 아니라 취소·비활성·무효 상태 전환을 뜻한다(8절 — 어떤 역할에도 hard delete 없음).

| 영역(화면) | 기능 | SYS_ADMIN | OPS_MANAGER | INSTRUCTOR | EXECUTIVE |
|---|---|---|---|---|---|
| 대시보드(S01) | 조회 | R | R(전체 과정) | R ◎본인 배정 | R |
| 과정(S15·S16) | 조회 | R | O | R ◎본인 배정 과정 | R |
| | 생성·수정 | — | O | — | — |
| | 상태 전환(모집·운영중), 중단(취소) | — | O | — | — |
| | **과정 종료** | — | O (OPS_MANAGER 단독, D-06 확정) | — | — |
| 훈련생·대상자(S02~S06) | 조회 | R | O | R ◎본인 배정 과정 훈련생만(변경이력 S06 제외) | R |
| | 등록·수정 | — | O | — | — |
| | 확정·반려(취소) | — | O | — | — |
| | 수료·중도포기·제적 | — | `[결정 필요]` #23 | — | — |
| 출결(S07~S10) | 조회 | R | O | R ◎본인 회차(S10 이력 제외) | R |
| | 입실·퇴실 확인(최초 생성) | — | O | O ◎본인 회차 | — |
| | 결석 확정 | — | O | `[결정 필요]` #20 (기본 —) | — |
| | 출결 수정(S09) | — | O(사유 필수) | — | — |
| 강사·일정(S11~S14) | 조회 | R | O | R ◎본인(강사 정보)·본인 배정 회차(일정) | R |
| | 강사 등록·수정, 배정, 일정 등록·수정, 휴강(취소) | — | O | — | — |
| 운영일지(S17) | 조회 | R | O | R ◎본인 회차 | R |
| | 작성·수정 | — | 수정만 O(검수 목적) | O ◎본인 회차 | — |
| 특이사항(S18) | 조회 | R | O | 본인 등록 건 ◎ | R |
| | 등록 | — | O | O ◎본인 배정 과정 | — |
| | 수정·조치완료 처리 | — | O | — | — |
| | 확인 필요로 전환 | — | O | — | O |
| 결과물(S19~S21) | 조회(제출현황·미제출) | R | O | R ◎본인 배정 과정 | R |
| | 등록·재등록 | — | O | — | — |
| | 검토(S21) | — | O | — (S21 접근 불가) | R |
| 확인/조치(S22~S24) | 조회 | R | O | — (메뉴 미노출, 대시보드 요약만 ◎) | R |
| | 담당자 배정 | — | O | — | O |
| | 확인 시작·확인완료 | — | O | — | O |
| | 조치 기록·조치완료 | — | O | — | O |
| | 재오픈(추가확인) | — | O | — | O |
| 이력 조회(S06·S10·S14·S24) | 조회 | R | R | — | R |
| 사용자·권한(S25·S26) | 조회·생성·수정·비활성화 | O | — | — | — |
| 감사로그(S27) | 조회 | R | — | — | R |
| 탐지규칙(S28, Phase 5) | 파라미터 조회·수정, 활성/비활성 | O | — | — | — |

### 4-3. 서버/API 필수 검증 (UI 숨김으로 대체 불가)

| # | 검증 | 이유 |
|---|---|---|
| V1 | 모든 엔드포인트에서 세션·역할·행위 권한 검증(4-2 표 전부) | 버튼·메뉴 숨김은 통제가 아니다 |
| V2 | INSTRUCTOR 스코프: 요청 경로·본문의 course_id, schedule_id, trainee_id, submission_id, attachment_id, case_id가 본인 배정 범위인지 매 요청 재검사. 회차 접근 = schedule.instructor_id가 본인, 과정 접근 = 본인의 유효한 instructor_assignment(status=ASSIGNED)가 있는 과정 | 타 강사 과정·훈련생 정보 조회·수정 방지(URL·ID 변조 대응) |
| V3 | 스코프 위반 응답: 403 또는 존재 은닉용 404, 그리고 audit_log(action=ACCESS_DENIED) 기록 | STEP 2.6 |
| V4 | 목록 API는 사후 필터가 아니라 **쿼리 조건에 스코프를 포함**해 반환(총 건수·검색 결과로 타 범위 존재 유추 방지) | 정보 누출 방지 |
| V5 | 상태 전이 API는 현재 상태를 검사(허용된 이전 상태에서만 전이, 그 외 409). 확인 건은 낙관적 잠금(expected_status 또는 수정 시각) | 3절 전이표 준수, 동시 처리 충돌 |
| V6 | 사유 필수 액션(출결 수정, 휴강, 반려, 재오픈, 종료 강행, 재배정, 개인정보 수정)의 사유 누락 시 400 | 변경이력·감사 요건 |
| V7 | 결석 확정·출결 수정·과정 종료·확인 건 처리는 역할 검증 + 대상 과정 상태 검증(CLOSED·SUSPENDED 과정의 변경 거부, 예외 수정 경로는 #25) | 종료 후 데이터 보호 |
| V8 | 첨부파일 다운로드는 부모 엔티티(운영일지·특이사항·결과물)의 스코프 검증 후에만 허용 | 10절 |
| V9 | S27 감사로그 조회는 SYS_ADMIN·EXECUTIVE만, 기간 필수·최대 범위 제한 | 대량 조회·남용 방지 |
| V10 | 로그 테이블(change_log·audit_log·action_log)은 애플리케이션 DB 계정에 UPDATE·DELETE 권한을 주지 않는다 | 감사로그 보호 |

---

## 5. 화면 ↔ API 요구사항 매핑

정의만 한다(실제 API 코드·상세 스키마는 작성하지 않음). 경로는 `/api/v1` 이하이며 동사형 명령(`POST /…/{id}/{action}`)은 **단순 UPDATE와 구분해야 하는 업무 액션**이다 — 각각 허용 이전 상태, 권한, 필수 사유, 이력·감사 액션이 다르기 때문이다. 필드 편집만 하는 경우에만 `PATCH`를 쓴다. 감사 열의 형식은 `action / target / actor_type`이며 "동시"는 같은 트랜잭션을 뜻한다.

공통 규칙: (a) 생성 명령은 이미 존재하면 409(멱등 키 지원). (b) 최초 기록과 정정을 분리한다 — 값이 없을 때만 최초 기록 명령이 동작하고 이미 값이 있으면 409로 정정 명령을 안내. (c) 모든 명령의 스코프·상태 검증은 4-3을 따른다.

### 5-1. 공통·인증

| 화면 | 기능 | Method | 경로 | 입력 | 출력 | 권한 | 감사로그 |
|---|---|---|---|---|---|---|---|
| (로그인 화면, S01~S27 외 시스템 공통) | 로그인 | POST | /auth/login | login_id, password | 세션, 사용자·역할·instructor_id | 공개 | LOGIN / user_account / USER, 실패 시 LOGIN_FAILED(사유) |
| 〃 | 로그아웃 | POST | /auth/logout | — | — | 로그인 사용자 | LOGOUT / user_account / USER |
| 〃 | 내 정보·메뉴 권한 | GET | /auth/me | — | 사용자, 역할, 접근 가능 화면·기능 | 로그인 사용자 | 없음 |
| S17·S18·S19 | 첨부 업로드 | POST | /attachments | entity_type, entity_id, entity_version(결과물만), 파일 | attachment_id | 부모 엔티티 생성·수정 권한 + 스코프 | CREATE / attachment / USER |
| S17·S18·S19·S21 | 첨부 다운로드 | GET | /attachments/{id}/download | — | 파일 스트림 | 부모 엔티티 조회 권한 + 스코프 | VIEW_SENSITIVE / attachment / USER |

### 5-2. 화면별 API

| 화면 | 기능 | Method | 경로 | 입력 | 출력 | 권한 | 감사로그 |
|---|---|---|---|---|---|---|---|
| S01 대시보드 | 오늘 현황 요약 | GET | /dashboard | date, course_id, assignee_id | 오늘 회차 목록, 확인 건 상태별 건수·최근 N건(관련 훈련생 0~N), 미출결·퇴실미확인·운영일지 미작성·결과물 미제출·미검토 건수 | 전 역할(스코프) | 없음 |
| S02 대상자 확인 | 대상자 목록 | GET | /enrollments | status, course_id, name, applied_from, applied_to | 등록 건 목록(생년월일은 연도만) | OPS·SYS·EXEC | 없음 |
| | 확인 착수 | POST | /enrollments/{id}/start-review | — | 갱신된 등록 건 | OPS | UPDATE / trainee_enrollment / USER + trainee_change_log(ENROLLMENT) |
| | 확정 | POST | /enrollments/{id}/confirm | — | 갱신된 등록 건 | OPS | UPDATE / trainee_enrollment / USER + change_log |
| | 반려·취소 | POST | /enrollments/{id}/reject | cancel_reason(필수) | 갱신된 등록 건 | OPS | UPDATE / trainee_enrollment / USER + change_log |
| | 수료·중도포기·제적 처리(D-05·P1-04 확정 2026-09-22) | POST | /enrollments/{id}/complete \| /drop \| /expel | reason(필수) | 갱신된 등록 건(status=COMPLETED\|DROPPED\|EXPELLED, CONFIRMED 상태에서만) | OPS | UPDATE / trainee_enrollment / USER + change_log |
| S03 훈련생 목록 | 확정 훈련생 조회 | GET | /trainees | course_id, status, name, contact | 훈련생·등록 정보(연락처·생년월일 마스킹) | OPS·SYS·EXEC, INSTRUCTOR ◎ | 없음 |
| S04 훈련생 등록 | 중복 후보 검색 | GET | /trainees/search | name, birth_date | 일치 인물 후보 | OPS | 없음 |
| | 등록(신규 인물 또는 기존 인물 선택 + 과정 지정) | POST | /enrollments | trainee(name, birth_date, contact) 또는 trainee_id, course_id, applied_at | 등록 건(status=APPLIED) | OPS | CREATE / trainee, trainee_enrollment / USER |
| | 명단 일괄 등록 | POST | /enrollments/import | 엑셀, course_id | 행별 성공·오류 결과 | OPS | CREATE / trainee_enrollment / USER (건별) |
| | 인적정보 수정 | PATCH | /trainees/{id} | 변경 필드, reason | 갱신된 훈련생 | OPS | UPDATE / trainee / USER + trainee_change_log(TRAINEE, 개인정보 마스킹) |
| S05 훈련생 상세 | 기본정보 | GET | /trainees/{id} | — | 인적정보, 등록 건 | 전 역할(◎) | 없음 |
| | 등록 이력 | GET | /trainees/{id}/enrollments | — | 등록 건 목록 | 〃 | 없음 |
| | 출결 요약 | GET | /trainees/{id}/attendance-summary | course_id | 회차별 출결(미출결 계산 포함). 과정 범위도 확인(강사는 본인 배정 과정만, 아니면 404) | 〃 | 없음 |
| | 결과물 현황 | GET | /trainees/{id}/submissions | course_id | 결과물 목록(강사는 본인 배정 과정 것만) | 〃 | 없음 |
| | 관련 확인 건 | GET | /trainees/{id}/verification-cases | — | verification_case_trainee 기준 사건 목록 | OPS·EXEC·SYS | 없음 |
| S06 훈련생 변경이력 | 이력 조회 | GET | /trainee-change-logs | trainee_id, trainee_name, entity_type, from, to | 이력 목록(훈련생 이름, 등록 건이면 과정명 포함) | OPS·SYS·EXEC | 없음 |
| S07 일일 출결 | 출결 명단(미출결 계산) | GET | /schedules/{scheduleId}/attendance-roster | status(미출결 포함) | 확정 훈련생 × attendance LEFT JOIN 결과, 표시상태, 출처(source_type) | OPS·SYS·EXEC, INSTRUCTOR ◎ | 없음 |
| | 입실 확인(출결 확정) | POST | /schedules/{scheduleId}/attendance/check-in | trainee_ids[], check_in_time(선택), source_type(기본 MANUAL) | 생성된 attendance 목록, 이미 존재한 대상 목록(409 분리) | OPS, INSTRUCTOR ◎ | CREATE / attendance / USER |
| | 퇴실 확인 | POST | /attendance/check-out | attendance_ids[], check_out_time(선택) | 갱신 결과(이미 값이 있는 건은 409 → 수정 명령 안내) | OPS, INSTRUCTOR ◎ | UPDATE / attendance / USER (최초 기록, change_log 없음) |
| | 결석 확정 | POST | /schedules/{scheduleId}/attendance/confirm-absence | trainee_ids[] | 생성된 attendance(ABSENT) | OPS (강사 허용은 #20) | CREATE / attendance / USER |
| S08 과정별 출결 | 출결 매트릭스 | GET | /courses/{id}/attendance-matrix | trainee_name, status | 훈련생 × 회차 셀(미출결 계산 포함, 기록 있는 셀은 attendance_id — S09 진입), 출석률 | OPS·SYS·EXEC, INSTRUCTOR ◎ | 없음 |
| S09 출결 수정 | 수정 대상 조회 | GET | /attendance/{id} | — | 현재 값, last_modified_at | OPS | 없음 |
| | 출결 수정 | POST | /attendance/{id}/correct | check_in_time, check_out_time, attendance_status(변경 항목), reason(필수), 기대 last_modified_at | 갱신된 attendance, 임계치 초과 안내 여부 | OPS | UPDATE / attendance / USER 동시 attendance_change_log(actor USER) |
| S10 출결 수정이력 | 이력 조회 | GET | /attendance-change-logs | course_id, trainee_id, trainee_name, from, to, actor_type | 이력 목록(과정·회차·교육일 포함) | OPS·SYS·EXEC | 없음 |
| S11 강사 목록 | 강사 목록 | GET | /instructors | name, status | 강사 목록, 담당 과정 수 | OPS·EXEC·SYS, INSTRUCTOR 본인 ◎ | 없음 |
| S12 강사 등록/수정 | 강사 상세 | GET | /instructors/{id} | — | 강사, 연결 계정 정보(읽기전용) | 〃 | 없음 |
| | 강사 등록 | POST | /instructors | name, contact, status | 강사 | OPS | CREATE / instructor / USER |
| | 강사 수정(비활동 전환 포함) | PATCH | /instructors/{id} | 변경 필드, reason | 갱신된 강사, 진행 중 배정 경고 | OPS | UPDATE / instructor / USER + instructor_change_log(INSTRUCTOR) |
| S13 강의 일정/교육일정 | 일정 목록 | GET | /schedules | course_id 또는 instructor_id, from, to | 회차 목록(계산 진행완료 포함, 내용 포함. course_id 지정 시 회차 순, 아니면 날짜 순 — system-design 3.4) | OPS·SYS·EXEC, INSTRUCTOR ◎ | 없음 |
| | 회차 등록 | POST | /courses/{id}/schedules | round_no, class_date, start_time, end_time, instructor_id, content | class_schedule(같은 강사·같은 날 시간이 겹치는 예정 회차가 있으면 warnings.overlappingSchedules — 경고만, S13 예외 상황) | OPS | CREATE / class_schedule / USER (필요 시 instructor_assignment도 CREATE) |
| | 회차 수정 | PATCH | /schedules/{id} | class_date, 시간, content | 갱신된 회차(시간 겹침 경고 동일) | OPS | UPDATE / class_schedule / USER |
| | 휴강 처리 | POST | /schedules/{id}/cancel-class | reason(필수) | status=CANCELLED | OPS | UPDATE / class_schedule / USER |
| | 강사 재배정(P1-06 확정 2026-09-22) | POST | /schedules/{id}/reassign-instructor | instructor_id, reason(필수) | 갱신된 회차(class_schedule.instructor_id만 변경, instructor_assignment는 자동 생성·취소하지 않음 — 새 강사에게 유효한 배정이 이미 있어야 함, 시간 겹침 경고 동일) | OPS | UPDATE / class_schedule / USER (instructor_change_log 없음) |
| | 과정 단위 강사 배정 | POST | /courses/{id}/instructor-assignments | instructor_id, round_no(선택) | 배정 | OPS | CREATE / instructor_assignment / USER |
| | 배정 취소 | POST | /instructor-assignments/{id}/cancel | reason | status=CANCELLED | OPS | UPDATE / instructor_assignment / USER + instructor_change_log |
| S14 강사 변경이력 | 이력 조회 | GET | /instructor-change-logs | instructor_id, entity_type, from, to | 이력 목록(대상 강사명, 배정 이력은 과정·회차 범위 포함) | OPS·SYS·EXEC | 없음 |
| S15 과정 목록 | 과정 목록 | GET | /courses | name, status, from, to, manager_user_id | 과정 목록(담당자 이름 포함), 확정 훈련생 수 | 전 역할(◎) | 없음 |
| S16 과정 등록/수정/상세 | 과정 상세 | GET | /courses/{id} | — | 과정(담당자 이름 포함), 훈련생·강사배정·일정 요약 | 전 역할(◎) | 없음 |
| | 담당자 후보 | GET | /courses/manager-candidates | — | 활성 OPS_MANAGER 의 user_id·name 만 (P1-18 과 같은 기준). 사용자 관리(S25)가 SYS 전용이라 등록·수정 화면용으로 따로 연 조회 | OPS(S16:U) | 없음 |
| | 과정 등록 | POST | /courses | 과정 기본정보, manager_user_id | course(PREPARING) | OPS | CREATE / course / USER |
| | 과정 기본정보 수정 | PATCH | /courses/{id} | 변경 필드 | 갱신된 과정 | OPS | UPDATE / course / USER (before/after) |
| | 모집 시작 | POST | /courses/{id}/open-recruitment | — | status=RECRUITING | OPS | UPDATE / course / USER |
| | 운영중 전환 | POST | /courses/{id}/start | 확정 훈련생 0명 경고 확인값 | status=IN_PROGRESS | OPS | UPDATE / course / USER (자동 전환은 SYSTEM_BATCH) |
| | 종료 체크리스트 | GET | /courses/{id}/closure-checklist | — | 9절 항목별 건수·처리 구분(차단/경고/불필요) | OPS·SYS·EXEC | 없음 |
| | 과정 종료 | POST | /courses/{id}/close | override_reason(경고 항목 강행 시 필수) | status=CLOSED | OPS 단독(D-06 확정, EXECUTIVE 승인 없음). 구현은 Phase 2~4 이후(P1-03) | UPDATE / course / USER, after에 미해결 항목 스냅샷, reason |
| | 과정 중단 | POST | /courses/{id}/suspend | reason(필수) | status=SUSPENDED | OPS | UPDATE / course / USER |
| S17 회차별 운영일지 | 회차별 작성 현황 | GET | /courses/{id}/operation-logs | round_no, from, to | 회차 목록(미작성 계산 포함, 교육 시간·강사명), 참여인원 | OPS·SYS·EXEC, INSTRUCTOR ◎ | 없음 |
| | 운영일지 조회 | GET | /schedules/{id}/operation-log | — | 운영일지(작성자·강사명), 첨부 목록(파일명·크기·업로드 시각, 저장 경로 제외) | 〃 | 없음 |
| | 운영일지 작성 | POST | /schedules/{id}/operation-log | content, participant_count, issue_note | operation_log(휴강 회차 거부, 이미 있으면 409) | INSTRUCTOR ◎ | CREATE / operation_log / USER |
| | 운영일지 수정 | PATCH | /operation-logs/{id} | 변경 필드 | 갱신본 | 작성 강사 ◎, OPS(검수) | UPDATE / operation_log / USER (before/after) |
| S18 특이사항 | 목록 | GET | /course-issues | course_id, round_no, status | 특이사항(과정명·교육일, 연결된 확인 건 ID·현재 상태 — 가장 최근 건) | OPS·SYS·EXEC, INSTRUCTOR 본인 등록분 ◎ | 없음 |
| | 등록 | POST | /course-issues | course_id, schedule_id(선택), category, content | course_issue(REGISTERED) | INSTRUCTOR ◎, OPS | CREATE / course_issue / USER |
| | 수정 | PATCH | /course-issues/{id} | 변경 필드 | 갱신본 | OPS | UPDATE / course_issue / USER |
| | 확인 필요로 전환 | POST | /course-issues/{id}/escalate | trainee_ids[](선택) | 생성된 verification_case(MANUAL), issue.status=IN_REVIEW, 이미 활성 건 있으면 409 | OPS, EXEC | CREATE / verification_case, verification_case_trainee / USER 동시 UPDATE / course_issue |
| | 조치완료 처리 | POST | /course-issues/{id}/resolve | — | status=RESOLVED | OPS | UPDATE / course_issue / USER |
| S19 결과물 제출현황 | 제출현황(미제출 계산) | GET | /courses/{id}/submission-status | trainee_name, review_status, missing_only | 확정 훈련생 × submission LEFT JOIN 결과 | OPS·SYS·EXEC, INSTRUCTOR ◎ | 없음 |
| | 결과물 등록 | POST | /courses/{id}/submissions | trainee_id, title, submitted_at(필수), 파일 | submission(version 1, PENDING), 이미 있으면 409 | OPS | CREATE / submission / USER |
| | 결과물 재등록 | POST | /submissions/{id}/re-register | submitted_at, 파일 | version 증가, review_status=PENDING | OPS | UPDATE / submission / USER (before/after) |
| S20 결과물 미제출 | 미제출 목록 | GET | /courses/{id}/submission-status | missing_only=true | 미제출 계산 대상자(제출기한 관련 열은 #24 확정 전 보류) | OPS·EXEC·SYS, INSTRUCTOR ◎ | 없음 (S19 API 재사용) |
| S21 결과물 검토 | 결과물 상세·이력 | GET | /submissions/{id} | — | 제출 정보, 버전별 첨부, 검토 이력 | OPS·EXEC·SYS | 없음 |
| | 검토 저장 | POST | /submissions/{id}/reviews | review_result, review_comment | submission_review_log, review_status 갱신 | OPS | CREATE / submission_review_log 동시 UPDATE / submission / USER |
| S22 확인 필요 목록 | 확인 건 목록 | GET | /verification-cases | period 또는 from·to(발생일 범위, APP_TIMEZONE 기준), course_id, trainee_name, assignee_id, rule_code, status[] | 사건 목록(관련 훈련생 0~N, 우선순위 계산) | OPS·SYS·EXEC | 없음 |
| | 담당자 일괄 배정 | POST | /verification-cases/assign | case_ids[], assignee_id | 갱신 건수 | OPS, EXEC | UPDATE / verification_case / USER (건별) |
| S23 확인 필요 상세 | 상세 | GET | /verification-cases/{id} | — | 근거(evidence.items), 관련 훈련생·출결 목록, 특이사항·운영일지·회차 링크, 처리 이력 | OPS·EXEC·SYS | 없음 |
| | 확인 시작 | POST | /verification-cases/{id}/start-review | confirmation_note(필수), 기대 status | status=IN_REVIEW | OPS, EXEC | UPDATE / verification_case / USER 동시 verification_action_log(CHECK) |
| | 확인완료 | POST | /verification-cases/{id}/complete-confirmation | confirmation_note | status=CONFIRMED, closed_at | OPS, EXEC | UPDATE / verification_case / USER 동시 action_log(CLOSE) |
| | 조치 필요 기록 | POST | /verification-cases/{id}/require-action | action_note(필수) | status=ACTION_REQUIRED | OPS, EXEC | UPDATE / verification_case / USER 동시 action_log(ACTION_ENTRY) |
| | 조치완료 | POST | /verification-cases/{id}/complete-action | action_note | status=ACTION_DONE, closed_at | OPS, EXEC | UPDATE / verification_case / USER 동시 action_log(CLOSE) |
| | 재오픈(추가확인) | POST | /verification-cases/{id}/reopen | reason(필수) | status=FOLLOW_UP | OPS, EXEC | UPDATE / verification_case / USER 동시 action_log(REOPEN) |
| S24 조치이력 | 조치 이력 | GET | /verification-action-logs | course_id, assignee_id, from, to, action_type | 이력 목록 | OPS·EXEC·SYS | 없음 |
| S25 사용자 | 사용자 목록·상세 | GET | /users, /users/{id} | 조건 | 사용자(password_hash 제외) | SYS | 없음 |
| | 사용자 등록 | POST | /users | login_id, name, email, role, linked_instructor_id(강사 역할 시 필수) | user | SYS | CREATE / user_account, user_role / USER |
| | 사용자 수정·비활성화 | PATCH | /users/{id} | 변경 필드(status 포함) | 갱신본 | SYS | UPDATE / user_account, user_role / USER |
| | 비밀번호 초기화 | POST | /users/{id}/reset-password | — | 임시 절차 | SYS | UPDATE / user_account / USER (값 미기록) |
| S26 권한 | 권한 조회 | GET | /roles/permissions | role_id | 화면×기능 매트릭스 | SYS | 없음 |
| | 권한 저장 | PUT | /roles/{id}/permissions | 매트릭스 | 저장 결과 | SYS | UPDATE / role_permission / USER (before/after) |
| S28 탐지규칙 (Phase 5) | 규칙 목록 | GET | /detection-rules | — | 규칙 목록(params·is_active·editable) | SYS | 없음 |
| | 파라미터·활성 수정 | PATCH | /detection-rules/{id} | reason(필수), params(기존 키의 값만, 1~100000 정수), is_active | 갱신본. MANUAL 은 409 RULE_NOT_EDITABLE, initial_status 는 수정 불가(D-11) | SYS | UPDATE / detection_rule / USER (before/after, reason) |
| S27 감사로그 | 로그 조회 | GET | /audit-logs | from·to(필수, 최대 범위 제한), actor_type, actor_user_id, target_table, action | 로그 목록 | SYS, EXEC | VIEW_SENSITIVE / audit_log / USER |
| | 로그 상세(diff) | GET | /audit-logs/{id} | — | before/after | SYS, EXEC | VIEW_SENSITIVE / audit_log / USER |

### 5-3. 화면이 없는 내부 처리(개발 범위에 포함)

| 처리 | 종류 | 실행 시점 | actor_type | 비고 |
|---|---|---|---|---|
| RULE_01·02 평가 | 이벤트 처리 | attendance INSERT 커밋 후 비동기(출결 저장을 지연시키지 않음) | SYSTEM_RULE | 6절 |
| RULE_03~06 평가 | 배치 | 6절 시점표 | SYSTEM_RULE | 스케줄러가 호출하되 결과 기록의 행위자는 탐지 엔진 |
| 공식 출결 수집·대사·RULE_07 | 수신+배치 | 연동 방식 확정 후(#1) | SYSTEM_API / SYSTEM_BATCH | STEP 8.2 |
| 과정 자동 운영중 전환 | 배치 | 매일 자정 직후 | SYSTEM_BATCH | 조건: 첫 교육일 도래 + 확정 훈련생 ≥ 1. 조건 미충족이면 전환하지 않음 |

구현(Phase 5, 2026-09-28): 위 표에서 공식 출결 연동(#1 대기)을 제외한 전부가 가동된다. 시간 기반 배치는 `BatchSchedulerService`(APP_TIMEZONE 벽시계 기준) — 과정 자동 전환 00:05, RULE_03 매시 정각, RULE_04 22:00 + 익일 09:00 재확인, RULE_05 01:00, RULE_06 01:10이며, 시점표가 시각을 정하지 않은 항목(00:05·09:00·01:00·01:10)은 기술적 기본값이다. RULE_01·02는 입실 확인 커밋 직후 해당 회차만 비동기 평가하고, 유실 대비로 01:20·01:30에 전체 회차를 한 번 더 평가한다(멱등). 배치·이벤트는 `BATCH_ENABLED`로 끄고 켠다(decisions.md 11절).

### 5-4. 명세 갭(정의 없이 임의 구현 금지)

- (해소 2026-09-22: 수료·중도포기·제적 전이는 D-05·P1-04로 확정·구현됨 — 자동 판정 기준만 Phase 2 이후 별도 결정)
- 휴강 해제(CANCELLED → SCHEDULED) — 도입하지 않기로 확정(P1-06 대신 새 회차 등록으로 대체, decisions.md P1-07 확정 2026-09-22)
- 수강신청 명단 엑셀 일괄 등록(`POST /enrollments/import`) — 도입하지 않기로 확정(decisions.md P1-05 확정 2026-09-22)
- 공식 출결 수신 API(`POST /integrations/attendance` 등) — `[결정 필요]` #1
- 결과물 제출기한 관련 조회 조건 — `[결정 필요]` #24

---

## 6. 이상징후 규칙 최종 정의

원칙: 자동 탐지는 **"확인 필요" 건을 생성하는 것까지만** 한다. 규칙은 attendance·훈련생·결과물 등 어떤 업무 데이터도 변경하지 않으며, 부정행위·부정수급을 판정하거나 그런 표현을 생성하지 않는다. 생성되는 건의 초기 상태는 `detection_rule.initial_status`(확인필요 또는 우선확인)이다. 규칙 코드는 DB·API에서 `RULE_01`처럼 언더스코어로 쓴다(문서 표기 RULE-01과 동일). 모든 규칙은 `class_schedule.status=SCHEDULED`인 회차만 평가하고 `is_active=true`일 때만 동작한다. 임계치는 `detection_rule.params`(JSON)의 키로 관리한다.

| Rule ID | 규칙명 | 탐지 시점 | 입력 데이터 | 조건 | 생성되는 확인 건 | 관련 대상 | 예외조건 | 자동처리 여부 |
|---|---|---|---|---|---|---|---|---|
| RULE_01 | 동일 환경 복수 출결 | attendance INSERT 커밋 후 즉시(비동기) | attendance(related_info의 device_id, check_in_time, schedule_id) | 같은 회차에서 같은 device_id로 서로 다른 훈련생 min_trainees명(기본 3) 이상이 window_minutes(기본 10)분 이내 출결 | 1건, evidence에 device_id·시각·훈련생 목록 사실 나열. dedupe: course·schedule·device_id | 연루 훈련생 전원 N명(각 attendance_id 연결) | related_info 또는 device_id가 없는 출결(내부수기 등)은 평가 제외, 휴강 회차 제외. 활성 건이 있으면 새 훈련생만 추가 | 자동: 건 생성·훈련생 추가·근거 append만 |
| RULE_02 | 짧은 시간 내 복수 계정 출결 | attendance INSERT 커밋 후 즉시(비동기) | attendance(related_info의 출결 채널 식별자, check_in_time) | 같은 채널에서 min_events건(기본 5) 이상이 window_minutes(기본 5)분 이내 연속 발생 | 1건. dedupe: schedule·채널 | 연루 훈련생 전원 N명 | related_info 없는 출결 제외, 휴강 제외. "채널" 식별자의 정의는 출결 환경 확정(#2) 후 확정 | 자동: 건 생성만 |
| RULE_03 | **회차 운영기록 지연** | 매시 정각 배치 | class_schedule(class_date, end_time, status), operation_log 존재 여부 | 회차 종료 시각 + delay_hours(기본 3) 경과 후에도 해당 회차의 operation_log 행이 없음 | 1건, evidence에 schedule_id·종료 시각·경과 시간. dedupe: schedule. 운영일지가 작성되면 자동 종결하지 않으며 담당자가 확인 | **0명**(훈련생 무관, 회차 단위 운영 이슈) | 휴강 회차 제외. 훈련생의 현장 존재 여부를 판단하지 않는다 — 기존의 "입실 후 현장정보 미확인" 의미와 `operation_log.written_at`을 대리 신호로 쓰는 방식은 폐기 | 자동: 건 생성만 |
| RULE_04 | 퇴실정보 누락 | 매일 22:00 배치 + 익일 오전 재확인 | attendance(attendance_status, check_out_time), class_schedule.end_time | **attendance_status IN (PRESENT, LATE)** 이고 check_out_time IS NULL 이며 종료 시각 + delay_hours(기본 2) 경과 | 훈련생별 1건. dedupe: attendance_id | 해당 훈련생 1명(attendance_id 연결) | ABSENT·EXCUSED 행, EARLY_LEAVE 행, attendance 행이 없는 미출결, 휴강 회차 제외(미출결은 종료 체크리스트에서 별도 집계) | 자동: 건 생성만 |
| RULE_05 | 반복적인 출결 수정 | 매일 1회 배치 | attendance_change_log(actor_type=USER 행만) | 동일 훈련생의 수정 건수가 window_days(기본 30)일 내 min_changes(기본 3)회 이상 | 훈련생별 1건. dedupe: trainee·집계 시작일 | 해당 훈련생 1명(대표 attendance_id = 최근 수정 건) | 시스템(공식 대사) 갱신 이력 제외, 종료·중단 과정 제외 | 자동: 건 생성만 |
| RULE_06 | 출결상태 반복 변경 | 매일 1회 배치 | attendance_change_log.before_value/after_value(actor_type=USER 행만) | 동일 attendance 또는 훈련생에서 특정 상태 조합(예: 결석↔출석)이 window_days(기본 30) 내 min_flips(기본 2)회 이상 반복 | 1건. dedupe: trainee·상태조합 | 해당 훈련생 1명 | 시스템 갱신 제외 | 자동: 건 생성만 |
| RULE_07 | 공식-내부 정보 불일치 | 공식 데이터 수신·대사 배치 직후(연동 방식 #1 확정 후 가동) | attendance_source_raw, attendance(source_type=MANUAL/LINKED) | 시간 차이가 tolerance_minutes(기본 15) 초과 또는 상태 불일치 | 훈련생별 1건, evidence에 공식값·내부값 병기. dedupe: attendance_id | 해당 훈련생 1명(attendance_id 연결) | 공식 데이터 없음, source_type=OFFICIAL 행은 정정으로 처리(건 미생성). 공식 시스템이 없으면 규칙 비활성 또는 내부 입력 소스 간 비교로 대체(#1) | 자동: 건 생성만 — attendance는 절대 자동 덮어쓰지 않음 |
| MANUAL | 수동 확인 필요 전환 | 사용자 액션(S18) | course_issue | 조건 없음(담당자 판단) | 1건, evidence에 특이사항 원문 스냅샷, related_course_issue_id 연결 | 0~1명(담당자가 선택) | 같은 특이사항에 활성 건이 있으면 재전환 거부(409) | 수동(자동 아님) |

이 표의 일치 규칙: RULE_03은 어떤 문서에도 "현장정보 미확인"이라는 의미로 남지 않는다(STEP 1.4, 5.1, 8.1, 8.1-A를 모두 "회차 운영기록 지연"으로 정리했고 부록 B~D는 수정 전 스냅샷으로 표시). RULE_04는 attendance_status IN (PRESENT, LATE)를 반영했다. 훈련생 개별 중간 현장 확인은 데이터 소스가 없으므로 MVP 규칙에서 제외하며, 도입은 `[결정 필요]` #16.

---

## 7. 감사로그 정책

- **원칙**: 모든 업무 테이블의 CUD와 인증·접근 이벤트는 서비스 계층의 공통 미들웨어가 원본 변경과 같은 트랜잭션에서 자동 기록한다(개별 화면에서 직접 호출하지 않음). 로그 저장이 실패하면 원본 변경도 실패한다.
- **occurred_at**: 모든 이벤트에서 필수이며 서버 시각으로 자동 기록(컬럼명 `action_at`). 컬럼명 매핑: target_type=`target_table`.
- 범례: ●=필수, ○=조건부·선택, —=NULL(기록 안 함). before/after는 개인정보 필드를 마스킹해 저장(10절), password_hash·토큰은 어떤 이벤트에도 기록하지 않는다.

| # | 이벤트 | actor_type | actor_user_id | action | target_table / target_id | before | after | reason |
|---|---|---|---|---|---|---|---|---|
| 1 | 로그인 성공 | USER | ● | LOGIN | user_account / ● | — | — | — (ip_address ●) |
| 2 | 로그인 실패 | USER | ○(존재하는 계정만) | LOGIN_FAILED | user_account / ○ | — | — | ● 실패 사유 코드 (ip ●) |
| 3 | 로그아웃 | USER | ● | LOGOUT | user_account / ● | — | — | — |
| 4 | 접근 거부(403·스코프 위반) | USER | ● | ACCESS_DENIED | 대상 리소스 / ○ | — | — | ● 거부 사유(역할·스코프) |
| 5 | 교육생(대상자) 등록 | USER | ● | CREATE | trainee, trainee_enrollment / ● | — | ● | — |
| 6 | 교육생 정보 수정 | USER | ● | UPDATE | trainee / ● | ● | ● | ● (change_log와 동일 사유) |
| 7 | 대상자 확정·반려 | USER | ● | UPDATE | trainee_enrollment / ● | ● | ● | 반려 시 ● |
| 8 | 과정 등록 | USER | ● | CREATE | course / ● | — | ● | — |
| 9 | 과정 수정 | USER | ● | UPDATE | course / ● | ● | ● | ○ |
| 10 | 과정 상태 전환(모집·운영중) | USER 또는 SYSTEM_BATCH | ●(USER) / —(BATCH) | UPDATE | course / ● | ● | ● | BATCH는 ● 배치 식별자 |
| 11 | 강사 배정·변경·취소 | USER | ● | CREATE 또는 UPDATE | instructor_assignment, class_schedule / ● | ○(변경 시 ●) | ● | 변경·취소 시 ● |
| 12 | 교육일정 등록·수정·휴강 | USER | ● | CREATE 또는 UPDATE | class_schedule / ● | ○ | ● | 휴강 시 ● |
| 13 | 출결 생성(입실 확인·결석 확정) | USER | ● | CREATE | attendance / ● | — | ● | — |
| 13-1 | 출결 생성(공식 데이터 반영) | SYSTEM_BATCH 또는 SYSTEM_API(#1) | — | CREATE | attendance / ● | — | ● | ● 배치·연동 식별자 |
| 14 | 퇴실 최초 기록 | USER | ● | UPDATE | attendance / ● | ● | ● | — |
| 15 | 출결 수정 | USER | ● | UPDATE | attendance / ● | ● | ● | ● 필수 (attendance_change_log 동시 생성) |
| 16 | 출결 상태 변경 | 15와 동일(출결 상태는 S09 수정으로만 변경) | | | | | | |
| 16-1 | 공식 대사에 의한 출결 갱신 | SYSTEM_BATCH | — | UPDATE | attendance / ● | ● | ● | ● "공식 출결 대사 반영" (attendance_change_log actor_type=SYSTEM_BATCH 동시 생성) |
| 17 | 운영일지 작성·수정 | USER | ● | CREATE / UPDATE | operation_log / ● | 수정 시 ● | ● | — |
| 18 | 특이사항 등록·수정·조치완료 | USER | ● | CREATE / UPDATE | course_issue / ● | 수정 시 ● | ● | — |
| 19 | 결과물 등록·재등록 | USER | ● | CREATE / UPDATE | submission / ● | 재등록 시 ● | ● | — |
| 20 | 결과물 검토 | USER | ● | CREATE | submission_review_log / ● (동시에 submission UPDATE) | ○ | ● | — |
| 21 | 확인 건 생성(자동 탐지) | SYSTEM_RULE | — | CREATE | verification_case / ● | — | ● | ● 규칙 코드(예: RULE_04) |
| 21-1 | 확인 건 생성(수동 전환) | USER | ● | CREATE | verification_case / ● | — | ● | ○ |
| 22 | 확인 건 근거 추가·훈련생 추가 | SYSTEM_RULE | — | UPDATE / CREATE | verification_case, verification_case_trainee / ● | ● | ● | ● 규칙 코드 |
| 23 | 확인 건 배정 | USER | ● | UPDATE | verification_case / ● | ● | ● | — |
| 24 | 확인 건 상태 변경(확인 시작·확인완료·조치필요·조치완료·재오픈) | USER | ● | UPDATE | verification_case / ● | ● | ● | 재오픈 시 ● (action_log 동시 생성) |
| 25 | 조치 등록 | USER | ● | UPDATE | verification_case / ● | ● | ● | — (action_note는 after에 포함) |
| 26 | 과정 종료 | USER | ● | UPDATE | course / ● | ● | ● 미해결 항목 스냅샷 포함 | 경고 항목 강행 시 ● |
| 27 | 과정 중단 | USER | ● | UPDATE | course / ● | ● | ● | ● |
| 28 | 사용자 생성·수정·비활성화 | USER | ● | CREATE / UPDATE | user_account, user_role / ● | 수정 시 ● | ● (password_hash 제외) | — |
| 29 | 비밀번호 초기화 | USER | ● | UPDATE | user_account / ● | — | — (값 미기록) | — |
| 30 | 권한 변경 | USER | ● | UPDATE | role_permission / ● | ● | ● | — |
| 31 | 시스템 자동 탐지(규칙 평가) | SYSTEM_RULE | — | 결과 이벤트(21·22)만 기록. 평가 실행 자체·미매칭 결과는 audit_log가 아닌 운영 로그로 관리 | | | | |
| 32 | 배치 처리(과정 자동 전환, 공식 대사) | SYSTEM_BATCH | — | 상태를 바꾼 건별로만 기록(10·13-1·16-1) | | | | |
| 33 | 파일 업로드 | USER | ● | CREATE | attachment / ● | — | ● | — |
| 34 | 파일 다운로드 | USER | ● | VIEW_SENSITIVE | attachment / ● | — | — | — |
| 35 | 감사로그 조회 | USER | ● | VIEW_SENSITIVE | audit_log / ○ | — | — (조회 조건은 reason에) | — |

- 담당자 배정 변경과 개인정보 수정 등 change_log·action_log가 있는 이벤트도 audit_log는 별도로 남긴다(목적이 다르므로 통합하지 않음).
- 감사로그 보호: audit_log·change_log·action_log 테이블은 append-only이며 앱 DB 계정에 UPDATE·DELETE 권한을 부여하지 않는다. 열람은 S27만 통하고 열람 자체도 기록된다. 보존기간은 `[결정 필요]` #8.

---

## 8. 삭제 정책

**전체 원칙**: 애플리케이션은 어떤 업무 테이블에서도 hard delete를 수행하지 않는다(삭제 화면·API 없음). 잘못 입력한 데이터는 상태 변경·취소·비활성·정정(이력 보존)으로 처리하고, 모든 처리는 사유와 함께 이력·감사로그에 남는다. 물리 삭제는 법정 파기 시점의 별도 운영 절차(#8, #28)로만 가능하며 이 시스템의 기능 범위가 아니다.

| 테이블 | hard delete | 대체 처리 | 근거·비고 |
|---|---|---|---|
| attendance | 금지 | 정정(S09, 사유 필수, 이력 보존). "미출결로 되돌리기" 없음 — 오기록은 결석 등으로 정정 | 수료·훈련비 판단 근거. 삭제하면 변경이력의 attendance_id가 끊김 |
| attendance_change_log | 금지 | 없음(불변) | 출결 수정 이력의 증거 |
| verification_case | 금지 | 오탐·불필요 건도 확인완료로 종결하고 확인내용에 사유 기록. 재검토는 추가확인으로 재오픈 | 발견→확인→조치의 기록 자체가 통제 증거 |
| verification_case_trainee | 금지 | 연루 훈련생 추가만 가능. 잘못 연결된 경우 확인내용·근거에 정정 사유 기록 | 사건과 대상자의 연결 이력 보존 |
| verification_action_log | 금지 | 없음(불변) | 처리 이력 |
| operation_log | 금지 | 수정(같은 행 UPDATE, audit before/after). 작성자·OPS_MANAGER만 수정 | 회차 운영 증적. 수정 허용 기간은 `[결정 필요]` #25에서 함께 정의 |
| submission (결과물) | 금지 | 재등록(version 증가, 이전 파일은 attachment에 버전별 보존) | 검토 이력과 연결됨 |
| submission_review_log | 금지 | 재검토는 새 행 append | |
| attachment | 금지 | 교체·정정은 새 행 추가(entity_version), 이전 파일 보존 | 파일 삭제·파기는 #28 |
| audit_log | 금지·수정 금지 | 없음 | DB 권한으로도 차단 |
| course / course_issue | 금지 | 과정=SUSPENDED, 특이사항=RESOLVED | |
| trainee / trainee_enrollment | 금지 | 등록 건=CANCELLED, 인적정보 수정은 change_log | 개인정보 파기 요청 처리는 #8 |
| instructor / instructor_assignment / class_schedule | 금지 | INACTIVE / CANCELLED / CANCELLED(휴강) | |
| user_account | 금지 | INACTIVE(로그인 차단, 과거 감사 기록의 행위자 참조 유지) | |
| detection_rule | 금지 | is_active=false | |
| role, user_role, role_permission | role 금지 | user_role·role_permission은 설정 데이터라 교체(삭제 후 재삽입) 허용하되 before/after를 audit_log에 남김 | 유일한 예외 |
| attendance_source_raw | 금지 | processed 플래그 | 공식 원본 보존 |

---

## 9. 과정 종료 조건

종료 처리(`POST /courses/{id}/close`)는 서버가 아래 조건을 **모두 검사**한 뒤 결과를 항목별로 반환한다. 분류: **필수 차단**=하나라도 있으면 종료 불가(강행 불가), **경고 후 진행**=사유(override_reason) 입력 후 종료 가능, **확인 불필요**=검사하지 않음. **분류·종료 승인 구조(OPS_MANAGER 단독, EXECUTIVE 승인 없음)는 decisions.md D-06으로 2026-09-22 확정되었다(`[결정 필요]` #17·#30 해소).** 단, API 구현 자체는 미출결·확인 건·운영일지·결과물 판정에 필요한 Phase 2~4 테이블이 생긴 뒤 진행한다(decisions.md P1-03, 결정 A-1). 종료는 항상 수동이며 종료일이 지나도 자동 종료하지 않는다. 종료 시점의 미해결 항목 스냅샷과 강행 사유는 audit_log에 남긴다(7절 #26).

| # | 조건 | 판정 데이터 | 분류(기본값) | 이유 |
|---|---|---|---|---|
| 1 | 미출결 대상자 | 종료된 회차(휴강 제외) × enrollment=CONFIRMED 중 attendance 행이 없는 조합(계산) | **필수 차단** | 출결 기록이 비어 있으면 수료·결석 판정 자체가 불가능. 입실 확인 또는 결석 확정 클릭으로 해소 가능하므로 차단 부담이 작음 |
| 2 | 퇴실 미확인 출결 | attendance_status IN (PRESENT, LATE) 이면서 check_out_time NULL | 경고 후 진행 | 퇴실 시각을 사후에 확인할 수 없는 경우가 있음. 확인 필요(RULE_04)로 이미 별도 관리 |
| 3 | 미종결 확인 필요 건 | verification_case(해당 과정) status IN (NEEDS_CHECK, PRIORITY_CHECK, IN_REVIEW, FOLLOW_UP, ACTION_REQUIRED) | **필수 차단** | 발견된 이상 사항의 확인·조치를 남기지 않은 채 과정을 닫으면 내부통제 목적에 반한다. 오탐이면 확인완료로 종결하면 됨 |
| 4 | 운영일지 누락 | 종료된 회차(휴강 제외) 중 operation_log 행 없음(계산) | 경고 후 진행 | 미작성 사유를 남기게 하되 종료 자체를 막지는 않음(RULE_03이 이미 확인 건으로 관리) |
| 5 | 결과물 미제출 | enrollment=CONFIRMED 중 submission 행 없음(계산) | 경고 후 진행 | 훈련생 미제출은 정상 사유일 수 있음. 제출 단위·기한은 #5·#24 확정 전 |
| 6 | 결과물 미검토·보완 미해결 | submission.review_status IN (PENDING, REVISION_REQUESTED) | 경고 후 진행 | 완료율 정의: review_status가 PENDING이 아닌 건의 비율(제출과 검토가 모두 끝난 건) |
| 7 | 확정 상태로 남은 등록 건 | enrollment=CONFIRMED 잔여 | 경고 후 진행 | 수료·중도포기·제적 전이는 마련되었으나(D-05·P1-04) 자동 판정 기준이 없어 담당자가 매 건 처리해야 하므로 종료를 막지 않는다(D-06 확정, 분류 재검토 없음) |
| 8 | 필수 과정 데이터 | 확정 훈련생 0명, 교육일정 0건 | 경고 후 진행 | 소규모·특수 과정 가능성(STEP 4.1과 동일 정책). 과정 기본정보 필드는 NOT NULL이라 누락 불가 |
| 9 | 변경이력 존재 여부 | — | 확인 불필요 | 변경이력은 원본 변경과 같은 트랜잭션에서 자동 생성되므로 종료 시점에 별도로 검사할 대상이 아님 |

종료 후 상태: CLOSED 과정의 데이터는 원칙적으로 수정하지 않으며(V7), 사후 정정이 필요할 때의 경로와 승인은 `[결정 필요]` #25.

---

## 10. 개인정보 및 보안 기준

### 10-1. 저장 범위 (MVP 최소화)

| 항목 | 저장 기준 | 금지·제한 |
|---|---|---|
| 훈련생 개인정보 | 성명(필수), 생년월일(선택, 동일인 판정용), 연락처(선택). 주민등록번호·주소·계좌·건강정보는 수집하지 않는다 | 필드 추가는 별도 승인. 연락처는 암호화 저장, 목록·이력에서는 마스킹 표시 |
| 위치정보 | `attendance.related_info`에는 출결 이벤트 시점의 **구역 코드(zone_code)** 정도만 허용한다 | **정밀 GPS 좌표(위도·경도)를 기본 기능으로 저장하지 않는다.** 위치 상시 수집·이동 경로 추적 금지. 좌표가 꼭 필요하다는 결정이 나면 구역 단위로 변환한 값만 저장 |
| 기기정보 | 교육장에 설치된 출결 단말의 `device_id`(설치 자산 식별자)만 저장 | 개인 휴대폰의 IMEI·MAC·광고 ID 등 개인 식별 가능한 기기 고유값 수집 금지. 개인 단말을 쓰게 되면 해시된 임의 식별자만(#2 확정 시 재검토) |
| 접속정보 | `audit_log.ip_address`(로그인·감사 대상 이벤트) | User-Agent·화면 위치 등 추가 수집 금지. 보존은 감사로그와 동일(#8), 열람은 S27(SYS_ADMIN·EXEC)만 |
| 파일 | 운영일지·특이사항·결과물 첨부만 저장(`attachment`) | 저장소는 웹에 직접 노출되지 않는 비공개 위치. 형식·용량 제한과 악성 파일 검사는 #12 확정 시 적용 |
| 개인정보 수정이력 | `trainee_change_log`·`audit_log`의 before/after에서 연락처·생년월일은 **마스킹한 값**으로 저장(예: 010-****-1234). 변경 사실·변경자·시각·사유는 원문 유지 | 원문 값을 로그에 남기지 않는다 |
| 비밀번호·토큰 | 비밀번호는 단방향 해시(강한 KDF)만 저장 | 어떤 로그·응답에도 노출·기록 금지 |

### 10-2. 개발 요구사항 (모두 필수)

1. **서버/API 권한 검증**: 4-3의 V1~V10을 모든 엔드포인트에 적용한다. 화면에서 버튼·메뉴를 숨기는 것은 통제로 인정하지 않는다.
2. **개인정보 접근 통제**: 연락처 원문은 수정 화면(S04, OPS_MANAGER)에서만 노출하고 그 조회는 VIEW_SENSITIVE로 기록한다. 목록·상세·엑셀 내보내기는 마스킹 값을 사용한다. INSTRUCTOR는 본인 배정 과정의 훈련생만 볼 수 있다.
3. **감사로그 보호**: append-only, 앱 DB 계정에 UPDATE·DELETE 권한 부여 금지, 열람은 S27만, 열람도 기록, 저장 실패 시 원본 변경 롤백.
4. **파일 접근 권한**: 파일은 인증된 다운로드 API로만 제공한다. 부모 엔티티의 스코프를 검증하고, 서버 저장 경로를 응답·URL에 노출하지 않으며, 다운로드는 VIEW_SENSITIVE로 기록한다. 서명 URL을 쓰게 되면 짧은 유효시간과 1회성을 조건으로 한다.
5. **세션·인증 관리**: 서버 측 세션, 세션 고정 방지, 로그아웃 시 무효화, 유휴 만료, 로그인 실패 제한과 LOGIN_FAILED 기록. 세션 시간·비밀번호 정책·잠금 횟수 값은 `[결정 필요]` #29. 초기·초기화 비밀번호는 최초 로그인 시 변경을 강제한다.
6. **중요 데이터 변경 추적**: 출결·훈련생·강사·배정의 수정은 전용 change_log(사유 필수) + audit_log, 확인 건 처리는 action_log + audit_log, 나머지 CUD는 audit_log before/after. 변경 이력의 생성은 원본 변경과 같은 트랜잭션이다.
7. **전송·저장 보호**: 전 구간 TLS, 연락처 암호화 저장, 백업에도 동일 보호 적용.
8. **입력 검증**: 다형성 참조(attachment.entity_type, change_log.entity_type)의 허용 목록·대상 존재 여부를 서버에서 검증(DB FK로 막을 수 없음). 업로드 파일은 확장자·MIME·크기 검사.

---

## 11. 최종 변경 목록 (개발 기준선에 반영된 변경사항)

"관련 문서" 열은 이미 수정을 반영한 위치다. 개발 영향: 스키마=마이그레이션 필요, 로직=서버 규칙, 화면=UI 명세, 정책=운영 결정 대기.

| ID | 변경사항 | 관련 문서 | 관련 DB | 관련 화면 | 개발 영향 |
|---|---|---|---|---|---|
| C1 | attendance는 이벤트 발생 시에만 생성, 미출결은 계산값, "확인중" 삭제, 결석 확정 액션 | STEP 1.3·4.2·5.3·7-A(S07~S09)·8·9 | attendance | S01·S07·S08·S16 | 스키마, 로직(LEFT JOIN 조회), 화면 |
| C2 | 결과물 제출 주체: 담당자 등록으로 확정(D-01) | STEP 4.5·7-A(S19~S21) | submission(변경 없음) | S19·S20·S21 | 로직, 화면 |
| C3 | verification_case_trainee 신설, trainee_id·related_attendance_id 제거 | STEP 5.3·7·8.1-B | verification_case, verification_case_trainee | S01·S05·S22·S23 | 스키마, 로직 |
| C4 | audit_log actor_type + actor_user_id(nullable) | STEP 5.3·9 | audit_log | S27 | 스키마, 로직(미들웨어 태깅) |
| C5 | RULE_03 = 회차 운영기록 지연 (신규 테이블 없음) | STEP 1.4·5.1·8.1·8.1-A | detection_rule.params | S22·S23 | 로직 |
| H1 | STEP 2.2에 과정 행 추가 | STEP 2.2 | — | S15·S16 | 권한 |
| H2 | STEP 4.1: 등록은 S04에서만 | STEP 4.1 | — | S02·S04 | 문서 |
| H3 | STEP 4.1: 강사 배정 저장은 S13 | STEP 4.1 | — | S11·S13 | 문서 |
| H4 | 결과물 검토는 운영담당자만 | STEP 4.5·7-A(S21) | — | S21 | 권한 |
| H5 | RULE_01·02는 related_info 있는 출결에만 적용 | STEP 8.1 | attendance.related_info | S07 | 로직 |
| H6 | 특이사항 전환 시 자동 확인중, 이후 독립 관리 | STEP 7-A(S18) | course_issue | S18·S23 | 로직 |
| H7 | 서버/API 권한 재검증 원칙 명시 | STEP 2.6, baseline 4-3·10 | — | 전체 | 로직(필수) |
| M1 | evidence를 items 배열 append 구조로 확정 | STEP 8.4 | verification_case.evidence | S23 | 로직 |
| M2 | 종결 권한 서술 통일(단독 종결, 2단계는 #13) | STEP 7.3 | — | S23 | 문서 |
| M3 | 종료 차단·경고 정책 → 9절 기본 분류 + #17 | STEP 4.6·12 | — | S16 | 정책 |
| M4 | 등록과 과정 배정은 S04 한 액션임을 명시 | STEP 7-A(S04) | — | S04 | 문서 |
| M5 | 이미 등록된 과정 재등록 시 안내 | STEP 7-A(S04) | trainee_enrollment | S04 | 로직 |
| M6 | 조퇴 판정 자동/수동 → #22 | STEP 12 | — | S07·S09 | 정책 |
| M7 | 결과물 완료율 정의(review_status≠PENDING) | baseline 9절 | submission | S16 | 로직 |
| M8 | S23 버튼에 재오픈 추가 | STEP 7.3 | — | S23 | 화면 |
| M9 | 중도 등록 허용 여부 → #21 | STEP 7-A(S04)·12 | — | S04 | 정책 |
| L1 | 위치정보 최소화(GPS 금지, 구역 코드만) | baseline 10 | attendance.related_info | S07 | 로직 |
| L2 | attendance_source_raw 실패 처리는 연동 확정 시 | STEP 5.3 #24·12 | attendance_source_raw | — | 보류 |
| N1 | 결석 확정 마감 원칙 → #27 | STEP 12 | — | S07 | 정책 |
| N2 | verification_case_trainee는 대표 attendance 1건, 나머지는 evidence | STEP 5.3 #25 | verification_case_trainee | S23 | 로직 |
| N3 | 목록 조인 성능은 데이터량 확인 후 | — | — | S01·S22 | 튜닝 |
| N4 | 결과물 전달 경로 미기록(요구 시 검토) | — | — | S19 | 보류 |
| B1 | class_schedule.status에서 진행완료 제거(계산값) | STEP 5.3 #8·7-A(S13) | class_schedule | S13 | 스키마 |
| B2 | submit_status에서 미제출 제거(계산값) | STEP 5.3 #13·7-A(S19) | submission | S19·S20 | 스키마 |
| B3 | S20 독려 메모 저장 제거(행이 없어 저장 불가) | STEP 7-A(S20) | — | S20 | 화면 |
| B4 | audit_log.action에 LOGIN·LOGOUT·LOGIN_FAILED·ACCESS_DENIED, target_id nullable | STEP 5.3 #19 | audit_log | S27 | 스키마 |
| B5 | SYS_ADMIN 업무 데이터는 조회 전용(STEP 2.2 ↔ 7-A 충돌 해소) | STEP 2.2 | role_permission | 전체 | 권한 |
| B6 | S22 "우선순위"는 status 계산값 | STEP 7 | — | S22 | 화면 |
| B7 | operation_log UNIQUE(schedule_id) | STEP 5.3 #11 | operation_log | S17 | 스키마 |
| B8 | submission UNIQUE(trainee_id, course_id, title) | STEP 5.3 #13 | submission | S19 | 스키마 |
| B9 | attachment.entity_version | STEP 5.3 #18 | attachment | S19·S21 | 스키마 |
| B10 | verification_action_log.action_type 사용 규칙 확정 | STEP 5.3 #16 | verification_action_log | S23·S24 | 로직 |
| B11 | 변경이력 대상: 훈련생·강사·출결만, 나머지는 audit_log(STEP 1.5 표현 정정) | STEP 1.5 | — | — | 문서 |
| B12 | STEP 2.4의 잘못된 결정사항 참조(#7 → #18) 정정 | STEP 2.4 | — | — | 문서 |
| B13 | STEP 1.4·5.1 등의 "현장정보 미확인" 잔존 표현 제거 | STEP 1.4·5.1 | — | — | 문서 |
| B14 | attendance_change_log에 actor_type 추가, changed_by nullable, 규칙 05·06은 USER 행만 집계 | STEP 5.3 #10·8.1 | attendance_change_log | S10 | 스키마, 로직 |
| B15 | verification_case 근거 검증을 evidence.items ≥ 1로 수정(RULE_03 통과 불가 결함) | STEP 5.3 #15 | verification_case | S23 | 로직 |
| B16 | submission.submitted_at NOT NULL | STEP 5.3 #13 | submission | S19 | 스키마 |
| B17 | 상태값 영문 코드·한글 표시명 분리 표준 | baseline 3 | 전 enum | 전체 | 표준 |
| B18 | 규칙별 중복 판정 키(dedupe_key) 정의 | STEP 8.1-C | verification_case.evidence | S22 | 로직 |
| B19 | 수료·중도포기·제적 전이 화면·기준이 없음(명세 갭) | STEP 12 #23 | trainee_enrollment | — | 정책 |
| B20 | 결과물 제출기한 저장 위치 없음(명세 갭) | STEP 12 #24 | — | S20 | 정책 |
| B21 | 결석 확정 권한 기본값 OPS_MANAGER 전용 | STEP 7-A(S07) | — | S07 | 정책(#20) |
| B22 | ERD v3 → v5 (옵션 테이블·enum·제약 주석) | ERD | 다수 | — | 문서 |

---

## 12. 개발자가 절대 임의로 결정하면 안 되는 항목

번호는 `system-design.md` STEP 12와 동일하다. 결정 전에 해당 기능을 구현하지 말고, 잠정값이 있으면 그것을 설정값(코드 상수 아님)으로 두어야 한다.

| # | 항목 | 왜 결정이 필요한가 |
|---|---|---|
| ~~15~~ | ~~결과물 제출 주체~~ **확정(D-01): 운영담당자 등록** | 훈련생 직접 제출로 정책이 바뀔 때만 재검토(역할·계정·화면·API·권한 동시 변경). TRAINEE 계정·역할은 만들지 않는다 |
| 20 | 결석 확정 권한(강사 허용 여부) | 결석은 수료·훈련비와 직결되는 판단성 기록이라 주체를 정하는 것은 운영 책임 문제 |
| 27 | 결석 확정 마감 시각 | 시스템이 자동 결석 처리하지 않으므로 마감 규칙이 없으면 미출결이 무기한 쌓임 |
| 22 | 지각·조퇴 판정 기준 | attendance_status가 생성 시점에 확정되므로 자동 판정 여부와 유예시간을 정해야 함 |
| 25 | 출결 수정 허용 범위·기간, 종료 후 정정 절차 | 내부통제에서 가장 민감한 수정이라 허용 기간과 승인 필요 여부는 운영 정책 |
| 17·30 | 과정 종료 차단·경고 정책과 종료·강행 승인 권한 | 9절 기본 분류는 잠정. 어떤 미해결 항목이 종료를 막는지, 누가 강행할 수 있는지는 기관 책임 체계 |
| 13 | 확인 건 종결의 2단계 승인 여부 | 현재는 OPS_MANAGER·EXECUTIVE 단독 종결. 승인 구조는 워크플로우·권한 구조가 바뀜 |
| 26 | 확인 건 조치 기준·우선 확인으로 시작할 규칙 | 조치 기준과 initial_status 시드는 판단 기준이므로 기관이 정해야 하며, 시스템이 판정하지 않는다는 원칙과 직결 |
| ~~18~~ | ~~운영담당자 과정 접근 범위~~ **확정(D-02): 전체 과정** | 담당 과정 제한 등으로 바뀔 때만 재검토(모든 조회·수정 API 스코프 동시 변경) |
| 19 | 시스템 관리자의 업무 데이터 예외 수정 권한 | 조회 전용으로 통일했으나 장애 대응 관행에 따라 달라질 수 있음 |
| 21 | 운영중 과정의 중도 등록 허용 | 등록 API의 과정 상태 검증 규칙 |
| 23 | 수료·중도포기·제적 기준과 처리 화면 | 현재 명세에 전이 화면이 없어 수료 판정이 불가능 |
| 24·5 | 결과물 제출기한 위치·제출 단위 | 기한후제출 판정, 미제출 경과일수, UNIQUE 키(title) 확정에 필요 |
| 1 | 공식 출결 연동 방식 | attendance_source_raw 필요 여부, actor_type(SYSTEM_API/BATCH), RULE_07 가동 여부 |
| 2 | 출결 확인 환경(기기·채널 식별자) | RULE_01·02의 related_info 스키마, 개인정보 최소화 기준 |
| 16 | 훈련생 개별 중간 현장확인 이벤트 도입 | 도입 시 별도 규칙·이벤트 테이블 설계가 필요, 미도입이면 RULE_03 현행 유지 |
| 8 | 감사로그·변경이력 보존기간 | 법정 기간·파기 절차가 저장·아카이빙 설계와 DB 권한을 결정 |
| 28 | 첨부·결과물 파일 보존기간 | 파일 저장소 수명주기와 파기 절차 |
| 29 | 세션·비밀번호 정책값 | 인증 구현 파라미터이며 보안 정책 소관 |
| 7 | 역할 확장(커스텀 역할) 요구 | 권한 매트릭스 구조(고정 4역할 vs 가변)가 달라짐 |
| 12 | 첨부파일 저장 인프라·업로드 제한 | 저장소 종류·보안·용량 제한 |
| 14 | 알림 채널 | 알림이 생기면 SYSTEM 행위 기록 대상이 추가됨 |
| ~~3~~ | ~~다지점 여부~~ **확정(D-03): 단일 기관** | 다지점·다기관으로 범위가 바뀔 때만 재검토(전 테이블·권한·API 동시 변경) |
| 4, 6, 9, 10, 11 | 모집 절차, 강사 소속, 처리 기한(SLA), 모바일, 외부 연계 | STEP 12 원문 유지. 각각 상태 모델·계약정보·에스컬레이션·반응형·연계 범위를 좌우 |

---

## 13. 최종 산출물

### A. 개발 기준선 확정 요약 (핵심 원칙)

1. **출결은 이벤트가 있을 때만 저장한다.** attendance 행은 입실 확인, 결석 확정, 공식 데이터 반영으로만 생기며 미출결은 계산값이다.
2. **같은 원칙을 일반화한다.** "완료 전 상태"는 저장하지 않고 계산한다: 미출결, 미제출, 운영일지 미작성, 회차 진행완료.
3. **최초 기록과 정정을 분리한다.** 값이 비어 있을 때의 기록은 명령 하나, 이미 있는 값의 변경은 사유 필수의 정정 명령(이력 보존)뿐이다.
4. **hard delete는 없다.** 취소·비활성·종결·정정으로만 처리하고 이력·로그는 append-only다.
5. **자동 탐지는 "확인 필요" 건 생성까지만 한다.** 업무 데이터를 바꾸지 않고, 부정 판정 표현을 쓰지 않으며, 상태는 7개 중립 상태만 쓴다.
6. **확인 건은 훈련생에 종속되지 않는다.** 관련 훈련생 0~N명은 verification_case_trainee, 근거는 evidence.items에 append-only.
7. **행위자는 항상 남는다.** 사람은 actor_user_id, 시스템은 actor_type(SYSTEM_RULE/BATCH/API)으로 audit_log에 기록한다.
8. **변경이력과 감사로그는 분리 유지한다.** 이력은 "왜 바뀌었나"(사유), 감사로그는 "누가·무엇이 했나". 이력 대상은 훈련생·강사·출결로 한정하고 나머지는 audit_log before/after.
9. **권한은 서버가 결정한다.** 모든 API가 역할·스코프·현재 상태를 검증하며 UI 숨김은 통제가 아니다.
10. **강사는 본인 배정 범위만.** 회차=schedule.instructor_id 본인, 과정=유효한 배정. 목록 쿼리에 스코프를 포함하고 위반은 ACCESS_DENIED로 기록한다.
11. **시스템 관리자는 업무 데이터 조회 전용**, 쓰기는 사용자·권한 관리뿐(예외는 #19).
12. **RULE_03은 회차 운영기록 지연이다.** 훈련생 개별 현장 확인을 판단하지 않는다. RULE_04는 출석·지각 행만 대상이다.
13. **업무 액션은 명령 API로 분리한다.** 확정·결석 확정·출결 수정·휴강·재배정·종료·확인 시작·확인완료·조치·재오픈은 PATCH가 아니라 개별 명령이다.
14. **결과물은 운영담당자가 등록한다(확정 D-01).** TRAINEE 계정·역할을 만들지 않는다. 훈련생 직접 제출로 정책이 바뀌면 재검토하며, submission 스키마는 두 안 모두에 유효하다.
14-1. **단일 기관(확정 D-03)·운영담당자 전체 과정 접근(확정 D-02).** 멀티테넌시·조직 계층·담당 과정 제한은 두지 않는다. 범위·정책이 바뀌면 해당 결정을 재검토하고 설계·DB·API·권한을 함께 변경한다.
15. **과정 종료는 항목별 분류를 따른다.** 미출결·미종결 확인 건은 필수 차단, 나머지는 경고 후 사유 입력, 변경이력은 검사하지 않는다.
16. **개인정보는 최소 수집·마스킹 저장한다.** 정밀 GPS 미저장, 연락처 암호화·마스킹, 로그에는 마스킹 값만.
17. **상태값은 DB 코드(영문)와 UI 표시명(한글)을 분리한다.** 죽은 enum 값은 두지 않는다.
18. **다형성 참조는 앱에서 검증한다.** attachment·change_log의 entity_type·entity_id는 DB FK가 없으므로 허용 목록과 존재 여부를 서버가 확인한다.
19. **결정 전 기능은 구현하지 않는다.** 12절 목록(특히 #20, #23, #24)은 결정 후에 착수한다(#3·#15·#18은 확정됨).

### B. 최종 DB 테이블 목록 (25개)

| # | 테이블 | 핵심 역할 | 주요 FK |
|---|---|---|---|
| 1 | course | 과정 | manager_user_id → user_account |
| 2 | trainee | 훈련생 인적정보(상태 없음) | — |
| 3 | trainee_enrollment | 훈련생×과정 등록·상태 | trainee, course, confirmed_by |
| 4 | trainee_change_log | 훈련생·등록 수정 이력(다형성) | changed_by |
| 5 | instructor | 강사 | — |
| 6 | instructor_assignment | 강사×과정(×회차) 배정 | instructor, course |
| 7 | instructor_change_log | 강사·배정 수정 이력(다형성) | changed_by |
| 8 | class_schedule | 회차 일정(예정/휴강) | course, instructor |
| 9 | attendance | 실제 출결 이벤트 기록 | trainee, schedule |
| 10 | attendance_change_log | 출결 정정 이력(사람·시스템) | attendance, trainee, changed_by(nullable) |
| 11 | operation_log | 회차 운영일지(회차당 1건) | schedule, instructor, author |
| 12 | course_issue | 특이사항 | course, schedule(nullable), reported_by |
| 13 | submission | 결과물(등록 시에만 존재) | trainee, course |
| 14 | submission_review_log | 결과물 검토 이력 | submission, reviewer |
| 15 | verification_case | 확인 필요 건 | course, operation_log/course_issue(nullable), detection_rule, assignee |
| 16 | verification_action_log | 담당자 확인·조치 이력 | case, actor |
| 17 | detection_rule | 규칙 마스터·임계치·MANUAL | — |
| 18 | attachment | 첨부(다형성, 버전 구분) | uploaded_by |
| 19 | audit_log | 전역 감사(사람·시스템) | actor_user_id(nullable) |
| 20 | user_account | 사용자 계정 | linked_instructor_id |
| 21 | role | 역할 마스터 | — |
| 22 | user_role | 사용자×역할 | user, role |
| 23 | role_permission | 역할×화면×기능 권한 | role |
| 24 | attendance_source_raw(옵션) | 공식 출결 원본 스테이징 | — |
| 25 | verification_case_trainee | 확인 건×훈련생(×대표 출결) | case, trainee, attendance(nullable) |

### C. 최종 API 목록 (화면별)

5-1·5-2의 표가 원본이며 화면별 요약은 다음과 같다(공통 5개 + 화면별 78개 = 83개 엔드포인트, S20은 S19의 조회 API를 재사용하므로 고유 82개. 화면 없는 내부 처리 4종은 별도).

| 화면 | API |
|---|---|
| 공통 | POST /auth/login, POST /auth/logout, GET /auth/me, POST /attachments, GET /attachments/{id}/download |
| S01 | GET /dashboard |
| S02 | GET /enrollments, POST /enrollments/{id}/start-review, /confirm, /reject |
| S03 | GET /trainees |
| S04 | GET /trainees/search, POST /enrollments, POST /enrollments/import, PATCH /trainees/{id} |
| S05 | GET /trainees/{id}, /trainees/{id}/enrollments, /attendance-summary, /submissions, /verification-cases |
| S06 | GET /trainee-change-logs |
| S07 | GET /schedules/{id}/attendance-roster, POST /schedules/{id}/attendance/check-in, POST /attendance/check-out, POST /schedules/{id}/attendance/confirm-absence |
| S08 | GET /courses/{id}/attendance-matrix |
| S09 | GET /attendance/{id}, POST /attendance/{id}/correct |
| S10 | GET /attendance-change-logs |
| S11·S12 | GET /instructors, GET /instructors/{id}, POST /instructors, PATCH /instructors/{id} |
| S13 | GET /schedules, POST /courses/{id}/schedules, PATCH /schedules/{id}, POST /schedules/{id}/cancel-class, POST /schedules/{id}/reassign-instructor, POST /courses/{id}/instructor-assignments, POST /instructor-assignments/{id}/cancel |
| S14 | GET /instructor-change-logs |
| S15·S16 | GET /courses, GET /courses/{id}, POST /courses, PATCH /courses/{id}, POST /courses/{id}/open-recruitment, /start, /suspend, /close, GET /courses/{id}/closure-checklist |
| S17 | GET /courses/{id}/operation-logs, GET/POST /schedules/{id}/operation-log, PATCH /operation-logs/{id} |
| S18 | GET/POST /course-issues, PATCH /course-issues/{id}, POST /course-issues/{id}/escalate, /resolve |
| S19·S20 | GET /courses/{id}/submission-status, POST /courses/{id}/submissions, POST /submissions/{id}/re-register |
| S21 | GET /submissions/{id}, POST /submissions/{id}/reviews |
| S22 | GET /verification-cases, POST /verification-cases/assign |
| S23 | GET /verification-cases/{id}, POST …/start-review, /complete-confirmation, /require-action, /complete-action, /reopen |
| S24 | GET /verification-action-logs |
| S25 | GET /users, GET /users/{id}, POST /users, PATCH /users/{id}, POST /users/{id}/reset-password |
| S26 | GET /roles/permissions, PUT /roles/{id}/permissions |
| S27 | GET /audit-logs, GET /audit-logs/{id} |
| S28 | GET /detection-rules, PATCH /detection-rules/{id} |
| 내부 처리 | RULE_01·02 이벤트, RULE_03~06 배치, 공식 수집·대사·RULE_07(#1), 과정 자동 전환 |

### D. 최종 권한 매트릭스 (요약)

O=허용, R=조회만, —=불가, ◎=서버 스코프 재검증, △=결정 필요. 상세는 4-2.

| 기능 | SYS_ADMIN | OPS_MANAGER | INSTRUCTOR | EXECUTIVE |
|---|---|---|---|---|
| 업무 데이터 조회(과정·훈련생·강사·일정·출결·결과물) | R | O | R ◎ | R |
| 과정 등록·수정·모집·운영중·중단 | — | O | — | — |
| 과정 종료 | — | O(승인 #30) | — | — |
| 훈련생 등록·수정·확정·반려 | — | O | — | — |
| 수료·중도포기·제적 | — | △(#23) | — | — |
| 강사·배정·일정·휴강·재배정 | — | O | — | — |
| 입실·퇴실 확인 | — | O | O ◎ | — |
| 결석 확정 | — | O | △(#20, 기본 —) | — |
| 출결 수정 | — | O(사유 필수) | — | — |
| 운영일지 작성·수정 | — | 수정 O | O ◎ | — |
| 특이사항 등록 | — | O | O ◎ | — |
| 특이사항 수정·조치완료·확인 필요 전환 | — | O | — | 전환 O |
| 결과물 등록·재등록·검토 | — | O | — | R |
| 확인 건 조회 | R | O | —(대시보드 요약 ◎) | O |
| 확인 건 배정·확인 시작·확인완료·조치·조치완료·재오픈 | — | O | — | O |
| 이력·조치이력 조회 | R | R | — | R |
| 사용자·권한 관리 | O | — | — | — |
| 감사로그 조회 | R | — | — | R |
| hard delete | — | — | — | — |

### E. 개발 전 결정사항 (실제 운영정책 확인 필요)

**착수 전 확정해야 하는 것(해당 기능 개발의 전제)**
- (확정 완료: #3 단일 기관, #15 담당자 등록, #18 전체 과정 접근)
- #23 수료·중도포기·제적 기준·화면 — 과정 종료·enrollment 전이
- #24·#5 제출기한 위치·제출 단위 — 결과물 제출·미제출 계산
- #20·#27 결석 확정 권한과 마감 — 출결 운영 규칙
- #22 지각·조퇴 판정 기준 — 입실 확인 로직
- (확정 완료 2026-09-22: #17·#30·#13 종료·강행·종결 승인 구조 — decisions.md D-06. API 구현 시점은 Phase 2~4, P1-03 참고)

**기능 착수 시점에 확정해도 되는 것**
- #1 공식 출결 연동, #2 출결 환경 — RULE_01·02·07 정식 가동 전
- #26 조치 기준·initial_status 시드 — 탐지 엔진 시드 데이터 작성 전
- #25 출결 수정 허용 범위 — S09 정책 구현 전
- #19·#21 예외 수정·중도 등록 — 해당 API 구현 전
- #8·#28·#29 보존기간·세션 정책 — 감사·인증 구현 전

**나중에 확정해도 되는 것**
- #16 중간 현장확인 도입, #7 커스텀 역할, #12 첨부 인프라, #14 알림, #3·#4·#6·#9·#10·#11

---

## 14. 이 기준선의 준비 상태

- **준비된 부분**: 데이터 모델(25개 테이블 제약·인덱스·삭제 정책), 상태값 사전, 권한 매트릭스와 서버 검증 항목, 27개 화면의 API 요구사항, 규칙 표, 감사 이벤트 정책, 종료 조건 기본 분류, 개인정보·보안 요구사항.
- **남은 위험**: (1) 결과물 제출 주체 미확정, (2) 수료 전이 명세 갭, (3) 제출기한 저장 위치 없음, (4) 공식 출결 연동 미확정으로 RULE_07 가동 불가, (5) 결석 확정 운영 규칙(권한·마감)과 지각 판정 기준이 없어 출결 화면의 운영 정합성이 정책에 의존.
- **바로 개발 가능한 영역**: 인증·권한·감사 프레임워크, 과정·훈련생 등록·확정, 강사·교육일정, 출결 조회(미출결 계산)·입실·퇴실·출결 수정, 운영일지·특이사항, 확인 건 처리 워크플로우, RULE_01~06.
- **정책 확정 후 개발할 영역**: 결과물 등록·검토·미제출, 수료 처리, 결석 확정·지각 판정, 공식 출결 대사·RULE_07, 과정 종료 정책 세부.
