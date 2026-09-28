export const SESSION_STORE = Symbol('SESSION_STORE');

export interface SessionData {
  userId: number;
  loginId: string;
  name: string;
  roles: string[];
  linkedInstructorId: number | null;
  ip: string | null;
  createdAt: number;
  lastActiveAt: number;
}

export interface SessionStore {
  set(key: string, data: SessionData): void;
  get(key: string): SessionData | undefined;
  delete(key: string): void;
  deleteWhere(predicate: (data: SessionData) => boolean): number;
  purgeExpired(isExpired: (data: SessionData) => boolean): void;
}

// 세션 저장소 인터페이스의 기본 구현(프로세스 메모리). 재시작 시 세션이 사라지고 다중 인스턴스에서 공유되지 않는다.
// DB·Redis 저장소로 바꾸려면 이 인터페이스만 구현하면 된다(DB 저장은 baseline 에 없는 테이블이 필요하므로 별도 결정 사항).
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionData>();

  set(key: string, data: SessionData): void {
    this.sessions.set(key, data);
  }

  get(key: string): SessionData | undefined {
    return this.sessions.get(key);
  }

  delete(key: string): void {
    this.sessions.delete(key);
  }

  deleteWhere(predicate: (data: SessionData) => boolean): number {
    let removed = 0;
    for (const [key, data] of this.sessions) {
      if (predicate(data)) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  purgeExpired(isExpired: (data: SessionData) => boolean): void {
    for (const [key, data] of this.sessions) {
      if (isExpired(data)) this.sessions.delete(key);
    }
  }
}
