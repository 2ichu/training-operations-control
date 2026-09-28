-- Up Migration
-- created_by / updated_by 가 NULL 이면 시스템 행위(배치·시드 등), 사람 행위는 사용자 ID.
CREATE TABLE user_account (
  user_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_id             VARCHAR(50)  NOT NULL,
  password_hash        VARCHAR(255) NOT NULL,
  name                 VARCHAR(50)  NOT NULL,
  email                VARCHAR(100),
  linked_instructor_id BIGINT,
  status               user_status  NOT NULL DEFAULT 'ACTIVE',
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by           BIGINT REFERENCES user_account (user_id),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by           BIGINT REFERENCES user_account (user_id),
  CONSTRAINT uq_user_account_login_id UNIQUE (login_id)
);
-- linked_instructor_id 의 FK·UNIQUE 는 instructor 테이블 생성 후 추가한다(순환 참조 회피)
CREATE TRIGGER trg_user_account_updated_at BEFORE UPDATE ON user_account
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE role (
  role_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_code  role_code   NOT NULL,
  role_name  VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES user_account (user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES user_account (user_id),
  CONSTRAINT uq_role_role_code UNIQUE (role_code)
);
CREATE TRIGGER trg_role_updated_at BEFORE UPDATE ON role
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 설정 데이터: 교체(삭제 후 재삽입) 허용, 변경은 audit_log before/after 로 추적 (baseline 8절 예외)
CREATE TABLE user_role (
  user_id    BIGINT      NOT NULL REFERENCES user_account (user_id),
  role_id    BIGINT      NOT NULL REFERENCES role (role_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES user_account (user_id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permission (
  role_id    BIGINT            NOT NULL REFERENCES role (role_id),
  screen_id  VARCHAR(10)       NOT NULL,
  action     permission_action NOT NULL,
  scope_type permission_scope  NOT NULL DEFAULT 'ALL',
  created_at TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES user_account (user_id),
  updated_at TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES user_account (user_id),
  PRIMARY KEY (role_id, screen_id, action),
  CONSTRAINT ck_role_permission_screen_id CHECK (screen_id ~ '^S(0[1-9]|1[0-9]|2[0-7])$')
);
CREATE TRIGGER trg_role_permission_updated_at BEFORE UPDATE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE role_permission;
DROP TABLE user_role;
DROP TABLE role;
DROP TABLE user_account;
