-- Up Migration
-- baseline 10-2 #5(이미 확정): 초기·초기화 비밀번호는 최초 로그인 시 변경을 강제한다.
-- 이를 표현할 컬럼이 없어 추가한다(정책 변경이 아니라 기존 확정 요구사항의 구현 보완).
ALTER TABLE user_account ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE user_account DROP COLUMN must_change_password;
