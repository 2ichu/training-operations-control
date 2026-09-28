-- Up Migration
-- Phase 3 잔여: 결과물 등록·검토·미제출 (S19~S21). baseline 2-4·3-5·7-19·7-20, system-design STEP 5.3 #13·#14·#18.
-- submission 은 ERD 상 ●●(공통 감사컬럼)로 표시되나 §5.3 상세 컬럼표에는 없다 —
-- submitted_at(제출 시점)·version(재제출 판별)이 그 역할을 대신하고 나머지는 audit_log before/after 로 충분하다
-- (operation_log·course_issue·verification_case 와 동일한 기존 결정 적용).

CREATE TYPE submission_submit_status AS ENUM ('SUBMITTED', 'LATE_SUBMITTED');
CREATE TYPE submission_review_status AS ENUM ('PENDING', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED');
CREATE TYPE submission_review_result AS ENUM ('APPROVED', 'REVISION_REQUESTED', 'REJECTED');
CREATE TYPE attachment_entity_type AS ENUM ('OPERATION_LOG', 'SUBMISSION', 'COURSE_ISSUE');

CREATE TABLE submission (
  submission_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trainee_id    BIGINT       NOT NULL REFERENCES trainee (trainee_id),
  course_id     BIGINT       NOT NULL REFERENCES course (course_id),
  title         VARCHAR(200) NOT NULL,
  version       INT          NOT NULL DEFAULT 1,
  submitted_at  TIMESTAMPTZ  NOT NULL,
  submit_status submission_submit_status NOT NULL DEFAULT 'SUBMITTED',
  review_status submission_review_status NOT NULL DEFAULT 'PENDING',
  CONSTRAINT uq_submission_trainee_course_title UNIQUE (trainee_id, course_id, title)
);
COMMENT ON CONSTRAINT uq_submission_trainee_course_title ON submission IS '재등록은 같은 행의 version 증가로 표현(baseline 확정). "미제출"은 행이 없는 계산 상태';
COMMENT ON COLUMN submission.submit_status IS 'D-04 §24(제출기한 저장 위치) 결정 전까지 기한후제출 자동판정은 보류 — 항상 SUBMITTED로 생성(D-08 지각판정 보류와 동일한 기존 원칙 적용)';
CREATE INDEX idx_submission_course_review ON submission (course_id, review_status);

CREATE TABLE submission_review_log (
  log_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id   BIGINT      NOT NULL REFERENCES submission (submission_id),
  version         INT         NOT NULL,
  reviewer_id     BIGINT      NOT NULL REFERENCES user_account (user_id),
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_result   submission_review_result NOT NULL,
  review_comment  TEXT
);
CREATE INDEX idx_submission_review_log_submission ON submission_review_log (submission_id, version);
CREATE TRIGGER trg_submission_review_log_no_update_delete BEFORE UPDATE OR DELETE ON submission_review_log
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_submission_review_log_no_truncate BEFORE TRUNCATE ON submission_review_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

CREATE TABLE attachment (
  attachment_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type    attachment_entity_type NOT NULL,
  entity_id      BIGINT       NOT NULL, -- 다형성(entity_type별 대상 테이블 PK) — DB FK 불가, 애플리케이션 레벨 검증(system-design 5.1 주석)
  entity_version INT,
  file_name      VARCHAR(255) NOT NULL,
  file_path      VARCHAR(500) NOT NULL,
  file_size      BIGINT       NOT NULL,
  uploaded_by    BIGINT       NOT NULL REFERENCES user_account (user_id),
  uploaded_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_attachment_entity_version_submission_only CHECK (entity_type = 'SUBMISSION' OR entity_version IS NULL)
);
COMMENT ON COLUMN attachment.entity_version IS 'entity_type=SUBMISSION 일 때만 사용(재등록 시 이전 파일을 버전별로 보존)';
CREATE INDEX idx_attachment_entity ON attachment (entity_type, entity_id, entity_version);
CREATE TRIGGER trg_attachment_no_update_delete BEFORE UPDATE OR DELETE ON attachment
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_attachment_no_truncate BEFORE TRUNCATE ON attachment
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE attachment;
DROP TABLE submission_review_log;
DROP TABLE submission;
DROP TYPE attachment_entity_type;
DROP TYPE submission_review_result;
DROP TYPE submission_review_status;
DROP TYPE submission_submit_status;
