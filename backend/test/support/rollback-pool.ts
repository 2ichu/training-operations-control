import pg from 'pg';

// 단일 연결 위에서 동작하는 pg.Pool 대역. 전체가 하나의 바깥 트랜잭션(BEGIN … ROLLBACK)이므로 테스트 데이터·감사로그가 DB 에 남지 않는다.
// 서비스가 pool.connect() 로 받은 클라이언트의 BEGIN/COMMIT/ROLLBACK 은 SAVEPOINT 로 바꿔 실행해 실제와 같은 원자성(부분 롤백)을 재현한다.
// failOn 을 지정하면 "트랜잭션 클라이언트"에서 해당 SQL 이 실행될 때 장애를 주입한다(풀 직접 조회는 영향 없음).
export class RollbackPool {
  failOn: RegExp | null = null;
  private seq = 0;

  constructor(readonly client: pg.Client) {}

  query(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.client.query(sql, params);
  }

  async connect() {
    const savepoints: string[] = [];
    return {
      query: async (sql: string, params?: unknown[]) => {
        const text = sql.trim().toUpperCase();
        if (text === 'BEGIN') {
          const name = `rb_${(this.seq += 1)}`;
          savepoints.push(name);
          return this.client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT') return this.client.query(`RELEASE SAVEPOINT ${savepoints.pop()!}`);
        if (text === 'ROLLBACK') {
          const name = savepoints.pop()!;
          await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return this.client.query(`RELEASE SAVEPOINT ${name}`);
        }
        if (this.failOn?.test(sql)) throw new Error(`injected failure: ${this.failOn}`);
        return this.client.query(sql, params);
      },
      release: () => undefined,
    };
  }

  async end(): Promise<void> {
    // 바깥 연결은 테스트가 직접 닫는다
  }
}
