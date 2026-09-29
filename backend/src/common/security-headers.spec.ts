import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { securityHeaders } from './security-headers.js';

describe('securityHeaders', () => {
  it('nosniff·no-store 헤더를 붙이고 다음 핸들러로 넘긴다', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
    const next = vi.fn();
    securityHeaders({} as Request, res, next);
    expect(headers).toEqual({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    expect(next).toHaveBeenCalledOnce();
  });
});
