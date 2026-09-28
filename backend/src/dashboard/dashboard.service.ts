import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { toApi, Where } from '../common/api.js';
import { todayIn } from '../common/today.js';
import { qDate, qInt, type Obj } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { AccessContext, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';
import { SCHEDULE_TIMEZONE, scheduleDisplayStatusSql } from '../schedule/schedule.service.js';
import { CourseService, type ClosureItem } from '../course/course.service.js';
import { VerificationCaseService } from '../verification/verification-case.service.js';

const RECENT_CASES_LIMIT = 10; // "최근 N건"(system-design 7.1) — 표시 개수는 정책값이 아닌 기술적 기본값
const OPEN_COURSE_STATUSES = ['PREPARING', 'RECRUITING', 'IN_PROGRESS'] as const; // CLOSED·SUSPENDED 는 종료 시점에 이미 처리된 항목이라 대시보드 집계에서 제외

// S01 대시보드(baseline 5-2, system-design 7.1). 새 집계 로직을 만들지 않고 기존 서비스(종료 체크리스트·확인 필요 목록)를 재사용한다.
@Injectable()
export class DashboardService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(CourseService) private readonly courses: CourseService,
    @Inject(VerificationCaseService) private readonly verificationCases: VerificationCaseService,
  ) {}

  async summary(request: RbacRequest, query: Obj) {
    const access = request.access!;
    const date = qDate(query, 'date') ?? (await todayIn(this.db, SCHEDULE_TIMEZONE));
    const courseIdFilter = qInt(query, 'course_id');
    const assigneeIdFilter = qInt(query, 'assignee_id');

    const openCourseIds = await this.accessibleCourseIds(access, courseIdFilter, true);
    const todaySchedules = await this.todaySchedules(access, date, courseIdFilter);
    const counts = await this.aggregateCounts(openCourseIds);
    const verificationSummary = await this.verificationSummary(openCourseIds, assigneeIdFilter);

    return { date, todaySchedules, counts, verificationSummary };
  }

  private async accessibleCourseIds(access: AccessContext, courseIdFilter: number | undefined, openOnly: boolean): Promise<number[]> {
    const where = new Where();
    where.addFilter((i) => this.scope.courseScopeFilter(access, 'c.course_id', i));
    if (openOnly) where.add((p) => `c.status = ANY(${p}::course_status[])`, OPEN_COURSE_STATUSES);
    if (courseIdFilter) where.add((p) => `c.course_id = ${p}`, courseIdFilter);
    const { rows } = await this.db.query(`SELECT c.course_id FROM course c WHERE ${where.sql}`, where.params);
    return rows.map((r) => Number(r.course_id));
  }

  private async todaySchedules(access: AccessContext, date: string, courseIdFilter: number | undefined) {
    const where = new Where();
    where.add((p) => `s.class_date = ${p}`, date);
    where.addFilter((i) => this.scope.courseScopeFilter(access, 's.course_id', i)); // baseline: 대시보드의 INSTRUCTOR 범위는 "본인 과정만"(회차 단위 ◎ 아님)
    if (courseIdFilter) where.add((p) => `s.course_id = ${p}`, courseIdFilter);
    where.params.push(SCHEDULE_TIMEZONE);
    const tz = `$${where.params.length}::text`;
    const { rows } = await this.db.query(
      `SELECT s.schedule_id, s.course_id, c.course_name, s.round_no, s.start_time, s.end_time, s.instructor_id, i.name AS instructor_name, s.status,
              ${scheduleDisplayStatusSql(tz)} AS display_status
         FROM class_schedule s JOIN course c ON c.course_id = s.course_id LEFT JOIN instructor i ON i.instructor_id = s.instructor_id
        WHERE ${where.sql} ORDER BY s.start_time`,
      where.params,
    );
    return rows.map((r) => toApi(r));
  }

  // baseline "미출결·퇴실미확인·운영일지 미작성·결과물 미제출·미검토 건수": 종료 체크리스트 항목 1·2·4·5·6 을 그대로 합산한다.
  private async aggregateCounts(courseIds: number[]): Promise<Record<string, number>> {
    const totals = { notCheckedIn: 0, checkoutMissing: 0, operationLogMissing: 0, submissionMissing: 0, reviewPending: 0 };
    const byItem: Record<number, keyof typeof totals> = { 1: 'notCheckedIn', 2: 'checkoutMissing', 4: 'operationLogMissing', 5: 'submissionMissing', 6: 'reviewPending' };
    for (const courseId of courseIds) {
      const items: ClosureItem[] = await this.courses.computeClosureItems(this.db, courseId);
      for (const item of items) {
        const key = byItem[item.item];
        if (key) totals[key] += item.count;
      }
    }
    return totals;
  }

  private async verificationSummary(courseIds: number[], assigneeIdFilter: number | undefined) {
    if (courseIds.length === 0) return { byStatus: [], recent: [] };
    const where = new Where();
    where.add((p) => `vc.course_id = ANY(${p}::bigint[])`, courseIds);
    if (assigneeIdFilter) where.add((p) => `vc.assignee_id = ${p}`, assigneeIdFilter);

    const { rows: statusRows } = await this.db.query(`SELECT vc.status, count(*) n FROM verification_case vc WHERE ${where.sql} GROUP BY vc.status`, where.params);
    const byStatus = statusRows.map((r) => ({ status: r.status as string, count: Number(r.n) }));

    const { rows: recentRows } = await this.db.query(
      `SELECT vc.case_id, vc.course_id, c.course_name, dr.rule_code, vc.status, vc.assignee_id, ua.name AS assignee_name, vc.detected_at
         FROM verification_case vc JOIN course c ON c.course_id = vc.course_id JOIN detection_rule dr ON dr.rule_id = vc.detection_rule_id
         LEFT JOIN user_account ua ON ua.user_id = vc.assignee_id -- system-design 7.1 표 컬럼 "담당자"(이름 표시)
        WHERE ${where.sql} ORDER BY vc.detected_at DESC LIMIT ${RECENT_CASES_LIMIT}`,
      where.params,
    );
    const trainees = await this.verificationCases.traineesByCase(recentRows.map((r) => Number(r.case_id)));
    const recent = recentRows.map((r) => ({
      ...toApi(r),
      priority: r.status === 'PRIORITY_CHECK',
      trainees: trainees.get(Number(r.case_id)) ?? [],
    }));
    return { byStatus, recent };
  }
}
