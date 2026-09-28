-- Up Migration
-- Phase 5(system-design STEP 10): 탐지규칙 파라미터 관리 화면을 S28 로 추가한다(STEP 8.4 "시스템 관리 하위 detection_rule 화면").
-- 화면 목록이 S01~S27 로 닫혀 있던 CHECK 를 S28 까지 넓힌다. 다른 컬럼·데이터 변경 없음.
ALTER TABLE role_permission DROP CONSTRAINT ck_role_permission_screen_id;
ALTER TABLE role_permission ADD CONSTRAINT ck_role_permission_screen_id CHECK (screen_id ~ '^S(0[1-9]|1[0-9]|2[0-8])$');

-- Down Migration
DELETE FROM role_permission WHERE screen_id = 'S28';
ALTER TABLE role_permission DROP CONSTRAINT ck_role_permission_screen_id;
ALTER TABLE role_permission ADD CONSTRAINT ck_role_permission_screen_id CHECK (screen_id ~ '^S(0[1-9]|1[0-9]|2[0-7])$');
