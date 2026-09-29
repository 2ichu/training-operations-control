import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from './database/database.module.js';

// 헬스체크(로그인 불필요): 프로세스가 떠 있고 DB 에 질의할 수 있는지만 확인한다. 로드밸런서·컨테이너 헬스체크용.
// 업무 데이터나 버전 정보는 돌려주지 않는다.
@Controller()
export class AppController {
  constructor(@Inject(PG_POOL) private readonly db: pg.Pool) {}

  @Get('health')
  async health(): Promise<{ status: 'ok' }> {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ code: 'DB_UNAVAILABLE', message: '데이터베이스에 연결할 수 없습니다' });
    }
    return { status: 'ok' };
  }
}
