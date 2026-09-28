import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditContext } from '../audit/audit-context.js';
import { type AuditedTx, AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { escapeLike, pageOf, toApi, Where } from '../common/api.js';
import { assertCourseOpen, conflict, lockRow } from '../common/tx.js';
import {
  asObject, isValidDate, type Obj, optStr, qDate, qEnumList, qInt, qStr, reqDate, reqInt, reqStr,
} from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { AccessContext, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';
import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';
import { ACTIVE_STATUSES } from '../verification/verification.constants.js';

export const COURSE_STATUSES = ['PREPARING', 'RECRUITING', 'IN_PROGRESS', 'CLOSED', 'SUSPENDED'] as const;

interface Queryable {
  query<T extends pg.QueryResultRow = Row>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}

type ClosureClassification = 'BLOCKING' | 'WARNING' | 'NOT_NEEDED';
export interface ClosureItem {
  item: number;
  label: string;
  classification: ClosureClassification;
  count: number;
}

const COLUMNS = 'c.course_id, c.course_name, c.start_date, c.end_date, c.total_hours, c.training_site, c.manager_user_id, c.status, c.created_at, c.updated_at';
// 강사(OWN_ASSIGNED)에게는 확정 이전·취소 상태의 등록 건을 집계에 포함하지 않는다(ScopeService.canAccessTrainee 와 동일 기준)
const HIDDEN_FOR_SCOPED = `('APPLIED', 'REVIEWING', 'CANCELLED')`;

export const AUTO_START_TAG = 'batch:course-auto-start';
// P1-10 자동 운영중 전환 조건(baseline 3-1·5-3): 첫 교육일(휴강 제외 최소 class_date, system-design 1.3) 도래 + 확정 훈련생 ≥ 1.
// $1 = 기준일(YYYY-MM-DD). 후보 조회와 전환 직전 재확인에 같은 조건을 쓴다.
const AUTO_START_DUE = `c.status IN ('PREPARING', 'RECRUITING')
  AND (SELECT min(s.class_date) FROM class_schedule s WHERE s.course_id = c.course_id AND s.status <> 'CANCELLED') <= $1::date
  AND EXISTS (SELECT 1 FROM trainee_enrollment te WHERE te.course_id = c.course_id AND te.status = 'CONFIRMED')`;

@Injectable()
export class CourseService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
    @Inject(AuditContext) private readonly auditContext: AuditContext,
  ) {}

  // ── 조회 ────────────────────────────────────────────────────────────────
  async list(access: AccessContext, query: Obj) {
    const where = new Where();
    where.addFilter((i) => this.scope.courseScopeFilter(access, 'c.course_id', i));
    const name = qStr(query, 'name');
    if (name) where.add((p) => `c.course_name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(name)}%`);
    const statuses = qEnumList(query, 'status', COURSE_STATUSES);
    if (statuses) where.add((p) => `c.status = ANY(${p}::course_status[])`, statuses);
    // from/to: 해당 기간과 과정 기간이 겹치는 과정
    const from = qDate(query, 'from');
    if (from) where.add((p) => `c.end_date >= ${p}`, from);
    const to = qDate(query, 'to');
    if (to) where.add((p) => `c.start_date <= ${p}`, to);
    const manager = qInt(query, 'manager_user_id');
    if (manager) where.add((p) => `c.manager_user_id = ${p}`, manager);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS},
              (SELECT count(*) FROM trainee_enrollment te WHERE te.course_id = c.course_id AND te.status = 'CONFIRMED') AS confirmed_trainee_count,
              count(*) OVER() AS total
         FROM course c WHERE ${where.sql}
        ORDER BY c.start_date DESC, c.course_id DESC
        LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }

  async detail(request: RbacRequest, courseId: number) {
    const access = request.access!;
    await this.scope.requireCourse(request, courseId);
    const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM course c WHERE c.course_id = $1`, [courseId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');

    const scoped = access.scope !== 'ALL';
    const trainees = await this.db.query(
      `SELECT status, count(*) AS count FROM trainee_enrollment WHERE course_id = $1 ${scoped ? `AND status NOT IN ${HIDDEN_FOR_SCOPED}` : ''} GROUP BY status ORDER BY status`,
      [courseId],
    );
    // 강사는 본인 배정·본인 회차만 본다(V4)
    const assignments = await this.db.query(
      `SELECT ia.assignment_id, ia.instructor_id, i.name AS instructor_name, ia.round_no, ia.status, ia.assigned_at
         FROM instructor_assignment ia JOIN instructor i ON i.instructor_id = ia.instructor_id
        WHERE ia.course_id = $1 ${scoped ? 'AND ia.instructor_id = $2' : ''} ORDER BY ia.assignment_id`,
      scoped ? [courseId, access.instructorId] : [courseId],
    );
    const sf = this.scope.scheduleScopeFilter(access, 's.instructor_id', 2);
    const schedules = await this.db.query(
      `SELECT s.schedule_id, s.round_no, s.class_date, s.start_time, s.end_time, s.instructor_id, s.status
         FROM class_schedule s WHERE s.course_id = $1 AND ${sf.sql} ORDER BY s.round_no`,
      [courseId, ...sf.params],
    );
    return {
      ...toApi(rows[0]),
      traineeSummary: trainees.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
      instructorAssignments: assignments.rows.map((r) => toApi(r)),
      schedules: schedules.rows.map((r) => toApi(r)),
    };
  }

  // ── 등록·수정 ───────────────────────────────────────────────────────────
  async create(body: unknown) {
    const o = asObject(body);
    const values = {
      course_name: reqStr(o, 'course_name', 200),
      start_date: reqDate(o, 'start_date'),
      end_date: reqDate(o, 'end_date'),
      total_hours: reqInt(o, 'total_hours'),
      training_site: reqStr(o, 'training_site', 200),
      manager_user_id: reqInt(o, 'manager_user_id'),
    };
    if (values.end_date < values.start_date) throw invalidRange();
    return this.transactions.run(async (tx) => {
      await this.assertManager(tx, values.manager_user_id);
      return toApi(await tx.create('course', { ...values, status: 'PREPARING' }));
    });
  }

  async update(request: RbacRequest, courseId: number, body: unknown) {
    await this.scope.requireCourse(request, courseId);
    const o = asObject(body);
    const set: Row = {};
    const put = (key: string, value: unknown) => value !== undefined && (set[key] = value);
    put('course_name', o.course_name === undefined ? undefined : reqStr(o, 'course_name', 200));
    put('start_date', o.start_date === undefined ? undefined : reqDate(o, 'start_date'));
    put('end_date', o.end_date === undefined ? undefined : reqDate(o, 'end_date'));
    put('total_hours', o.total_hours === undefined ? undefined : reqInt(o, 'total_hours'));
    put('training_site', o.training_site === undefined ? undefined : reqStr(o, 'training_site', 200));
    put('manager_user_id', o.manager_user_id === undefined ? undefined : reqInt(o, 'manager_user_id'));
    if (Object.keys(set).length === 0) throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });
    const reason = optStr(o, 'reason', 500) ?? undefined;

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'course', 'course_id', courseId);
      assertCourseOpen(current);
      const start = (set.start_date ?? current.start_date) as string;
      const end = (set.end_date ?? current.end_date) as string;
      if (isValidDate(start) && isValidDate(end) && end < start) throw invalidRange();
      if (set.manager_user_id !== undefined) await this.assertManager(tx, set.manager_user_id as number);
      return toApi(await tx.update('course', { course_id: courseId }, set, { reason }));
    });
  }

  // ── 상태 전이 (baseline 3-1) ────────────────────────────────────────────
  async openRecruitment(request: RbacRequest, courseId: number) {
    await this.scope.requireCourse(request, courseId);
    return this.transition(courseId, ['PREPARING'], 'RECRUITING');
  }

  async start(request: RbacRequest, courseId: number, body: unknown) {
    await this.scope.requireCourse(request, courseId);
    const o = body === undefined || body === null ? {} : asObject(body);
    if (o.acknowledge_no_confirmed_trainees !== undefined && typeof o.acknowledge_no_confirmed_trainees !== 'boolean') {
      throw new BadRequestException({ code: 'VALIDATION', field: 'acknowledge_no_confirmed_trainees', message: 'true/false 여야 합니다' });
    }
    return this.transition(courseId, ['PREPARING', 'RECRUITING'], 'IN_PROGRESS', undefined, async (tx) => {
      const { rows } = await tx.query(`SELECT count(*) AS n FROM trainee_enrollment WHERE course_id = $1 AND status = 'CONFIRMED'`, [courseId]);
      if (Number(rows[0].n) === 0 && o.acknowledge_no_confirmed_trainees !== true) {
        throw conflict('NO_CONFIRMED_TRAINEES', '확정 훈련생이 없습니다. 확인 후 acknowledge_no_confirmed_trainees=true 로 다시 요청하세요.');
      }
    });
  }

  // P1-10(2026-09-22 설계 확정): 매일 자정 직후 BatchSchedulerService 가 호출한다. 조건을 만족하는 과정만 SYSTEM_BATCH 로 전환하고
  // (조건 미충족이면 전환하지 않음), 과정마다 별도 트랜잭션이라 한 건이 실패해도 나머지는 진행되며 실패 건은 다음 실행에서 다시
  // 후보가 된다(멱등). 전환 직전에 행을 잠그고 조건을 다시 확인하므로 그 사이 수동 전환·중단된 과정은 건너뛴다.
  // 감사는 상태를 바꾼 건만 남는다(baseline 7절 #32). today 는 테스트용이며 기본은 APP_TIMEZONE 기준 오늘이다.
  async autoStartDue(today?: string): Promise<{ date: string; started: number[]; failed: { courseId: number; error: string }[] }> {
    const date = today ?? ((await this.db.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`, [SCHEDULE_TIMEZONE])).rows[0].d as string);
    const { rows } = await this.db.query(`SELECT c.course_id FROM course c WHERE ${AUTO_START_DUE} ORDER BY c.course_id`, [date]);
    const started: number[] = [];
    const failed: { courseId: number; error: string }[] = [];
    for (const { course_id } of rows) {
      const courseId = Number(course_id);
      try {
        const changed = await this.auditContext.runAsSystem('SYSTEM_BATCH', AUTO_START_TAG, () =>
          this.transactions.run(async (tx) => {
            await lockRow(tx, 'course', 'course_id', courseId);
            const due = await tx.query(`SELECT 1 FROM course c WHERE c.course_id = $2 AND ${AUTO_START_DUE}`, [date, courseId]);
            if (due.rows.length === 0) return false;
            await tx.update('course', { course_id: courseId }, { status: 'IN_PROGRESS' });
            return true;
          }),
        );
        if (changed) started.push(courseId);
      } catch (error) {
        failed.push({ courseId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { date, started, failed };
  }

  async suspend(request: RbacRequest, courseId: number, body: unknown) {
    await this.scope.requireCourse(request, courseId);
    const reason = reqStr(asObject(body), 'reason', 500); // V6
    return this.transition(courseId, ['PREPARING', 'RECRUITING', 'IN_PROGRESS'], 'SUSPENDED', reason);
  }

  // ── 종료 체크리스트 / 종료 (baseline 9절, decisions.md D-06·P1-03) ────────
  async closureChecklist(request: RbacRequest, courseId: number) {
    await this.scope.requireCourse(request, courseId);
    if ((await this.db.query(`SELECT 1 FROM course WHERE course_id = $1`, [courseId])).rows.length === 0) {
      throw new NotFoundException('대상을 찾을 수 없습니다.');
    }
    return { items: await this.computeClosureItems(this.db, courseId) };
  }

  async close(request: RbacRequest, courseId: number, body: unknown) {
    await this.scope.requireCourse(request, courseId);
    const o = body === undefined || body === null ? {} : asObject(body);
    const overrideReason = optStr(o, 'override_reason', 500) ?? undefined;

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'course', 'course_id', courseId);
      if (current.status !== 'IN_PROGRESS') {
        throw conflict('INVALID_STATE_TRANSITION', `${current.status as string} 상태의 과정은 CLOSED 로 전환할 수 없습니다.`);
      }
      const items = await this.computeClosureItems(tx, courseId);
      const blocked = items.filter((i) => i.classification === 'BLOCKING' && i.count > 0);
      if (blocked.length > 0) {
        throw conflict('CLOSURE_BLOCKED', `종료할 수 없습니다: ${blocked.map((i) => i.label).join(', ')}`);
      }
      const warned = items.filter((i) => i.classification === 'WARNING' && i.count > 0);
      if (warned.length > 0 && !overrideReason) {
        throw new BadRequestException({ code: 'VALIDATION', field: 'override_reason', message: `경고 항목이 있어 종료하려면 override_reason이 필요합니다: ${warned.map((i) => i.label).join(', ')}` });
      }
      const updated = await tx.update('course', { course_id: courseId }, { status: 'CLOSED' }, { reason: overrideReason });
      // baseline 9절: 종료 시점의 미해결 항목 스냅샷은 audit_log에 별도로 남긴다(course UPDATE 의 before/after 는 상태값만 담기 때문).
      await tx.query(
        `INSERT INTO audit_log (actor_type, actor_user_id, action, target_table, target_id, after_value, reason, ip_address) VALUES ($1, $2, 'UPDATE', 'course', $3, $4, $5, $6)`,
        [tx.actor.actorType, tx.actor.actorUserId, courseId, JSON.stringify({ closureChecklistSnapshot: items }), overrideReason ?? null, tx.actor.ip],
      );
      return toApi(updated);
    });
  }

  // S01 대시보드도 재사용한다(항목 1·2·4·5·6 합산) — 새 집계 로직을 만들지 않고 종료 체크리스트와 같은 계산을 공유.
  async computeClosureItems(db: Queryable, courseId: number): Promise<ClosureItem[]> {
    const count = async (sql: string, params: unknown[]): Promise<number> => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

    const item1 = await count(
      `SELECT count(*) n FROM class_schedule s
         JOIN trainee_enrollment te ON te.course_id = s.course_id AND te.status = 'CONFIRMED'
         LEFT JOIN attendance a ON a.schedule_id = s.schedule_id AND a.trainee_id = te.trainee_id
        WHERE s.course_id = $1 AND s.status <> 'CANCELLED'
          AND now() > ((s.class_date + s.end_time) AT TIME ZONE $2) AND a.attendance_id IS NULL`,
      [courseId, SCHEDULE_TIMEZONE],
    );
    const item2 = await count(
      `SELECT count(*) n FROM attendance a JOIN class_schedule s ON s.schedule_id = a.schedule_id
        WHERE s.course_id = $1 AND a.attendance_status IN ('PRESENT', 'LATE') AND a.check_out_time IS NULL`,
      [courseId],
    );
    const item3 = await count(`SELECT count(*) n FROM verification_case WHERE course_id = $1 AND status = ANY($2::verification_case_status[])`, [courseId, ACTIVE_STATUSES]);
    const item4 = await count(
      `SELECT count(*) n FROM class_schedule s
        WHERE s.course_id = $1 AND s.status <> 'CANCELLED' AND now() > ((s.class_date + s.end_time) AT TIME ZONE $2)
          AND NOT EXISTS (SELECT 1 FROM operation_log ol WHERE ol.schedule_id = s.schedule_id)`,
      [courseId, SCHEDULE_TIMEZONE],
    );
    const item5 = await count(
      `SELECT count(*) n FROM trainee_enrollment te
        WHERE te.course_id = $1 AND te.status = 'CONFIRMED'
          AND NOT EXISTS (SELECT 1 FROM submission s WHERE s.course_id = te.course_id AND s.trainee_id = te.trainee_id)`,
      [courseId],
    );
    const item6 = await count(`SELECT count(*) n FROM submission WHERE course_id = $1 AND review_status IN ('PENDING', 'REVISION_REQUESTED')`, [courseId]);
    const item7 = await count(`SELECT count(*) n FROM trainee_enrollment WHERE course_id = $1 AND status = 'CONFIRMED'`, [courseId]);
    const confirmedCount = await count(`SELECT count(*) n FROM trainee_enrollment WHERE course_id = $1 AND status = 'CONFIRMED'`, [courseId]);
    const scheduleCount = await count(`SELECT count(*) n FROM class_schedule WHERE course_id = $1`, [courseId]);
    const item8 = (confirmedCount === 0 ? 1 : 0) + (scheduleCount === 0 ? 1 : 0);

    return [
      { item: 1, label: '미출결 대상자', classification: 'BLOCKING', count: item1 },
      { item: 2, label: '퇴실 미확인 출결', classification: 'WARNING', count: item2 },
      { item: 3, label: '미종결 확인 필요 건', classification: 'BLOCKING', count: item3 },
      { item: 4, label: '운영일지 누락', classification: 'WARNING', count: item4 },
      { item: 5, label: '결과물 미제출', classification: 'WARNING', count: item5 },
      { item: 6, label: '결과물 미검토·보완 미해결', classification: 'WARNING', count: item6 },
      { item: 7, label: '확정 상태로 남은 등록 건', classification: 'WARNING', count: item7 },
      { item: 8, label: '필수 과정 데이터', classification: 'WARNING', count: item8 },
      { item: 9, label: '변경이력 존재 여부', classification: 'NOT_NEEDED', count: 0 },
    ];
  }

  private transition(courseId: number, from: string[], to: string, reason?: string, precheck?: (tx: AuditedTx) => Promise<void>) {
    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'course', 'course_id', courseId);
      if (!from.includes(current.status as string)) {
        throw conflict('INVALID_STATE_TRANSITION', `${current.status as string} 상태의 과정은 ${to} 로 전환할 수 없습니다.`);
      }
      await precheck?.(tx);
      return toApi(await tx.update('course', { course_id: courseId }, { status: to }, { reason }));
    });
  }

  // P1-18(2026-09-22 확정): 담당자는 활성 상태 + OPS_MANAGER 역할 보유자만 지정할 수 있다.
  private async assertManager(tx: AuditedTx, userId: number): Promise<void> {
    const { rows } = await tx.query(
      `SELECT u.status, bool_or(r.role_code = 'OPS_MANAGER') AS is_manager
         FROM user_account u LEFT JOIN user_role ur ON ur.user_id = u.user_id LEFT JOIN role r ON r.role_id = ur.role_id
        WHERE u.user_id = $1 GROUP BY u.status`,
      [userId],
    );
    if (rows.length === 0 || rows[0].status !== 'ACTIVE' || rows[0].is_manager !== true) {
      throw new BadRequestException({ code: 'INVALID_MANAGER', field: 'manager_user_id', message: 'OPS_MANAGER 역할을 가진 활성 사용자만 담당자로 지정할 수 있습니다' });
    }
  }
}

const invalidRange = () => new BadRequestException({ code: 'INVALID_DATE_RANGE', message: '종료일은 시작일보다 빠를 수 없습니다' });
