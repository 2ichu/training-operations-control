-- Up Migration
-- RULE_01(동일 단말)·RULE_02(출결 채널)는 도입하지 않기로 결정했다(2026-09-29, decisions.md P7-01): 출결은 등록 단말에 종속되지 않고
-- 여러 기기로 자유롭게 입력되어 신뢰할 수 있는 단말 식별자가 없다. 이미 배포된 DB 에 있는 두 규칙 행은 이력(과거 확인 건의 FK)이라
-- 지우지 않고 사용 안 함으로 바꾼다. 새 DB 에는 시드가 두 행을 만들지 않으므로 이 갱신은 대상이 없다.
-- 과거에 생성된 확인 건은 그대로 두며 S22~S24 에서 평소처럼 처리한다.
UPDATE detection_rule SET is_active = false WHERE rule_code IN ('RULE_01', 'RULE_02');

-- Down Migration
-- 비활성화 전의 값(사용 여부)은 복원하지 않는다: 두 규칙은 도입하지 않기로 한 것이라 되돌릴 대상이 없다.
SELECT 1;
