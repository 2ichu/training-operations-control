-- Up Migration
-- baseline.md 3절 상태값 코드 (DB는 영문 코드, UI 한글 표시명은 애플리케이션 사전에서 매핑)
CREATE TYPE course_status AS ENUM ('PREPARING', 'RECRUITING', 'IN_PROGRESS', 'CLOSED', 'SUSPENDED');
CREATE TYPE enrollment_status AS ENUM ('APPLIED', 'REVIEWING', 'CONFIRMED', 'COMPLETED', 'DROPPED', 'EXPELLED', 'CANCELLED');
CREATE TYPE schedule_status AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE instructor_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE assignment_status AS ENUM ('ASSIGNED', 'CANCELLED');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE role_code AS ENUM ('SYS_ADMIN', 'OPS_MANAGER', 'INSTRUCTOR', 'EXECUTIVE');
CREATE TYPE permission_action AS ENUM ('C', 'R', 'U', 'D', 'A');
CREATE TYPE permission_scope AS ENUM ('ALL', 'OWN_ASSIGNED');
CREATE TYPE audit_actor_type AS ENUM ('USER', 'SYSTEM_RULE', 'SYSTEM_BATCH', 'SYSTEM_API');
CREATE TYPE audit_action AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'VIEW_SENSITIVE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'ACCESS_DENIED');
CREATE TYPE trainee_change_entity AS ENUM ('TRAINEE', 'ENROLLMENT');
CREATE TYPE instructor_change_entity AS ENUM ('INSTRUCTOR', 'ASSIGNMENT');

-- updated_at 자동 갱신 (공통 감사컬럼 보유 테이블용)
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

-- append-only 테이블(audit_log, *_change_log)의 UPDATE/DELETE/TRUNCATE 차단 (baseline V10, 8절)
CREATE FUNCTION forbid_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % is not allowed on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;

-- Down Migration
DROP FUNCTION forbid_modification();
DROP FUNCTION set_updated_at();
DROP TYPE instructor_change_entity;
DROP TYPE trainee_change_entity;
DROP TYPE audit_action;
DROP TYPE audit_actor_type;
DROP TYPE permission_scope;
DROP TYPE permission_action;
DROP TYPE role_code;
DROP TYPE user_status;
DROP TYPE assignment_status;
DROP TYPE instructor_status;
DROP TYPE schedule_status;
DROP TYPE enrollment_status;
DROP TYPE course_status;
