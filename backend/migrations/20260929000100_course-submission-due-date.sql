-- Up Migration
-- D-04(#24) 확정(2026-09-29): 결과물 제출기한은 과정 공통 1개(decisions 7절 안 A). 날짜 단위이며 그날 24:00(APP_TIMEZONE, 기본 KST)
-- 이전에 제출(submitted_at)하면 제출됨, 이후면 기한후제출. NULL 이면 기한 없음(기한후제출 판정 안 함).
ALTER TABLE course ADD COLUMN submission_due_date DATE;
COMMENT ON COLUMN course.submission_due_date IS '결과물 제출기한(과정 공통, D-04). 그날 24:00(기관 시간대) 이후 제출은 기한후제출. NULL=기한 없음';

-- Down Migration
ALTER TABLE course DROP COLUMN submission_due_date;
