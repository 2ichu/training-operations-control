import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

// 풀은 첫 쿼리 전까지 접속하지 않으므로 더미 값으로 부팅만 검증한다
process.env.DATABASE_URL ??= 'postgres://localhost:5432/e2e_placeholder';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) — 로그인 없이 호출, DB 에 닿지 않으면 503(업무 정보는 노출하지 않음)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|password|ECONN/i);
  });

  afterEach(async () => {
    await app.close();
  });
});
