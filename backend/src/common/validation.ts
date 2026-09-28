import { BadRequestException } from '@nestjs/common';

export type Obj = Record<string, unknown>;

const fail = (field: string, message: string): never => {
  throw new BadRequestException({ code: 'VALIDATION', field, message: `${field}: ${message}` });
};

export function asObject(body: unknown, what = '요청 본문'): Obj {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(what, '객체여야 합니다');
  return body as Obj;
}

export function reqStr(o: Obj, key: string, max: number): string {
  const v = o[key];
  if (typeof v !== 'string' || v.trim().length === 0) return fail(key, '필수 문자열입니다');
  const s = v.trim();
  if (s.length > max) fail(key, `${max}자 이하여야 합니다`);
  return s;
}

/** 없으면 undefined, null 또는 빈 문자열이면 null */
export function optStr(o: Obj, key: string, max: number): string | null | undefined {
  if (!(key in o) || o[key] === undefined) return undefined;
  const v = o[key];
  if (v === null) return null;
  if (typeof v !== 'string') return fail(key, '문자열이어야 합니다');
  const s = v.trim();
  if (s.length === 0) return null;
  if (s.length > max) fail(key, `${max}자 이하여야 합니다`);
  return s;
}

export function reqInt(o: Obj, key: string, min = 1): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) return fail(key, `${min} 이상의 정수여야 합니다`);
  return v;
}

export function optInt(o: Obj, key: string, min = 1): number | null | undefined {
  if (!(key in o) || o[key] === undefined) return undefined;
  if (o[key] === null) return null;
  return reqInt(o, key, min);
}

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function reqDate(o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || !isValidDate(v)) return fail(key, 'YYYY-MM-DD 형식의 유효한 날짜여야 합니다');
  return v;
}

export function optDate(o: Obj, key: string): string | null | undefined {
  if (!(key in o) || o[key] === undefined) return undefined;
  if (o[key] === null) return null;
  return reqDate(o, key);
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
export function reqTime(o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || !TIME.test(v)) return fail(key, 'HH:MM 형식의 유효한 시각이어야 합니다');
  return v.length === 5 ? `${v}:00` : v;
}

export function optTime(o: Obj, key: string): string | undefined {
  if (!(key in o) || o[key] === undefined) return undefined;
  return reqTime(o, key);
}

export function optBool(o: Obj, key: string): boolean | undefined {
  if (!(key in o) || o[key] === undefined) return undefined;
  if (typeof o[key] !== 'boolean') return fail(key, 'true/false 여야 합니다');
  return o[key] as boolean;
}

export function reqIso(o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return fail(key, 'ISO 8601 일시여야 합니다');
  return v;
}

export function optIso(o: Obj, key: string): string | undefined {
  if (!(key in o) || o[key] === undefined) return undefined;
  return reqIso(o, key);
}

// ── 쿼리스트링 ────────────────────────────────────────────────────────────
export function qStr(q: Obj, key: string, max = 100): string | undefined {
  const v = q[key];
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string') return fail(key, '문자열이어야 합니다');
  if (v.length > max) fail(key, `${max}자 이하여야 합니다`);
  return v;
}

export function qInt(q: Obj, key: string, min = 1): number | undefined {
  const v = qStr(q, key, 20);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < min) return fail(key, `${min} 이상의 정수여야 합니다`);
  return Number(v);
}

export function qDate(q: Obj, key: string): string | undefined {
  const v = qStr(q, key, 10);
  if (v === undefined) return undefined;
  if (!isValidDate(v)) return fail(key, 'YYYY-MM-DD 형식이어야 합니다');
  return v;
}

export function qEnumList<T extends string>(q: Obj, key: string, allowed: readonly T[]): T[] | undefined {
  const v = qStr(q, key, 200);
  if (v === undefined) return undefined;
  const items = v.split(',').map((s) => s.trim());
  for (const item of items) if (!(allowed as readonly string[]).includes(item)) fail(key, `허용되지 않는 값: ${item}`);
  return items as T[];
}

export function oneOf<T extends string>(value: unknown, key: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return fail(key, `${allowed.join(', ')} 중 하나여야 합니다`);
  return value as T;
}

export function reqIntArray(o: Obj, key: string, min = 1): number[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length === 0) return fail(key, '비어있지 않은 배열이어야 합니다');
  return v.map((item, i) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < min) return fail(`${key}[${i}]`, `${min} 이상의 정수여야 합니다`);
    return item;
  });
}

export function optObj(o: Obj, key: string): Obj | undefined {
  if (!(key in o) || o[key] === undefined || o[key] === null) return undefined;
  return asObject(o[key], key);
}

export function optIntArray(o: Obj, key: string, min = 1): number[] | undefined {
  if (!(key in o) || o[key] === undefined) return undefined;
  const v = o[key];
  if (!Array.isArray(v)) return fail(key, '배열이어야 합니다');
  return v.map((item, i) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < min) return fail(`${key}[${i}]`, `${min} 이상의 정수여야 합니다`);
    return item;
  });
}

export function parseId(raw: string, name = 'id'): number {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return fail(name, '양의 정수여야 합니다');
  return Number(raw);
}
