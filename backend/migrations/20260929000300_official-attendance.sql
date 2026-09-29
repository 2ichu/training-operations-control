-- Up Migration
-- D-12 확정(공식 출결 = CSV 파일 업로드 대사, 2026-09-29): system-design STEP 5.3 #24 attendance_source_raw 를 구체화하고
-- 화면 S29(공식 출결 대사)를 추가한다(S28 과 같은 방식으로 화면 ID CHECK 를 S29 까지 넓힘).
ALTER TABLE role_permission DROP CONSTRAINT ck_role_permission_screen_id;
ALTER TABLE role_permission ADD CONSTRAINT ck_role_permission_screen_id CHECK (screen_id ~ '^S(0[1-9]|1[0-9]|2[0-9])$');

-- 업로드한 파일의 행 단위 원본 + 처리 결과. 반영·불일치 판단이 끝난 뒤 적재하므로(한 트랜잭션) 갱신이 없고 append-only 다
-- (baseline 8절 "공식 원본 보존, 삭제 금지"). processed 는 STEP 5.3 #24 의 플래그를 그대로 유지하며 오류 행만 false 다.
CREATE TABLE attendance_source_raw (
  raw_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id      UUID          NOT NULL,
  file_name     VARCHAR(255)  NOT NULL,
  row_no        INTEGER       NOT NULL,
  course_id     BIGINT        NOT NULL REFERENCES course (course_id),
  uploaded_by   BIGINT        NOT NULL REFERENCES user_account (user_id),
  received_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  raw_payload   JSONB         NOT NULL,
  result        VARCHAR(20)   NOT NULL,
  message       VARCHAR(500),
  attendance_id BIGINT        REFERENCES attendance (attendance_id),
  case_id       BIGINT        REFERENCES verification_case (case_id),
  processed     BOOLEAN       NOT NULL,
  processed_at  TIMESTAMPTZ,
  CONSTRAINT ck_attendance_source_raw_result CHECK (result IN ('CREATED', 'UPDATED', 'CONVERTED', 'UNCHANGED', 'CASE', 'MISMATCH', 'ERROR')),
  CONSTRAINT uq_attendance_source_raw_row UNIQUE (batch_id, row_no)
);
COMMENT ON COLUMN attendance_source_raw.result IS 'CREATED 신규 생성 / UPDATED 공식 정정 / CONVERTED 일치해 공식으로 전환 / UNCHANGED 변경 없음 / CASE 불일치→RULE_07 확인 필요 / MISMATCH 불일치(RULE_07 비활성이라 건 미생성) / ERROR 검증 오류(미반영)';
CREATE INDEX idx_attendance_source_raw_course ON attendance_source_raw (course_id, received_at DESC);
CREATE INDEX idx_attendance_source_raw_batch ON attendance_source_raw (batch_id);
CREATE TRIGGER trg_attendance_source_raw_no_update_delete BEFORE UPDATE OR DELETE ON attendance_source_raw
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_attendance_source_raw_no_truncate BEFORE TRUNCATE ON attendance_source_raw
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE attendance_source_raw;
DELETE FROM role_permission WHERE screen_id = 'S29';
ALTER TABLE role_permission DROP CONSTRAINT ck_role_permission_screen_id;
ALTER TABLE role_permission ADD CONSTRAINT ck_role_permission_screen_id CHECK (screen_id ~ '^S(0[1-9]|1[0-9]|2[0-8])$');
