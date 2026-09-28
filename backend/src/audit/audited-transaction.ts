import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../database/database.module.js';
import { type ActorContext, AuditContext, AuditedTxError } from './audit-context.js';
import { AuditLogService } from './audit-log.service.js';
import { AUDITABLE_TABLES, type AuditableTable } from './audit-registry.js';

export type TxClient = Pick<pg.PoolClient, 'query'>;
export type Row = Record<string, unknown>;

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const AUDIT_COLUMNS = ['created_at', 'created_by', 'updated_at', 'updated_by'];
const MAX_REASON = 500;

export interface WriteOptions {
  /** 변경 사유. 전용 변경이력(*_change_log) 대상 테이블의 UPDATE 에서는 필수 */
  reason?: string;
}

// 로그에 남길 행: 민감 컬럼은 값을 제거하고, 개인정보 컬럼은 마스킹한다
export function sanitizeRow(def: AuditableTable, row: Row): Row {
  const out: Row = { ...row };
  for (const column of def.redact ?? []) if (column in out) out[column] = '[REDACTED]';
  for (const [column, mask] of Object.entries(def.mask ?? {})) if (column in out) out[column] = mask(out[column]);
  return out;
}

// 하나의 DB 트랜잭션 안에서 "원본 변경 → (전용 변경이력) → 감사로그"를 수행한다.
// 이 중 하나라도 실패하면 예외가 전파되어 호출한 AuditedTransactionService 가 전체를 ROLLBACK 한다.
export class AuditedTx {
  constructor(
    private readonly client: TxClient,
    readonly actor: ActorContext,
    private readonly audit: Pick<AuditLogService, 'record'>,
  ) {}

