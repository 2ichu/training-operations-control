import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';

describe('AppController 헬스체크', () => {
  it('DB 에 질의되면 ok', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(new AppController(db as never).health()).resolves.toEqual({ status: 'ok' });
    expect(db.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('DB 에 닿지 않으면 503', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    await expect(new AppController(db as never).health()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
