-- Up Migration
-- decisions.md P1-01·P1-02 = B 채택: 취소된 등록·배정은 이력으로 보존하고, 재신청·재배정은 신규 행으로 만든다.
-- 그래서 (훈련생, 과정) / (강사, 과정, 회차) 유일성은 "유효한 건(취소 제외)"에만 적용한다. 기존 행은 변경하지 않는다.
-- 과정 전체 담당의 course 당 1건 제약(uq_instructor_assignment_course_wide)은 그대로 유지한다.
ALTER TABLE trainee_enrollment DROP CONSTRAINT uq_trainee_enrollment_trainee_course;
CREATE UNIQUE INDEX uq_trainee_enrollment_active
  ON trainee_enrollment (trainee_id, course_id) WHERE status <> 'CANCELLED';

ALTER TABLE instructor_assignment DROP CONSTRAINT uq_instructor_assignment_key;
CREATE UNIQUE INDEX uq_instructor_assignment_active
  ON instructor_assignment (instructor_id, course_id, round_no) WHERE status = 'ASSIGNED';

-- Down Migration
-- 주의: 취소 후 재신청·재배정으로 같은 키의 행이 이미 여러 개 생겼다면 원래의 UNIQUE 를 복원할 수 없어 실패한다(이력은 삭제하지 않는다).
DROP INDEX uq_instructor_assignment_active;
ALTER TABLE instructor_assignment ADD CONSTRAINT uq_instructor_assignment_key UNIQUE (instructor_id, course_id, round_no);

DROP INDEX uq_trainee_enrollment_active;
ALTER TABLE trainee_enrollment ADD CONSTRAINT uq_trainee_enrollment_trainee_course UNIQUE (trainee_id, course_id);
