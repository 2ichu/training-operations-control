import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditLogService } from '../audit/audit-log.service.js';
import { PG_POOL } from '../database/database.module.js';
import { recordAccessDenied } from './access-denied.js';
import type { AccessContext, Queryable, RbacRequest } from './rbac.types.js';

export interface SqlFilter {
  /** WHERE 절에 그대로 넣을 수 있는 조건식($n 플레이스홀더 포함) */
  sql: string;
  params: unknown[];
}

// 강사(OWN_ASSIGNED) 데이터 스코프 판정 (baseline 2.4·V2·V4).
//  - 과정 접근: 본인의 유효한 instructor_assignment(status=ASSIGNED)가 있는 과정
//  - 회차 접근: class_schedule.instructor_id 가 본인
//  - 훈련생 접근: 본인 배정 과정의 훈련생 중 확정 이후 상태(신청·서류확인중·취소 제외 — 강사는 대상자 확인 화면 S02 접근 불가)
//  - 강사 정보 접근: 본인(linked_instructor_id)
// 권한이 ALL 이면 모두 허용한다. 소속 판정이 불가능하면(instructorId 없음) 아무것도 허용하지 않는다(fail closed).
// 도메인 API 는 (1) ID 를 받는 요청에서 require*, (2) 목록 조회에서 *ScopeFilter 를 쿼리 조건에 포함해야 한다.
@Injectable()
export class ScopeService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool | Queryable,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  // ── 판정 ────────────────────────────────────────────────────────────────
  async canAccessCourse(access: AccessContext, courseId: number): Promise<boolean> {
    if (access.scope === 'ALL') return true;
    if (access.instructorId === null) return false;
    return this.exists(
      `SELECT 1 FROM instructor_assignment WHERE instructor_id = $1 AND course_id = $2 AND status = 'ASSIGNED' LIMIT 1`,
      [access.instructorId, courseId],
    );
  }

  async canAccessSchedule(access: AccessContext, scheduleId: number): Promise<boolean> {
    if (access.scope === 'ALL') return true;
    if (access.instructorId === null) return false;
    return this.exists(`SELECT 1 FROM class_schedule WHERE schedule_id = $1 AND instructor_id = $2 LIMIT 1`, [scheduleId, access.instructorId]);
  }

  async canAccessTrainee(access: AccessContext, traineeId: number): Promise<boolean> {
    if (access.scope === 'ALL') return true;
    if (access.instructorId === null) return false;
    return this.exists(
      `SELECT 1 FROM trainee_enrollment te
         JOIN instructor_assignment ia ON ia.course_id = te.course_id AND ia.status = 'ASSIGNED'
        WHERE te.trainee_id = $1 AND ia.instructor_id = $2
          AND te.status NOT IN ('APPLIED', 'REVIEWING', 'CANCELLED') LIMIT 1`,
      [traineeId, access.instructorId],
    );
  }

  canAccessInstructor(access: AccessContext, instructorId: number): boolean {
    return access.scope === 'ALL' || (access.instructorId !== null && access.instructorId === instructorId);
  }

  // ── ID 로 접근하는 요청용: 범위 밖이면 존재를 숨기는 404 + ACCESS_DENIED(SCOPE_VIOLATION) 기록 ──
  async requireCourse(request: RbacRequest, courseId: number): Promise<void> {
    await this.require(request, await this.canAccessCourse(this.accessOf(request), courseId), 'course');
  }

  async requireSchedule(request: RbacRequest, scheduleId: number): Promise<void> {
    await this.require(request, await this.canAccessSchedule(this.accessOf(request), scheduleId), 'schedule');
  }

  async requireTrainee(request: RbacRequest, traineeId: number): Promise<void> {
    await this.require(request, await this.canAccessTrainee(this.accessOf(request), traineeId), 'trainee');
  }

  async requireInstructor(request: RbacRequest, instructorId: number): Promise<void> {
    await this.require(request, this.canAccessInstructor(this.accessOf(request), instructorId), 'instructor');
  }

  // ── 목록 조회용 쿼리 조건 (V4: 사후 필터가 아니라 쿼리에 스코프를 포함) ────────────
  courseScopeFilter(access: AccessContext, courseIdColumn: string, nextParamIndex: number): SqlFilter {
    if (access.scope === 'ALL') return { sql: 'TRUE', params: [] };
    if (access.instructorId === null) return { sql: 'FALSE', params: [] };
    return {
      sql: `EXISTS (SELECT 1 FROM instructor_assignment ia_s WHERE ia_s.course_id = ${courseIdColumn} AND ia_s.instructor_id = $${nextParamIndex} AND ia_s.status = 'ASSIGNED')`,
      params: [access.instructorId],
    };
  }

  scheduleScopeFilter(access: AccessContext, scheduleInstructorColumn: string, nextParamIndex: number): SqlFilter {
    if (access.scope === 'ALL') return { sql: 'TRUE', params: [] };
    if (access.instructorId === null) return { sql: 'FALSE', params: [] };
    return { sql: `${scheduleInstructorColumn} = $${nextParamIndex}`, params: [access.instructorId] };
  }

  traineeScopeFilter(access: AccessContext, traineeIdColumn: string, nextParamIndex: number): SqlFilter {
    if (access.scope === 'ALL') return { sql: 'TRUE', params: [] };
    if (access.instructorId === null) return { sql: 'FALSE', params: [] };
    return {
      sql: `EXISTS (SELECT 1 FROM trainee_enrollment te_s JOIN instructor_assignment ia_s ON ia_s.course_id = te_s.course_id AND ia_s.status = 'ASSIGNED'
                     WHERE te_s.trainee_id = ${traineeIdColumn} AND ia_s.instructor_id = $${nextParamIndex}
                       AND te_s.status NOT IN ('APPLIED', 'REVIEWING', 'CANCELLED'))`,
      params: [access.instructorId],
    };
  }

  private accessOf(request: RbacRequest): AccessContext {
    if (!request.access) throw new Error('접근 컨텍스트가 없습니다: 엔드포인트에 @Authorize 가 필요합니다');
    return request.access;
  }

  private async require(request: RbacRequest, allowed: boolean, resource: string): Promise<void> {
    if (allowed) return;
    await recordAccessDenied(this.audit, request, this.accessOf(request).userId, `SCOPE_VIOLATION:${resource}`);
    throw new NotFoundException('대상을 찾을 수 없습니다.');
  }

  private async exists(sql: string, params: unknown[]): Promise<boolean> {
    return (await this.db.query(sql, params)).rows.length > 0;
  }
}
