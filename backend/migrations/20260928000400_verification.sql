-- Up Migration
-- Phase 3: 확인 필요(verification_case) + 탐지규칙(detection_rule). baseline 2-1·3-4·7-15~7-17, system-design STEP 5.3 #15~#17·#25.
-- verification_case/detection_rule 은 ERD 상 ●●(공통 감사컬럼)로 표시되나 §5.3 상세 컬럼표에는 없다 —
-- detected_at/closed_at 이 생성·종결 시각을 대신하고 상태 변경은 audit_log before/after 로 충분하다(operation_log·course_issue 와 동일한 기존 결정 적용).

CREATE TYPE verification_case_status AS ENUM (
  'NEEDS_CHECK', 'PRIORITY_CHECK', 'IN_REVIEW', 'CONFIRMED', 'ACTION_REQUIRED', 'ACTION_DONE', 'FOLLOW_UP'
);
CREATE TYPE verification_action_type AS ENUM ('CHECK', 'ACTION_ENTRY', 'CLOSE', 'REOPEN', 'STATUS_CHANGE');

CREATE TABLE detection_rule (
  rule_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_code      VARCHAR(20)  NOT NULL,
  rule_name      VARCHAR(100) NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  initial_status verification_case_status NOT NULL,
  params         JSONB        NOT NULL,
  description    VARCHAR(500),
  CONSTRAINT uq_detection_rule_code UNIQUE (rule_code),
  CONSTRAINT ck_detection_rule_initial_status CHECK (initial_status IN ('NEEDS_CHECK', 'PRIORITY_CHECK'))
);
COMMENT ON COLUMN detection_rule.initial_status IS 'verification_case_status 재사용(NEEDS_CHECK/PRIORITY_CHECK 2종만 CHECK로 제한) — 전용 2치 enum을 새로 만들지 않는 기술적 선택';

CREATE TABLE verification_case (
  case_id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id                BIGINT NOT NULL REFERENCES course (course_id),
  related_operation_log_id BIGINT REFERENCES operation_log (operation_log_id),
  related_course_issue_id  BIGINT REFERENCES course_issue (issue_id),
  detection_rule_id        BIGINT NOT NULL REFERENCES detection_rule (rule_id),
  detected_at              TIMESTAMPTZ NOT NULL,
  evidence                 JSONB NOT NULL,
  status                   verification_case_status NOT NULL DEFAULT 'NEEDS_CHECK',
  assignee_id              BIGINT REFERENCES user_account (user_id),
  confirmation_note        TEXT,
  action_note              TEXT,
  closed_at                TIMESTAMPTZ
);
COMMENT ON COLUMN verification_case.evidence IS '탐지근거 스냅샷(사실 데이터만). evidence.items 최소 1건, 활성 건 중복 판단은 evidence.dedupe_key 기준 앱 레벨 검증';
CREATE INDEX idx_verification_case_status_detected ON verification_case (status, detected_at);
CREATE INDEX idx_verification_case_course_status ON verification_case (course_id, status);
CREATE INDEX idx_verification_case_assignee_status ON verification_case (assignee_id, status);
CREATE INDEX idx_verification_case_rule_status ON verification_case (detection_rule_id, status);
-- hard delete 금지(baseline 8절): 종결 상태(CONFIRMED/ACTION_DONE)로 표현, DB 트리거 없음(다른 도메인 테이블과 동일).

CREATE TABLE verification_case_trainee (
  case_id       BIGINT      NOT NULL REFERENCES verification_case (case_id),
  trainee_id    BIGINT      NOT NULL REFERENCES trainee (trainee_id),
  attendance_id BIGINT REFERENCES attendance (attendance_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES user_account (user_id),
  PRIMARY KEY (case_id, trainee_id)
);
COMMENT ON TABLE verification_case_trainee IS '확인 건-훈련생 N:M. relation_type 없음(모두 동등한 "관련 훈련생"). 규칙 04·05·06·MANUAL 등 1명뿐인 사건도 1행으로 통일 표현';
COMMENT ON COLUMN verification_case_trainee.created_by IS 'SYSTEM_RULE(규칙 01·02) 생성 시 NULL, MANUAL(사람) 생성 시 값 있음';
CREATE INDEX idx_verification_case_trainee_trainee ON verification_case_trainee (trainee_id);
CREATE TRIGGER trg_verification_case_trainee_no_update_delete BEFORE UPDATE OR DELETE ON verification_case_trainee
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_verification_case_trainee_no_truncate BEFORE TRUNCATE ON verification_case_trainee
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

CREATE TABLE verification_action_log (
  log_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id         BIGINT NOT NULL REFERENCES verification_case (case_id),
  actor_id        BIGINT NOT NULL REFERENCES user_account (user_id),
  action_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_type     verification_action_type NOT NULL,
  previous_status verification_case_status,
  new_status      verification_case_status NOT NULL,
  note            TEXT
);
COMMENT ON COLUMN verification_action_log.actor_id IS '항상 사람(OPS_MANAGER·EXECUTIVE) — 시스템 탐지의 건 생성 자체는 audit_log 로만 기록(baseline 7-31)';
CREATE INDEX idx_verification_action_log_case ON verification_action_log (case_id, action_at);
CREATE TRIGGER trg_verification_action_log_no_update_delete BEFORE UPDATE OR DELETE ON verification_action_log
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_verification_action_log_no_truncate BEFORE TRUNCATE ON verification_action_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE verification_action_log;
DROP TABLE verification_case_trainee;
DROP TABLE verification_case;
DROP TABLE detection_rule;
DROP TYPE verification_action_type;
DROP TYPE verification_case_status;
