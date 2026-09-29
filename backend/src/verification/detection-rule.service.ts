import { Inject, Injectable } from '@nestjs/common';
import { AuditContext } from '../audit/audit-context.js';
import { type AuditedTx, AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';
import { ACTIVE_STATUSES } from './verification.constants.js';

interface RuleMatch {
  courseId: number;
  dedupeKey: string;
  items: Row[]; // 각 항목은 병합 판단용 고유 id 를 가진다(merge-by-id)
  traineeAttendance: Map<number, number | null>; // traineeId -> 대표 attendance_id(없으면 null)
}

export interface RuleRunResult {
  skipped: boolean;
  casesCreated: number;
  casesUpdated: number;
}

// 탐지 엔진: RULE_03~06(배치) + RULE_07(공식 출결 업로드 시 recordOfficialMismatch 로 호출, D-12 확정).
// RULE_01(동일 단말)·RULE_02(출결 채널)는 도입하지 않는다 — 출결은 등록 단말에 종속되지 않고 여러 기기로 자유롭게 입력되어
// 신뢰할 수 있는 단말 식별자가 없다(2026-09-29 결정, decisions.md P7-01). device_id·channel 값은 판단 근거로 쓰지 않는다.
// HTTP 라우트는 없다. RULE_03~06 은 BatchSchedulerService(baseline 6절 시점표)가 호출하고, 테스트는 직접 호출한다.
// 행위자는 runAsSystem('SYSTEM_RULE', ruleCode) 로 태깅한다(기존 audit-tx 선례, src/audit/audit-context.ts 참고).
@Injectable()
export class DetectionRuleService {
  constructor(
    @Inject(AuditContext) private readonly auditContext: AuditContext,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  async runRule03(): Promise<RuleRunResult> {
    return this.withRule('RULE_03', async (tx, rule) => {
      const params = rule.params as { delay_hours: number };
      const { rows: matches } = await tx.query(
        `SELECT s.schedule_id, s.course_id, ((s.class_date + s.end_time) AT TIME ZONE $2) AS ended_at
           FROM class_schedule s
          WHERE s.status <> 'CANCELLED'
            AND now() > ((s.class_date + s.end_time) AT TIME ZONE $2) + ($1 || ' hours')::interval
            AND NOT EXISTS (SELECT 1 FROM operation_log ol WHERE ol.schedule_id = s.schedule_id)`,
        [params.delay_hours, SCHEDULE_TIMEZONE],
      );
      let casesCreated = 0;
      let casesUpdated = 0;
      for (const m of matches) {
        const dedupeKey = `${m.schedule_id}`;
        const elapsedHours = (Date.now() - new Date(m.ended_at as string).getTime()) / 3_600_000;
        const { created } = await this.upsertCase(tx, rule, {
          courseId: Number(m.course_id),
          dedupeKey,
          items: [{ id: dedupeKey, schedule_id: Number(m.schedule_id), ended_at: m.ended_at, elapsed_hours: Math.round(elapsedHours * 10) / 10 }],
          traineeAttendance: new Map(), // 훈련생 무관(회차 단위 운영 이슈)
        });
        created ? (casesCreated += 1) : (casesUpdated += 1);
      }
      return { casesCreated, casesUpdated };
    });
  }

  async runRule04(): Promise<RuleRunResult> {
    return this.withRule('RULE_04', async (tx, rule) => {
      const params = rule.params as { delay_hours: number };
      const { rows: matches } = await tx.query(
        `SELECT a.attendance_id, a.trainee_id, s.schedule_id, s.course_id
           FROM attendance a JOIN class_schedule s ON s.schedule_id = a.schedule_id
          WHERE s.status <> 'CANCELLED'
            AND a.attendance_status IN ('PRESENT', 'LATE')
            AND a.check_out_time IS NULL
            AND now() > ((s.class_date + s.end_time) AT TIME ZONE $2) + ($1 || ' hours')::interval`,
        [params.delay_hours, SCHEDULE_TIMEZONE],
      );
      let casesCreated = 0;
      let casesUpdated = 0;
      for (const m of matches) {
        const dedupeKey = `${m.attendance_id}`;
        const { created } = await this.upsertCase(tx, rule, {
          courseId: Number(m.course_id),
          dedupeKey,
          items: [{ id: dedupeKey, attendance_id: Number(m.attendance_id), schedule_id: Number(m.schedule_id), trainee_id: Number(m.trainee_id) }],
          traineeAttendance: new Map([[Number(m.trainee_id), Number(m.attendance_id)]]),
        });
        created ? (casesCreated += 1) : (casesUpdated += 1);
      }
      return { casesCreated, casesUpdated };
    });
  }

  async runRule05(): Promise<RuleRunResult> {
    return this.withRule('RULE_05', async (tx, rule) => {
      const params = rule.params as { window_days: number; min_changes: number };
      const windowStart = new Date(Date.now() - params.window_days * 86_400_000).toISOString().slice(0, 10);
      const { rows: logs } = await tx.query(
        `SELECT l.log_id, l.trainee_id, l.attendance_id, l.changed_at, l.before_value, l.after_value, s.course_id
           FROM attendance_change_log l JOIN attendance a ON a.attendance_id = l.attendance_id JOIN class_schedule s ON s.schedule_id = a.schedule_id
          WHERE l.actor_type = 'USER' AND l.changed_at >= $1::date
          ORDER BY l.trainee_id, l.log_id`,
        [windowStart],
      );
      const byTrainee = new Map<number, Row[]>();
      for (const l of logs) {
        const traineeId = Number(l.trainee_id);
        (byTrainee.get(traineeId) ?? byTrainee.set(traineeId, []).get(traineeId)!).push(l);
      }
      let casesCreated = 0;
      let casesUpdated = 0;
      for (const [traineeId, entries] of byTrainee) {
        if (entries.length < params.min_changes) continue;
        const last = entries[entries.length - 1];
        const dedupeKey = `${traineeId}:${windowStart}`;
        const { created } = await this.upsertCase(tx, rule, {
          courseId: Number(last.course_id),
          dedupeKey,
          items: entries.map((l) => ({ id: `log:${l.log_id}`, log_id: Number(l.log_id), changed_at: l.changed_at, before: l.before_value, after: l.after_value })),
          traineeAttendance: new Map([[traineeId, Number(last.attendance_id)]]),
        });
        created ? (casesCreated += 1) : (casesUpdated += 1);
      }
      return { casesCreated, casesUpdated };
    });
  }

  async runRule06(): Promise<RuleRunResult> {
    return this.withRule('RULE_06', async (tx, rule) => {
      const params = rule.params as { window_days: number; min_flips: number };
      const windowStart = new Date(Date.now() - params.window_days * 86_400_000).toISOString().slice(0, 10);
      const { rows: logs } = await tx.query(
        `SELECT l.log_id, l.trainee_id, l.attendance_id, l.changed_at, l.before_value, l.after_value, s.course_id
           FROM attendance_change_log l JOIN attendance a ON a.attendance_id = l.attendance_id JOIN class_schedule s ON s.schedule_id = a.schedule_id
          WHERE l.actor_type = 'USER' AND l.changed_at >= $1::date
          ORDER BY l.trainee_id, l.log_id`,
        [windowStart],
      );
      const byGroup = new Map<string, { traineeId: number; entries: Row[] }>();
      for (const l of logs) {
        const traineeId = Number(l.trainee_id);
        const before = (l.before_value as Row)?.attendance_status as string | undefined;
        const after = (l.after_value as Row)?.attendance_status as string | undefined;
        if (!before || !after || before === after) continue;
        const combo = [before, after].sort().join('|');
        const key = `${traineeId}:${combo}`;
        const group = byGroup.get(key) ?? { traineeId, entries: [] };
        group.entries.push(l);
        byGroup.set(key, group);
      }
      let casesCreated = 0;
      let casesUpdated = 0;
      for (const [key, { traineeId, entries }] of byGroup) {
        if (entries.length < params.min_flips) continue;
        const last = entries[entries.length - 1];
        const { created } = await this.upsertCase(tx, rule, {
          courseId: Number(last.course_id),
          dedupeKey: key,
          items: entries.map((l) => ({ id: `log:${l.log_id}`, log_id: Number(l.log_id), changed_at: l.changed_at, before: l.before_value, after: l.after_value })),
          traineeAttendance: new Map([[traineeId, Number(last.attendance_id)]]),
        });
        created ? (casesCreated += 1) : (casesUpdated += 1);
      }
      return { casesCreated, casesUpdated };
    });
  }

  // RULE_07 공식-내부 정보 불일치(D-12 확정): 다른 규칙과 달리 배치가 아니라 공식 출결 업로드(S29) 처리 중 호출된다.
  // 호출한 트랜잭션 안에서 건을 만들거나 근거만 누적한다(attendance 는 절대 자동으로 덮어쓰지 않는다 — STEP 8.2).
  // 규칙이 꺼져 있으면 건을 만들지 않고 null 을 돌려준다. dedupe 키는 attendance_id, 근거 항목 id 는 공식값 내용이라
  // 같은 파일을 다시 올려도 근거가 중복되지 않는다.
  async recordOfficialMismatch(
    tx: AuditedTx,
    input: { courseId: number; traineeId: number; attendanceId: number; scheduleId: number; official: Row; internal: Row },
  ): Promise<{ caseId: number; created: boolean; toleranceMinutes: number } | null> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['detection:RULE_07']);
    const { rows } = await tx.query(`SELECT * FROM detection_rule WHERE rule_code = 'RULE_07'`);
    const rule = rows[0];
    if (!rule || rule.is_active !== true) return null;
    const toleranceMinutes = Number((rule.params as { tolerance_minutes: number }).tolerance_minutes);
    const dedupeKey = String(input.attendanceId);
    const itemId = `official:${input.attendanceId}:${JSON.stringify(input.official)}`;
    const { created, caseId } = await this.upsertCase(tx, rule, {
      courseId: input.courseId,
      dedupeKey,
      items: [{ id: itemId, schedule_id: input.scheduleId, official: input.official, internal: input.internal, tolerance_minutes: toleranceMinutes }],
      traineeAttendance: new Map([[input.traineeId, input.attendanceId]]),
    });
    return { caseId, created, toleranceMinutes };
  }

  // ── 내부 헬퍼 ───────────────────────────────────────────────────────────
  // 같은 규칙의 실행은 트랜잭션 단위 advisory lock 으로 직렬화한다. 배치와 출결 이벤트가 겹치거나 여러 인스턴스가 동시에
  // 실행해도 upsertCase() 의 "활성 건 조회 → 없으면 생성"이 경합해 같은 dedupe_key 의 건이 두 번 생기지 않게 하기 위함이다.
  // 규칙 행(파라미터·is_active)은 잠금을 얻은 뒤 읽어 S28 에서 방금 바뀐 값이 바로 반영된다.
  private async withRule(ruleCode: string, fn: (tx: AuditedTx, rule: Row) => Promise<{ casesCreated: number; casesUpdated: number }>): Promise<RuleRunResult> {
    return this.auditContext.runAsSystem('SYSTEM_RULE', ruleCode, () =>
      this.transactions.run(async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`detection:${ruleCode}`]);
        const { rows } = await tx.query(`SELECT * FROM detection_rule WHERE rule_code = $1`, [ruleCode]);
        const rule = rows[0];
        if (!rule || rule.is_active !== true) return { skipped: true, casesCreated: 0, casesUpdated: 0 };
        return { skipped: false, ...(await fn(tx, rule)) };
      }),
    );
  }

  // 활성(미종결) 건 중 같은 규칙·같은 dedupe_key 가 있으면 근거만 병합하고, 없으면 새로 생성한다(baseline 8.4 중복 방지 원칙).
  private async upsertCase(tx: AuditedTx, rule: Row, match: RuleMatch): Promise<{ created: boolean; caseId: number }> {
    const found = await tx.query(
      `SELECT case_id, evidence FROM verification_case WHERE detection_rule_id = $1 AND status = ANY($2::verification_case_status[]) AND evidence->>'dedupe_key' = $3 FOR UPDATE`,
      [rule.rule_id, ACTIVE_STATUSES, match.dedupeKey],
    );
    if (found.rows.length === 0) {
      const created = await tx.create('verification_case', {
        course_id: match.courseId,
        detection_rule_id: rule.rule_id,
        detected_at: new Date().toISOString(),
        evidence: JSON.stringify({ dedupe_key: match.dedupeKey, items: match.items }),
        status: rule.initial_status,
      });
      const caseId = Number(created.case_id);
      for (const [traineeId, attendanceId] of match.traineeAttendance) await this.linkTrainee(tx, caseId, traineeId, attendanceId);
      return { created: true, caseId };
    }
    const current = found.rows[0];
    const caseId = Number(current.case_id);
    const evidence = current.evidence as { dedupe_key: string; items: Row[] };
    const merged = mergeItems(evidence.items, match.items);
    if (merged.changed) await tx.update('verification_case', { case_id: caseId }, { evidence: JSON.stringify({ dedupe_key: match.dedupeKey, items: merged.items }) });
    const linked = await tx.query(`SELECT trainee_id FROM verification_case_trainee WHERE case_id = $1`, [caseId]);
    const already = new Set(linked.rows.map((r) => Number(r.trainee_id)));
    // baseline 7-22행("확인 건 근거 추가·훈련생 추가"): 기존 활성 건에 훈련생을 추가로 연결할 때는 verification_case_trainee 도
    // 별도 감사 대상이다(7-21행의 최초 생성 시점과 다름 — 그때는 verification_case 생성 감사만 남긴다).
    for (const [traineeId, attendanceId] of match.traineeAttendance) if (!already.has(traineeId)) await this.linkTraineeAudited(tx, caseId, traineeId, attendanceId);
    return { created: false, caseId };
  }

  // 신규 건 생성 시 최초 훈련생 연결(감사 없음 — baseline 7-21·7-21-1행: 이 시점엔 verification_case 생성만 감사 대상).
  private async linkTrainee(tx: AuditedTx, caseId: number, traineeId: number, attendanceId: number | null): Promise<void> {
    await tx.query(
      `INSERT INTO verification_case_trainee (case_id, trainee_id, attendance_id, created_by) VALUES ($1, $2, $3, $4)`,
      [caseId, traineeId, attendanceId, tx.actor.actorUserId],
    );
  }

  // baseline 7-22행 대상 삽입은 tx.create() 로 감사까지 함께 남긴다(user_role 과 동일하게 자연키를 그대로 넘김 — create() 는
  // update() 와 달리 PK 직접 지정을 막지 않는다). reason 은 systemTag(예: RULE_04)가 auditBase() 에서 자동으로 채워진다.
  private async linkTraineeAudited(tx: AuditedTx, caseId: number, traineeId: number, attendanceId: number | null): Promise<void> {
    await tx.create('verification_case_trainee', { case_id: caseId, trainee_id: traineeId, attendance_id: attendanceId });
  }
}

// evidence.items 를 항목의 id 로 병합한다: 같은 id 가 있으면 내용이 바뀐 경우만 갱신, 없으면 추가(재실행 시 무변화면 완전히 멱등).
function mergeItems(existing: Row[], incoming: Row[]): { items: Row[]; changed: boolean } {
  const items = [...existing];
  const indexById = new Map(items.map((it, i) => [it.id as string, i]));
  let changed = false;
  for (const item of incoming) {
    const idx = indexById.get(item.id as string);
    if (idx === undefined) {
      indexById.set(item.id as string, items.length);
      items.push(item);
      changed = true;
    } else if (JSON.stringify(items[idx]) !== JSON.stringify(item)) {
      items[idx] = item;
      changed = true;
    }
  }
  return { items, changed };
}
