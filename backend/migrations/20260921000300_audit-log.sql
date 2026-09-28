-- Up Migration
-- baseline 2-3·7절: 사람(USER)과 시스템(SYSTEM_RULE/BATCH/API) 행위자를 모두 기록한다. append-only.
CREATE TABLE audit_log (
  log_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type    audit_actor_type NOT NULL,
  actor_user_id BIGINT REFERENCES user_account (user_id),
  action        audit_action     NOT NULL,
  target_table  VARCHAR(100)     NOT NULL,
  target_id     BIGINT,
  before_value  JSONB,
  after_value   JSONB,
  action_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  reason        VARCHAR(500),
  ip_address    VARCHAR(45),
  -- actor_type 이 USER 가 아니면 actor_user_id 는 반드시 NULL
  CONSTRAINT ck_audit_log_actor_system_null CHECK (actor_type = 'USER' OR actor_user_id IS NULL),
  -- actor_type 이 USER 이면 필수, 단 존재하지 않는 계정의 LOGIN_FAILED 만 NULL 허용
  CONSTRAINT ck_audit_log_actor_user_required CHECK (actor_type <> 'USER' OR actor_user_id IS NOT NULL OR action = 'LOGIN_FAILED'),
  -- target_id 의 NULL 허용은 LOGIN_FAILED, ACCESS_DENIED 만
  CONSTRAINT ck_audit_log_target_id_required CHECK (target_id IS NOT NULL OR action IN ('LOGIN_FAILED', 'ACCESS_DENIED'))
);
CREATE INDEX idx_audit_log_action_at ON audit_log (action_at);
CREATE INDEX idx_audit_log_actor_user_action_at ON audit_log (actor_user_id, action_at);
CREATE INDEX idx_audit_log_target ON audit_log (target_table, target_id);

CREATE TRIGGER trg_audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE audit_log;