  /** 조회·조인용(업무 데이터를 직접 바꾸는 쿼리는 create/update 를 사용해야 감사가 보장된다) */
  query<T extends pg.QueryResultRow = Row>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.client.query<T>(sql, params);
  }

  async create(table: string, values: Row, options: WriteOptions = {}): Promise<Row> {
    const def = this.def(table);
    const columns = Object.keys(values);
    this.assertColumns(columns, AUDIT_COLUMNS);
    const data: Row = { ...values, ...this.auditColumnValues(def, 'create') };
    const names = Object.keys(data);
    const inserted = await this.client.query(
      `INSERT INTO "${table}" (${names.map((c) => `"${c}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      names.map((c) => data[c]),
    );
    const after = inserted.rows[0] as Row;
    await this.audit.record(
      { ...this.auditBase(options), action: 'CREATE', targetTable: table, targetId: this.targetId(def, after), after: sanitizeRow(def, after) },
      this.client,
    );
    return after;
  }

  async update(table: string, key: Row, set: Row, options: WriteOptions = {}): Promise<Row> {
    const def = this.def(table);
    this.assertKey(def, key);
    const columns = Object.keys(set);
    if (columns.length === 0) throw new AuditedTxError('INVALID', '변경할 컬럼이 없습니다');
    this.assertColumns(columns, [...AUDIT_COLUMNS, ...def.pk]);
    const reason = this.requireReasonIfNeeded(def, options);

    const where = def.pk.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
    const keyValues = def.pk.map((c) => key[c]);
    // 행 잠금으로 before 값이 UPDATE 시점의 값과 일치하도록 보장한다
    const found = await this.client.query(`SELECT * FROM "${table}" WHERE ${where} FOR UPDATE`, keyValues);
    const before = found.rows[0] as Row | undefined;
    if (!before) throw new AuditedTxError('NOT_FOUND', `${table} 대상을 찾을 수 없습니다`);

    const data: Row = { ...set, ...this.auditColumnValues(def, 'update') };
    const names = Object.keys(data);
    const updated = await this.client.query(
      `UPDATE "${table}" SET ${names.map((c, i) => `"${c}" = $${def.pk.length + i + 1}`).join(', ')} WHERE ${where} RETURNING *`,
      [...keyValues, ...names.map((c) => data[c])],
    );
    const after = updated.rows[0] as Row;
    const beforeLog = sanitizeRow(def, before);
    const afterLog = sanitizeRow(def, after);

    if (def.changeLog) {
      await this.client.query(
        `INSERT INTO ${def.changeLog.table} (entity_type, entity_id, changed_by, before_value, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
        [def.changeLog.entityType, this.targetId(def, after), this.actor.actorUserId, JSON.stringify(beforeLog), JSON.stringify(afterLog), reason],
      );
    }
    await this.audit.record(
      { ...this.auditBase(options), action: 'UPDATE', targetTable: table, targetId: this.targetId(def, after), before: beforeLog, after: afterLog },
      this.client,
    );
    return after;
  }

  private def(table: string): AuditableTable {
    const def = Object.hasOwn(AUDITABLE_TABLES, table) ? AUDITABLE_TABLES[table] : undefined;
    if (!def) throw new AuditedTxError('INVALID', `감사 대상으로 등록되지 않은 테이블: ${table}`);
    return def;
  }

  private assertColumns(columns: string[], forbidden: string[]): void {
    for (const c of columns) {
      if (!IDENTIFIER.test(c)) throw new AuditedTxError('INVALID', `잘못된 컬럼명: ${c}`);
      if (forbidden.includes(c)) throw new AuditedTxError('INVALID', `직접 지정할 수 없는 컬럼: ${c}`);
    }
  }

  private assertKey(def: AuditableTable, key: Row): void {
    const keys = Object.keys(key);
    if (keys.length !== def.pk.length || !def.pk.every((c) => c in key && key[c] !== undefined && key[c] !== null)) {
      throw new AuditedTxError('INVALID', `기본키(${def.pk.join(', ')})를 모두 지정해야 합니다`);
    }
  }

  private requireReasonIfNeeded(def: AuditableTable, options: WriteOptions): string | null {
    if (!def.changeLog) return null;
    // 전용 변경이력은 changed_by(사람)와 사유가 필수이므로 어떤 쓰기도 하기 전에 검증한다
    if (this.actor.actorType !== 'USER') throw new AuditedTxError('INVALID', '전용 변경이력 대상 테이블은 사람 행위자만 수정할 수 있습니다');
    const reason = options.reason?.trim();
    if (!reason) throw new AuditedTxError('INVALID', '변경 사유가 필요합니다');
    if (reason.length > MAX_REASON) throw new AuditedTxError('INVALID', `변경 사유는 ${MAX_REASON}자 이하여야 합니다`);
    return reason;
  }

  private auditColumnValues(def: AuditableTable, mode: 'create' | 'update'): Row {
    if (def.auditColumns === 'none') return {};
    const userId = this.actor.actorUserId; // 시스템 행위자는 NULL
    if (def.auditColumns === 'created') return mode === 'create' ? { created_by: userId } : {};
    return mode === 'create' ? { created_by: userId, updated_by: userId } : { updated_by: userId };
  }

  private auditBase(options: WriteOptions): { actorType: ActorContext['actorType']; actorUserId: number | null; reason: string | null; ip: string | null } {
    const { actorType, actorUserId, ip, systemTag } = this.actor;
    const reason = actorType === 'USER' ? options.reason?.trim() || null : [systemTag, options.reason?.trim()].filter(Boolean).join(': ');
    return { actorType, actorUserId, reason: reason ? reason.slice(0, MAX_REASON) : null, ip };
  }

  private targetId(def: AuditableTable, row: Row): number {
    return Number(row[def.pk[0]]);
  }
}

// 트랜잭션 경계. 행위자 컨텍스트(AuditContext)가 없으면 시작하지 않는다.
//  - 기본: 풀에서 연결을 받아 BEGIN … COMMIT, 실패 시 ROLLBACK
//  - client 지정: 이미 열린 트랜잭션 안에서 SAVEPOINT 로 동일한 원자성을 제공(중첩 호출·롤백되는 테스트용)
@Injectable()
export class AuditedTransactionService {
  private savepointSeq = 0;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pick<pg.Pool, 'connect'>,
    @Inject(AuditContext) private readonly context: AuditContext,
    @Inject(AuditLogService) private readonly audit: Pick<AuditLogService, 'record'>,
  ) {}

  async run<T>(work: (tx: AuditedTx) => Promise<T>, options: { client?: TxClient } = {}): Promise<T> {
    const actor = this.context.require();

    if (options.client) {
      const client = options.client;
      const savepoint = `sp_audited_${(this.savepointSeq += 1)}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work(new AuditedTx(client, actor, this.audit));
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const result = await work(new AuditedTx(client, actor, this.audit));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    } finally {
      client.release();
    }
  }
}
