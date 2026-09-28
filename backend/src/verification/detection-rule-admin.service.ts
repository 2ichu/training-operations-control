import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { toApi } from '../common/api.js';
import { conflict } from '../common/tx.js';
import { asObject, optBool, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';

// 파라미터 값 범위는 정책이 아니라 기술적 안전장치다(모든 규칙 파라미터가 건수·분·시간·일 단위의 양의 정수).
const PARAM_MIN = 1;
const PARAM_MAX = 100_000;

// S28 탐지규칙 파라미터 관리 (Phase 5, system-design STEP 8.4 "시스템 관리자가 detection_rule 화면에서 조정").
// 조정 대상은 params(기존 키의 값만)와 is_active 뿐이다. initial_status 는 D-11(규칙별 우선확인 미지정) 확정값이라 열지 않고,
// MANUAL 은 S18 수동 전환이 참조하는 고정 레코드라 수정할 수 없다. 변경된 값은 다음 탐지 실행부터 적용된다(기존 확인 건은 그대로).
@Injectable()
export class DetectionRuleAdminService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  async list() {
    const { rows } = await this.db.query(`SELECT * FROM detection_rule ORDER BY rule_code`);
    return { items: rows.map(present) };
  }

  async update(ruleId: number, body: unknown) {
    const o = asObject(body);
    const reason = reqStr(o, 'reason', 500);
    const isActive = optBool(o, 'is_active');
    const params = o.params;
    if (params === undefined && isActive === undefined) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'params 또는 is_active 중 하나 이상이 필요합니다' });
    }

    return this.transactions.run(async (tx) => {
      const { rows } = await tx.query(`SELECT * FROM detection_rule WHERE rule_id = $1 FOR UPDATE`, [ruleId]);
      const current = rows[0];
      if (!current) throw new NotFoundException('대상을 찾을 수 없습니다.');
      if (current.rule_code === 'MANUAL') throw conflict('RULE_NOT_EDITABLE', 'MANUAL 은 수동 전환용 고정 레코드라 수정할 수 없습니다.');

      const set: Row = {};
      if (params !== undefined) set.params = JSON.stringify(mergeParams(current.params as Record<string, number>, params));
      if (isActive !== undefined) set.is_active = isActive;
      return present(await tx.update('detection_rule', { rule_id: ruleId }, set, { reason }));
    });
  }
}

// 기존 키의 값만 바꿀 수 있다(부분 갱신 허용). 새 키 추가·삭제는 규칙 로직 변경이라 여기서 받지 않는다.
export function mergeParams(current: Record<string, number>, input: unknown): Record<string, number> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException({ code: 'VALIDATION', field: 'params', message: '객체여야 합니다' });
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) throw new BadRequestException({ code: 'VALIDATION', field: 'params', message: '변경할 파라미터가 없습니다' });
  const merged = { ...current };
  for (const [key, value] of entries) {
    if (!Object.hasOwn(current, key)) {
      throw new BadRequestException({ code: 'VALIDATION', field: `params.${key}`, message: `알 수 없는 파라미터입니다(허용: ${Object.keys(current).join(', ')})` });
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < PARAM_MIN || value > PARAM_MAX) {
      throw new BadRequestException({ code: 'VALIDATION', field: `params.${key}`, message: `${PARAM_MIN}~${PARAM_MAX} 사이의 정수여야 합니다` });
    }
    merged[key] = value;
  }
  return merged;
}

const present = (row: Row) => ({ ...toApi(row), editable: row.rule_code !== 'MANUAL' });
