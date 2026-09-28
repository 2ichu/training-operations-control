import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import './pg-types.js';

export const PG_POOL = Symbol('PG_POOL');

// 연결은 첫 쿼리 시점에 맺어진다(부팅 시 접속하지 않음). DATABASE_URL 이 없으면 부팅 단계에서 실패한다.
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): pg.Pool =>
        new pg.Pool({
          connectionString: config.getOrThrow<string>('database.url'),
          max: config.get<number>('database.poolMax') ?? 10,
        }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
