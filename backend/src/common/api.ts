import { type Obj, qInt } from './validation.js';

const camel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

// DB 행(snake_case) → API 응답(camelCase). *_id·*_by·*_count 는 숫자로 변환한다(pg 는 BIGINT 를 문자열로 돌려준다).
export function toApi<T = Obj>(row: Obj): T {
  const out: Obj = {};
  for (const [key, value] of Object.entries(row)) {
    const isNumeric = (key.endsWith('_id') || key.endsWith('_by') || key.endsWith('_count') || key === 'total') && typeof value === 'string' && /^\d+$/.test(value);
    out[camel(key)] = isNumeric ? Number(value) : value;
  }
  return out as T;
}

export interface Page {
  page: number;
  size: number;
  offset: number;
}

export function pageOf(q: Obj): Page {
  const page = qInt(q, 'page') ?? 1;
  const size = Math.min(qInt(q, 'size') ?? 20, 100);
  return { page, size, offset: (page - 1) * size };
}

export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 동적 WHERE 조립: 값은 항상 파라미터로 전달한다 */
export class Where {
  readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  add(build: (placeholder: string) => string, value: unknown): void {
    this.params.push(value);
    this.clauses.push(build(`$${this.params.length}`));
  }

  /** ScopeService 의 필터(SQL + 파라미터)를 추가한다 */
  addFilter(build: (nextIndex: number) => { sql: string; params: unknown[] }): void {
    const f = build(this.params.length + 1);
    this.params.push(...f.params);
    this.clauses.push(f.sql);
  }

  get sql(): string {
    return this.clauses.length ? this.clauses.join(' AND ') : 'TRUE';
  }
}
