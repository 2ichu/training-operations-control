# Backend (NestJS + PostgreSQL)

## DB 마이그레이션·시드 (Phase 1)

1. `.env.example` 을 `.env` 로 복사해 `DATABASE_URL` 과 `SEED_ADMIN_*` 를 채운다.
2. `npm run db:verify` — DB 없이 SQL 정적 검증(실행하지 않음)
3. `npm run migrate:up` / `npm run migrate:down` — 마이그레이션 적용/되돌리기 (`migrations/*.sql`)
4. `npm run db:seed` — 4개 역할, Phase 1 role_permission, 최초 SYS_ADMIN (멱등)
   - `npm run db:verify:live` — 실제 DB 검증(카탈로그·제약·append-only 트리거·시드 대조, 변경 테스트는 롤백)
5. 운영에서는 `db/roles.example.sql` 을 참고해 소유자 계정과 앱 계정을 분리한다(로그 테이블 UPDATE/DELETE 차단).

**CI**(`.github/workflows/ci.yml`): PR·master push 마다 Postgres 16 서비스로 위 절차 + 린트·빌드·단위·e2e·`db:verify:live`·`db:verify:rbac`·`db:verify:audit-tx`·마이그레이션 down/up 을 실행하고, 프론트엔드는 린트·빌드한다. Node 24(npm 11)를 쓴다 — npm 10 은 선택적 peer 의존성 처리 차이로 현재 lockfile 과 `npm ci` 가 맞지 않는다. e2e 는 깨끗한 DB 를 전제로 하므로 실제 COMMIT 을 남기는 `db:verify:audit-tx` 보다 먼저 돈다.

---

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## 인증 (세션 쿠키)

- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me` — 서버 세션(HttpOnly·SameSite=Lax 쿠키), 로그인마다 새 세션 ID, 유휴·절대 만료, 로그인 실패 제한
- 세션 저장소는 프로세스 메모리(`InMemorySessionStore`, 재시작 시 초기화). `SessionStore` 인터페이스로 교체 가능
- 세션·잠금 값은 정책 미확정(#29)이라 임시 환경변수 기본값 — `.env.example` 참고
- `npm run smoke:auth` — 실제 DB로 인증 흐름 검증(실행할 때마다 append-only 감사로그에 행이 추가됨)

## 권한 (RBAC, 서버 검증)

- 엔드포인트에 `@Authorize('S13', 'C')`(화면 ID × 기능 C/R/U/D/A)를 선언하면 세션 → 권한 순으로 검증한다. 요구 권한이 없는 가드 사용은 거부(fail closed). 권한은 매 요청 `role_permission`에서 읽는다(캐시 없음).
- 거부: 401(비로그인·비활성 계정, 세션 종료) / 403 + `audit_log`(ACCESS_DENIED, 사유 코드 `NO_PERMISSION:S04:C`)
- 핸들러는 `request.access`(userId, roles, instructorId, scope=ALL|OWN_ASSIGNED)로 범위를 확인한다. ID 로 접근하는 요청은 `ScopeService.require*`(범위 밖이면 404 + SCOPE_VIOLATION 기록), 목록은 `ScopeService.*ScopeFilter`를 쿼리 조건에 포함해야 한다(baseline V2·V4).
- 사용하는 모듈은 `RbacModule`을 import 한다.
- `npm run db:verify:rbac` — 실제 DB로 역할×화면×기능 전수·강사 스코프 검증(롤백, 감사로그 미기록)

## 공통 감사 미들웨어 (트랜잭션 일관성)

- 업무 데이터 변경은 `AuditedTransactionService.run(tx => …)` 안에서 `tx.create(table, values)` / `tx.update(table, key, set, { reason })` 로 수행한다. 원본 변경 → 전용 변경이력(`*_change_log`) → `audit_log` 가 **하나의 DB 트랜잭션**이며, 하나라도 실패하면 전체가 ROLLBACK 된다.
- 행위자는 자동 태깅된다: 로그인 요청 → USER(`AuditContextInterceptor`), 배치·탐지 엔진·연동 수신 → `AuditContext.runAsSystem('SYSTEM_BATCH' | 'SYSTEM_RULE' | 'SYSTEM_API', '식별자', fn)`. 컨텍스트가 없으면 변경 자체를 거부한다.
- 감사 대상 테이블은 `src/audit/audit-registry.ts` 의 화이트리스트만 가능. 훈련생·등록·강사·배정 수정은 사유 필수 + 변경이력 자동 기록, 연락처·생년월일은 마스킹, 비밀번호 해시는 로그에서 제거.
- 검증: `npm test`(단위 + 실제 DB 통합, 롤백), `npm run db:verify:audit-tx`(실제 COMMIT 경로를 별도 연결에서 관찰 — 실행 시 append-only 테이블에 행이 영구히 남음)

## 도메인 API (과정·훈련생·강사·일정)

- 모듈: `src/course`, `src/trainee`(대상자 확인·훈련생·등록·변경이력), `src/instructor`(강사·변경이력), `src/schedule`(회차·휴강·강사 배정), `src/role-permission`(S26 권한 매트릭스 조회·저장), `src/audit-log`(S27 감사로그 조회). 경로·권한은 baseline 5-2 를 따르며 모든 라우트에 `@Authorize` 가 있다(`src/common/routes.spec.ts` 가 화면·기능 매핑과 DELETE 부재를 검사).
- S26 권한 저장(`PUT /roles/{id}/permissions`)은 role_permission 전체를 DELETE 후 재삽입하고(baseline 8절 설정 데이터 예외), 개별 행이 아니라 매트릭스 전체를 audit_log 1건(before/after 배열)으로 남긴다. S27 감사로그 조회(`GET /audit-logs`, `GET /audit-logs/{id}`)는 from·to 필수 + 최대 366일 조회 범위(정책이 아닌 기술적 안전장치)이며, 조회 자체가 VIEW_SENSITIVE 로 audit_log 에 다시 기록된다. 목록 조회는 특정 행을 겨냥하지 않으므로 target_id 는 그 조회 결과의 최상단(최신) log_id 를 대표값으로 쓴다(DB의 target_id NOT NULL 제약을 만족시키는 구현상의 처리, 정책적 의미 없음).
- 모든 변경은 `AuditedTransactionService` 안에서 수행하고, ID·목록 조회는 `ScopeService` 를 사용한다. 상태 전이는 행을 잠근 뒤 현재 상태를 검사해 허용되지 않으면 409(`INVALID_STATE_TRANSITION`), 종료·중단 과정의 하위 데이터 변경은 409(`COURSE_LOCKED`).
- 응답은 camelCase, DATE 는 `YYYY-MM-DD` 문자열. 훈련생·강사 연락처와 훈련생 생년월일은 응답에서 마스킹한다(원문 열람은 도입하지 않기로 확정, decisions.md P1-08·P1-09).
- `npm run db:verify:domain` — 실제 DB 로 전체 HTTP 흐름·스코프·권한·감사/변경이력·장애 주입 원자성을 검증한다. 바깥 트랜잭션에서 실행되고 항상 롤백되므로 DB 에 아무것도 남지 않는다(사전 조건: `migrate:up` + `db:seed`).
- 등록·배정의 유일성은 유효한 건 기준 부분 유니크 인덱스다(`uq_trainee_enrollment_active`, `uq_instructor_assignment_active`, migration `20260921000800`). 취소된 건은 이력으로 남고 재신청·재배정은 신규 행으로 만든다(decisions.md P1-01·P1-02).
- 2026-09-22 확정(decisions.md 10절 P1-04~P1-22)으로 구현된 것: 수료·중도포기·제적(`POST /enrollments/{id}/complete`\|`/drop`\|`/expel`, CONFIRMED 상태에서만, 자동 판정 없음, P1-04), 강사 재배정(`POST /schedules/{id}/reassign-instructor`, class_schedule 만 변경, P1-06), 배정 취소 시 남은 예정 회차 경고(`warnings.remainingScheduledCount`, P1-16), 과정 담당자는 OPS_MANAGER 역할 보유자만 지정 가능(P1-18). 같은 확정에서 도입하지 않기로 한 것: 엑셀 일괄 등록(P1-05), 휴강 해제(P1-07), 연락처 원문 열람(P1-08), 자동 운영중 전환 배치(P1-10, 설계만 확정).

## 출결 (S07~S10, Phase 2)

- 모듈: `src/attendance`. `attendance`는 실제 이벤트(입실·퇴실·결석 확정)에서만 INSERT 되고(C1), 미출결(`NOT_CHECKED`)은 저장하지 않는 계산값이다(확정 등록 + 휴강이 아닌 회차 + attendance 없음). `UNIQUE(trainee_id, schedule_id)`로 중복 출결을 막는다.
- 상태 5종(PRESENT/LATE/EARLY_LEAVE/ABSENT/EXCUSED)은 baseline 3-3을 그대로 따른다. D-08 임시값에 따라 지각·조퇴 자동 판정은 비활성(입실은 항상 PRESENT로 생성)이며, 상태 변경은 S09 정정으로만 가능하다.
- `attendance_change_log`는 trainee/instructor_change_log와 스키마가 달라(actor_type 지원, 최초 기록은 대상 아님) 감사 미들웨어의 공용 changeLog 메커니즘을 쓰지 않고 `AttendanceService`가 같은 트랜잭션에서 직접 INSERT한다. S09 정정은 `last_modified_at` 기준 낙관적 잠금(V5)을 쓴다.
- 결석 확정은 별도 액션 문자 `A`로 권한을 분리했다(같은 화면 S07의 입실 확인(`C`)과 D-07 기본값(강사 불허)이 달라 `C` 하나로는 표현할 수 없었음 — 기술적 선택, seed/permissions.ts 주석 참고). V7(과정 상태 검증)은 baseline이 명시한 대로 결석 확정·출결 수정에만 적용하고 입실·퇴실 확인에는 적용하지 않는다.

## 회차별 운영일지·특이사항 (S17·S18, Phase 2)

- 모듈: `src/operation-log`(S17), `src/course-issue`(S18). 둘 다 ERD 그대로 created_at/by·updated_at/by 컬럼이 없다(operation_log는 author_id·written_at, course_issue는 reported_by·reported_at이 생성 정보를 대신). 전용 change_log 없이 audit_log before/after만으로 수정을 추적한다(baseline 7절 #17·#18).
- `operation_log`은 `UNIQUE(schedule_id)`로 회차당 1건, "미작성"은 계산 상태다. `written_at`이 RULE_03(회차 종료 후 운영기록 지연) 판단 근거이며, 규칙 엔진 자체는 이번 범위에 없다.
- `course_issue`의 INSTRUCTOR 조회 스코프는 다른 화면과 다르다 — 배정 과정 기준이 아니라 baseline 4-2가 명시한 "본인 등록 건"(`reported_by`=본인)이다. 등록은 배정 과정 기준(`ScopeService.requireCourse`)을 그대로 쓴다.
- "확인 필요로 전환"(`POST /course-issues/{id}/escalate`, S18:A)은 Phase 3에서 `verification_case`(MANUAL)를 생성하고 `course_issue.status=IN_REVIEW`로 전환한다. 이미 활성 건이 연결돼 있으면 409(자동 규칙과 달리 사람의 명시적 액션이므로 조용히 병합하지 않는다). 아래 "확인 필요·조치" 절 참고.

## 자동 수료 후보 (D-05 §6, 2026-09-28 확정)

- `GET /courses/{id}/completion-candidates` (S02:R, 기존 화면 재사용 — 시드 변경 없음). 과정의 마지막 회차(휴강 제외)가 끝난 뒤부터 `ready:true`가 되며, 가중 출석률 `(PRESENT + LATE×0.5 + EXCUSED) / 적용 가능 회차`가 80% 미달인 CONFIRMED 훈련생만 후보로 반환한다.
- 자동화는 후보 표시까지이고, 최종 확정은 항상 기존 `POST /enrollments/{id}/complete`\|`/drop`\|`/expel`로 사람이 실행한다(verification_case 없이 구현, "시스템이 판단하지 않고 사람이 결정" 원칙 유지). DB 스키마 변경 없음 — 임계값(0.8)·LATE 가중치(0.5)는 `TraineeService`의 상수.

## 확인 필요·조치 — 탐지 엔진 + S22~S24 (Phase 3)

- 모듈: `src/verification`(`DetectionRuleService` — RULE_01~06, `VerificationCaseService` — S22~S24). `detection_rule`은 RULE_01~06 + `MANUAL`(수동 전환용 고정 레코드)로 시드되며(`seed/detection-rules.ts`), 전 규칙 `initial_status=NEEDS_CHECK`(D-11 확정: 규칙별 우선확인 미지정).
- **탐지 실행은 서비스 호출로만 제공한다.** `DetectionRuleService.runRule01()`~`runRule06()`(또는 `runAll()`)은 HTTP 라우트가 없다. Phase 5 에서 배치 스케줄러(RULE_03~06)와 출결 이벤트 평가(RULE_01·02)가 붙었다(아래 "Phase 5" 절). 행위자는 `AuditContext.runAsSystem('SYSTEM_RULE', 'RULE_0X', …)`로 태깅된다(기존 audit-tx 선례).
- 각 규칙은 baseline 8.1 그대로 구현했다: RULE_01(동일 device_id 복수 훈련생), RULE_02(짧은 시간 복수 채널 — **채널 식별자는 baseline `[결정 필요]` #2 미확정이라 `attendance.related_info.channel`을 임시 필드로 사용**, #2 확정 후 조정 필요), RULE_03(회차 종료 후 운영기록 지연, 훈련생 0명), RULE_04(퇴실정보 누락, PRESENT/LATE만), RULE_05(반복 출결 수정, USER 수정만), RULE_06(출결상태 반복 변경, USER 수정만). RULE_07은 D-12(공식 출결 연동) 미확정으로 제외.
- **중복 방지(멱등)**: 활성(미종결) 건 중 같은 규칙·같은 `evidence.dedupe_key`가 있으면 새 사건을 만들지 않고 `evidence.items`에 근거만 추가한다(항목은 자체 `id`로 병합해 재실행해도 내용이 같으면 완전히 무변화). RULE_01·02로 새로 매칭된 훈련생은 기존 건에 `verification_case_trainee` 행만 추가한다(신규 사건 아님).
- **출결 API 확장**: `POST /schedules/{id}/attendance/check-in`에 선택 필드 `related_info`(객체, 그대로 JSONB 저장)를 추가했다 — RULE_01·02가 읽는 유일한 쓰기 경로라 기존 계약을 깨지 않는 추가 필드로 열었다(기존 호출자는 영향 없음).
- **S22~S24**: `GET/POST /verification-cases`(목록·일괄 배정), `GET /verification-cases/{id}` + `start-review`\|`complete-confirmation`\|`require-action`\|`complete-action`\|`reopen`, `GET /verification-action-logs`. 상태 전이는 baseline 3-4 표 그대로(`NEEDS_CHECK`/`PRIORITY_CHECK`→`IN_REVIEW`→{`CONFIRMED`|`ACTION_REQUIRED`→`ACTION_DONE`}, 종결건은 `FOLLOW_UP`로 재오픈) 검증하며 위반 시 409(`INVALID_STATE_TRANSITION`). 담당자 배정·상태변경·조치기록은 모두 `verification_action_log`(action_type: `CHECK`/`ACTION_ENTRY`/`CLOSE`/`REOPEN`)에 함께 기록된다(담당자 배정만 예외로 `audit_log`만).
- **권한**: OPS_MANAGER·EXECUTIVE 는 조회+조치(액션 문자 `A` 재사용 — S07 결석확정·S18 escalate와 같은 "확인/조치 처리" 계열, 기술적 선택), SYS_ADMIN 은 조회만, **INSTRUCTOR 는 권한을 부여하지 않아 S22~S24 에 전면 접근할 수 없다**(baseline 4-2: 메뉴 미노출. "대시보드 요약만"은 S01 참고).
- `verification_case`/`detection_rule`은 ERD 상 공통 감사컬럼(●●) 표시가 있으나 §5.3 상세 컬럼표에는 없다 — `detected_at`/`closed_at`이 그 역할을 대신하고 나머지는 `audit_log` before/after로 충분하다(operation_log·course_issue와 동일한 기존 결정 적용). `verification_case_trainee`·`verification_action_log`는 append-only(트리거로 UPDATE/DELETE/TRUNCATE 차단).

## 결과물 등록·검토 + 첨부파일 (S19~S21, Phase 3 잔여)

- 모듈: `src/submission`(S19 제출현황/등록/재등록, S21 상세/검토, S05 훈련생별 결과물 조회), `src/attachment`(업로드·다운로드, S17·S18·S19 3종 entity_type 모두 지원). S20(미제출)은 별도 API 없이 S19의 `GET /courses/{id}/submission-status?missing_only=true`를 재사용한다(baseline 그대로).
- `submission.submit_status`는 D-04 §24(제출기한 저장 위치 미확정)로 인해 항상 `SUBMITTED`로 생성한다(D-08 지각판정 자동화 보류와 동일한 기존 원칙 적용, `LATE_SUBMITTED`는 스키마상 존재하되 아직 자동 판정하지 않음). 재등록은 같은 행의 `version` 증가 + `review_status=PENDING` 초기화이며, 검토(`POST /submissions/{id}/reviews`)는 `submission_review_log` CREATE + `submission` UPDATE 두 건의 audit_log가 함께 남는다(baseline 7-19·7-20행).
- `submission`/`submission_review_log`/`attachment`는 ERD 상 공통 감사컬럼(●●) 표시가 있으나 §5.3 상세 컬럼표에는 없어 operation_log 등과 동일하게 생략했다(`submitted_at`/`version`이 그 역할). `submission_review_log`·`attachment`는 append-only(트리거).
- 첨부파일은 `POST /attachments`(entity_type/entity_id/entity_version + multipart `file`)로 비공개 로컬 디스크(`UPLOAD_DIR`, 기본 `./uploads`, gitignore)에 저장하고 `GET /attachments/{id}/download`로 스트리밍하며, 다운로드마다 `audit_log`에 `VIEW_SENSITIVE`를 남긴다(baseline 7-19행). 파일쓰기와 DB 커밋은 분리돼 있어 DB 실패 시 orphan 파일이 남을 수 있다(정리 배치는 필요해지면 추가, ponytail 표기).
- `entity_type`은 ERD상 OPERATION_LOG(S17)/SUBMISSION(S19)/COURSE_ISSUE(S18) 3종을 모두 지원한다(baseline 7-19·7-20행: "S17·S18·S19" 공용 엔드포인트). RBAC 가드는 라우트당 화면 하나만 선언할 수 있어 `@Authorize`는 4개 역할 모두 어떤 형태로든 보유한 `S19:R`로 최소 인증 게이트만 두고, 실제 권한은 `AttachmentService.authorizeParent()`가 entity_type에 맞는 화면·기능(S19는 업로드 C/다운로드 R, S17·S18은 업로드 시 C 또는 U 중 하나·다운로드 R)을 다시 조회해 판단한다. COURSE_ISSUE의 강사 스코프는 다른 화면과 달리 "본인 등록 건"(`reported_by`=본인)이라 `CourseIssueService.list()`와 동일한 규칙을 재사용했다. `entity_version`은 SUBMISSION만 사용하고 그 외는 NULL(`ck_attachment_entity_version_submission_only`).
- 권한: 등록·재등록은 OPS 전용, 조회(제출현황·미제출)는 SYS·OPS·EXEC 전체 + INSTRUCTOR 본인 배정 과정, 검토(S21)는 OPS만 쓰고 SYS·EXEC는 읽기만, **INSTRUCTOR는 S21에 전면 접근할 수 없다**(baseline 4-2 "S21 접근 불가").

## 과정 종료 체크리스트·종료 (S16, baseline 9절·D-06·P1-03)

- `GET /courses/{id}/closure-checklist`(`S16:A`, OPS·SYS·EXEC만 — INSTRUCTOR는 일반 조회(`S16:R`)와 달리 이 액션을 부여하지 않아 접근 불가), `POST /courses/{id}/close`(`S16:U` 재사용 — 기존 open-recruitment/start/suspend와 동일한 게이트라 OPS 단독이 자동으로 보장됨).
- baseline 9절 표 그대로 9개 항목을 계산한다: **필수 차단**(#1 미출결 대상자, #3 미종결 확인 필요 건 — `verification_case.status`가 종결이 아닌 5개 상태)은 하나라도 있으면 종료 자체를 거부(409 `CLOSURE_BLOCKED`)한다. **경고 후 진행**(#2 퇴실 미확인, #4 운영일지 누락, #5 결과물 미제출, #6 결과물 미검토·보완, #7 확정 잔여 등록건, #8 필수 데이터 0건)은 하나라도 있으면 `override_reason`이 없으면 400, 있으면 종료를 허용한다(V6). #9(변경이력)는 baseline이 "확인 불필요"로 명시해 계산하지 않고 `NOT_NEEDED`로만 표시한다.
- `IN_PROGRESS`가 아니면 409 `INVALID_STATE_TRANSITION`(CLOSED는 최종 상태, baseline 3-1). 종료가 완료되면 그 순간부터 `assertCourseOpen`(V7, 기존 로직 그대로)이 해당 과정의 하위 데이터 변경을 전부 막는다.
- 종료 시점의 미해결 항목 스냅샷은 `course` 행 자체의 before/after 감사(상태값만 담김)와는 별도로, 같은 트랜잭션에서 `audit_log`에 `after_value.closureChecklistSnapshot`로 한 번 더 기록한다(baseline "종료 시점의 미해결 항목 스냅샷과 강행 사유는 audit_log에 남긴다" — 새 컬럼을 추가하지 않고 기존 `AuditedTx.update` 감사에 보조 행을 추가하는 방식으로 해소).

## 대시보드 (S01) + S05 잔여 하위 리소스

- 모듈: `src/dashboard`(`GET /dashboard` — 오늘 회차 목록·확인 필요 요약·미출결/퇴실미확인/운영일지누락/결과물미제출/미검토 건수). 새 집계 로직을 만들지 않고 기존 서비스를 그대로 재사용한다: 5개 건수는 `CourseService.computeClosureItems()`(종료 체크리스트와 동일한 계산, 항목 1·2·4·5·6만 합산)를 스코프 내 모든 미종료(`PREPARING`/`RECRUITING`/`IN_PROGRESS`) 과정에 대해 호출해 더하고, 확인 필요 최근 목록은 `VerificationCaseService.traineesByCase()`(S22와 동일한 관련 훈련생 표시 규칙)를 그대로 쓴다.
- 쿼리: `date`(기본 오늘, "오늘 회차 목록"에만 적용 — 집계 건수는 항상 현재 시점 기준), `course_id`, `assignee_id`(확인 필요 요약만 필터). "최근 N건"의 N=10은 baseline이 구체적으로 정하지 않은 화면 표시 개수라 기술적 기본값으로 정했다(정책 아님).
- **권한**: `S01:R`(기존 Phase 1 권한 그대로, 역할별 스코프만 다름) — SYS_ADMIN·EXECUTIVE는 전체, OPS_MANAGER도 전체(D-02), **INSTRUCTOR는 본인 배정 과정만**(`ScopeService.courseScopeFilter`). baseline이 명시한 "S22~S24 메뉴 미노출, 대시보드 요약만 ◎" 예외를 그대로 구현했다 — INSTRUCTOR는 확인 필요 사건의 상세·조치는 볼 수 없지만(S22/23 권한 없음) 이 대시보드의 확인 필요 요약에는 본인 과정 범위로 나타난다.
- S05 훈련생 상세의 남아 있던 두 하위 리소스도 이번에 연결했다: `GET /trainees/{id}/attendance-summary`(`S05:R`, course_id 필수, 회차별 출결 + 미출결 계산 — `AttendanceService`에 추가), `GET /trainees/{id}/verification-cases`(`S05:A`, OPS·EXEC·SYS 전용 — S05:R은 INSTRUCTOR도 있어 구분하려고 A를 재사용, `VerificationCaseService`에 추가).

## Phase 5 — 배치 스케줄러 + 탐지규칙 파라미터 관리(S28)

- **스케줄러**: `src/batch`(`BatchSchedulerService`). 외부 cron 라이브러리 없이 APP_TIMEZONE 벽시계 기준 다음 실행 시각을 계산(`next-run.ts`)해 `setTimeout`으로 돌린다. 작업은 과정 자동 운영중 전환(00:05, P1-10), RULE_03(매시 정각), RULE_04(22:00 + 09:00 재확인), RULE_05(01:00), RULE_06(01:10), RULE_01·02 보정 전체 평가(01:20·01:30). 시각의 근거와 기술적 기본값은 decisions.md 11절(P5-03·P5-05). 실패는 로그만 남기고 다음 주기에 재시도하며(모든 작업 멱등), 같은 작업이 실행 중이면 그 주기는 건너뛴다. 종료 시 타이머를 멈추고 실행 중인 작업이 끝나길 기다린다.
- **P1-10 과정 자동 운영중 전환**: `CourseService.autoStartDue(today?)`. PREPARING·RECRUITING 중 첫 교육일(휴강 제외 최소 class_date)이 기준일 이하이고 확정 훈련생이 1명 이상인 과정만, 과정마다 별도 트랜잭션에서 행을 잠그고 조건을 다시 확인한 뒤 전환한다. 행위자는 `SYSTEM_BATCH`, audit_log.reason 은 `batch:course-auto-start`, 전환한 건만 기록된다.
- **RULE_01·02 출결 이벤트**: `POST /schedules/{id}/attendance/check-in`이 커밋된 뒤 `DetectionEventService`가 해당 회차만 비동기로 평가한다(응답은 기다리지 않음, related_info 에 device_id·channel 이 있을 때만). `runRule01/02({ scheduleId })`로 범위를 줄일 수 있고, 인자가 없으면 전체 회차를 평가한다.
- **동시 실행**: 탐지 규칙은 실행마다 트랜잭션 advisory lock(`detection:RULE_0X`)을 잡고 그 뒤에 규칙 행을 읽는다 — 배치·이벤트·여러 인스턴스가 겹쳐도 같은 dedupe_key 건이 두 번 생기지 않고, S28에서 바꾼 값이 다음 실행에 바로 반영된다.
- **`BATCH_ENABLED`**: 배치·이벤트 평가를 함께 켜고 끈다. 기본 켜짐, `NODE_ENV=test`(vitest)에서만 꺼진다 — 테스트는 서비스를 직접 호출한다. 여러 인스턴스면 한 대만 켠다.
- **S28 탐지규칙 파라미터 관리**: `GET /detection-rules`(`S28:R`), `PATCH /detection-rules/{id}`(`S28:U`, SYS_ADMIN 전용). `reason` 필수, `params`는 기존 키의 값만(1~100000 정수, 부분 수정), `is_active` 전환 가능. `initial_status`는 D-11 확정값이라 열지 않고 `MANUAL`은 409 `RULE_NOT_EDITABLE`. 변경은 audit_log(UPDATE, before/after, reason)로 남는다. 화면 ID 범위는 migration `20260928000600`으로 S01~S28 로 넓혔다.
- 이번 범위 밖(Phase 5 잔여): 공식 출결 연계·RULE_07(D-12·#1 대기), 감사로그 조회 UI(프론트엔드 — API 는 S27 로 이미 제공), 권한 세분화·엑셀 내보내기(범위 미정).

## 최종 통합 검증(2026-09-28)에서 발견·수정한 사항

- **감사 누락 수정**: baseline 7-22행("확인 건 근거 추가·훈련생 추가")은 기존 활성 확인 건에 새 훈련생이 연결될 때 `verification_case_trainee`도 별도 감사 대상(●)이라고 명시하는데, `DetectionRuleService.upsertCase()`가 지금까지 모든 훈련생 연결을 감사 없이 `tx.query()`로만 삽입하고 있었다. 최초 건 생성 시점(7-21·7-21-1행, 감사 없음)과 기존 건에 추가되는 시점(7-22행, 감사 필요)을 분리해 후자만 `tx.create()`로 옮겼다 — `verification_case_trainee`는 대리키가 아닌 자연키 PK(case_id, trainee_id)라 `AuditedTx.update()`처럼 PK 지정이 막히지 않는다(`create()`는 PK를 막지 않는다, `user_role`과 동일한 선례), `created_by`는 `auditColumns:'created'`로 자동 채워 시스템 행위자는 자동으로 NULL이 된다.
- RULE_01~06(공용 `upsertCase()`)·S18 escalate·S22~S24를 포함한 전체 업무 흐름(과정 생성→…→CLOSED)이 ID/FK/권한/상태전이 기준으로 끝까지 연결되는지 통합 e2e 시나리오로 확인했다(`test/domain.e2e-spec.ts`의 "통합 시나리오" 블록).
- 그 외 코드 구조 점검(컨트롤러의 비즈니스 로직 유입 여부, public 전환 메서드의 실제 사용 여부, service/controller 권한검사 일관성, 트랜잭션 누락, TODO/FIXME)에서는 추가 문제를 발견하지 못했다.
