-- 예시 템플릿 (자동 실행되지 않음). 마이그레이션 계정(테이블 소유자)과 애플리케이션 계정을 분리한다.
-- baseline.md V10·8절: 로그 테이블에는 UPDATE/DELETE 권한을 주지 않는다.
-- 트리거(forbid_modification)가 소유자 계정에서도 로그 수정을 막지만, 권한 분리가 1차 방어선이다.
-- 사용: psql -v app_password='...' -f db/roles.example.sql  (마이그레이션 완료 후, 소유자 계정으로 실행)

CREATE ROLE training_app LOGIN PASSWORD :'app_password';
GRANT USAGE ON SCHEMA public TO training_app;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO training_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO training_app;

-- append-only 테이블: 조회·추가만 허용
REVOKE UPDATE ON audit_log, trainee_change_log, instructor_change_log FROM training_app;

-- 설정 데이터(교체 허용)만 DELETE 예외
GRANT DELETE ON user_role, role_permission TO training_app;

-- 이후 마이그레이션으로 생기는 테이블에도 동일한 기본 권한 적용 (append-only 테이블은 생성 시 개별 REVOKE 필요)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO training_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO training_app;
