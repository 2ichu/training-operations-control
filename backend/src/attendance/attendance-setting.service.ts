import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { toApi } from '../common/api.js';
import { asObject, type Obj, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';

// 유예분 범위는 정책이 아니라 기술적 안전장치다(DB CHECK 와 동일). 0 은 "유예 없음"(1분이라도 늦으면 지각).
export const GRACE_MIN = 0;
export const GRACE_MAX = 240;
const KEYS = ['late_grace_minutes', 'early_leave_grace_minutes'] as const;

export interface AttendanceGrace {
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
}

// D-08 확정(자동 판정, 유예 10분): 지각·조퇴 판정 유예분 설정. S28 에서 SYS_ADMIN 이 사유와 함께 조정한다.
// 변경값은 이후 입실·퇴실 확인부터 적용되고, 이미 저장된 출결 상태는 다시 판정하지 않는다(생성 시 상태 확정).
@Injectable()
export class AttendanceSettingService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  async get() {
    const { rows } = await this.db.query(`SELECT * FROM attendance_setting WHERE setting_id = 1`);
    return present(rows[0]);
  }

  async update(body: unknown) {
    const o = asObject(body);
    const reason = reqStr(o, 'reason', 500);
    const set = parseGrace(o);
    return this.transactions.run(async (tx) => present(await tx.update('attendance_setting', { setting_id: 1 }, set, { reason })));
  }
}

export function parseGrace(o: Obj): Row {
  const set: Row = {};
  for (const key of KEYS) {
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < GRACE_MIN || v > GRACE_MAX) {
      throw new BadRequestException({ code: 'VALIDATION', field: key, message: `${GRACE_MIN}~${GRACE_MAX} 사이의 정수(분)여야 합니다` });
    }
    set[key] = v;
  }
  if (Object.keys(set).length === 0) {
    throw new BadRequestException({ code: 'VALIDATION', message: `${KEYS.join(' 또는 ')} 중 하나 이상이 필요합니다` });
  }
  return set;
}

const present = (row: Row) => toApi(row) as unknown as AttendanceGrace & { settingId: number };
