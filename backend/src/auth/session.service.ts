import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import authConfig from './auth.config.js';
import { SESSION_STORE, type SessionData, type SessionStore } from './session.store.js';

export type NewSession = Omit<SessionData, 'createdAt' | 'lastActiveAt'>;

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  // 세션 ID 는 로그인마다 새로 발급한다(세션 고정 방지). 저장소 키는 ID 의 해시라 저장소가 노출돼도 쿠키 값을 복원할 수 없다.
  issue(session: NewSession, now = Date.now()): string {
    this.store.purgeExpired((data) => this.isExpired(data, now));
    const id = randomBytes(32).toString('base64url');
    this.store.set(this.keyOf(id), { ...session, createdAt: now, lastActiveAt: now });
    return id;
  }

  // 유효하면 마지막 활동 시각을 갱신(유휴 만료 연장)하고, 만료됐으면 삭제 후 null.
  resolve(id: string | undefined, now = Date.now()): SessionData | null {
    if (!id) return null;
    const key = this.keyOf(id);
    const data = this.store.get(key);
    if (!data) return null;
    if (this.isExpired(data, now)) {
      this.store.delete(key);
      return null;
    }
    data.lastActiveAt = now;
    return data;
  }

  destroy(id: string | undefined): void {
    if (id) this.store.delete(this.keyOf(id));
  }

  // 사용자 비활성화·권한 변경 시 해당 사용자의 모든 세션을 종료하는 데 사용한다(S25 구현 시 호출).
  destroyAllForUser(userId: number): number {
    return this.store.deleteWhere((data) => data.userId === userId);
  }

  private isExpired(data: SessionData, now: number): boolean {
    const idle = now - data.lastActiveAt > this.config.idleMinutes * 60_000;
    const absolute = now - data.createdAt > this.config.absoluteHours * 3_600_000;
    return idle || absolute;
  }

  private keyOf(id: string): string {
    return createHash('sha256').update(id).digest('hex');
  }
}
