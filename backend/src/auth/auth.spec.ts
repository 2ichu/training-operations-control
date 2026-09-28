import { HttpException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../audit/audit-log.service.js';
import { AuthService } from './auth.service.js';
import { parseCookie } from './auth.types.js';
import { LoginThrottle } from './login-throttle.js';
import { hashPassword, verifyPassword } from './password.js';
import { SessionService } from './session.service.js';
import { InMemorySessionStore } from './session.store.js';

const config = { cookieName: 'sid', idleMinutes: 30, absoluteHours: 12, cookieSecure: false, loginMaxFailures: 3, loginLockMinutes: 15 };
const MIN = 60_000;

describe('password', () => {
  it('올바른 비밀번호만 통과하고 형식이 깨진 해시는 거부한다', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$a$b$c$d$e')).toBe(false);
  });
  it('같은 비밀번호도 매번 다른 해시(salt)를 만든다', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('SessionService', () => {
  const make = () => new SessionService(new InMemorySessionStore(), config);
  const user = { userId: 1, loginId: 'a', name: 'A', roles: ['SYS_ADMIN'], linkedInstructorId: null, ip: null };

  it('발급한 세션을 조회하고 destroy 하면 사라진다', () => {
    const s = make();
    const id = s.issue(user, 0);
    expect(s.resolve(id, 1)?.userId).toBe(1);
    s.destroy(id);
    expect(s.resolve(id, 2)).toBeNull();
  });
  it('유휴 시간이 지나면 만료되고, 활동이 있으면 연장된다', () => {
    const s = make();
    const id = s.issue(user, 0);
    expect(s.resolve(id, 29 * MIN)).not.toBeNull(); // 활동으로 연장
    expect(s.resolve(id, 29 * MIN + 29 * MIN)).not.toBeNull();
    expect(s.resolve(id, 29 * MIN + 29 * MIN + 31 * MIN)).toBeNull(); // 유휴 31분
  });
  it('활동이 계속돼도 절대 만료 시간이 지나면 만료된다', () => {
    const s = make();
    const id = s.issue(user, 0);
    for (let t = 20 * MIN; t < 12 * 60 * MIN; t += 20 * MIN) expect(s.resolve(id, t)).not.toBeNull();
    expect(s.resolve(id, 12 * 60 * MIN + 1)).toBeNull();
  });
  it('세션 ID 는 발급마다 달라지고 알 수 없는 ID 는 거부한다', () => {
    const s = make();
    expect(s.issue(user, 0)).not.toBe(s.issue(user, 0));
    expect(s.resolve('forged', 0)).toBeNull();
    expect(s.resolve(undefined, 0)).toBeNull();
  });
  it('destroyAllForUser 는 해당 사용자의 세션만 종료한다', () => {
    const s = make();
    const a = s.issue(user, 0);
    const b = s.issue({ ...user, userId: 2 }, 0);
    expect(s.destroyAllForUser(1)).toBe(1);
    expect(s.resolve(a, 1)).toBeNull();
    expect(s.resolve(b, 1)).not.toBeNull();
  });
});

describe('LoginThrottle', () => {
  it('최대 실패 횟수에 도달하면 잠기고 잠금 시간 후 풀린다', () => {
    const t = new LoginThrottle(3, 15 * MIN);
    t.recordFailure('k', 0);
    t.recordFailure('k', 1);
    expect(t.isLocked('k', 2)).toBe(false);
    t.recordFailure('k', 2);
    expect(t.isLocked('k', 3)).toBe(true);
    expect(t.isLocked('other', 3)).toBe(false);
    expect(t.isLocked('k', 2 + 15 * MIN + 1)).toBe(false);
  });
  it('성공 시 reset 하면 실패 횟수가 초기화된다', () => {
    const t = new LoginThrottle(2, MIN);
    t.recordFailure('k', 0);
    t.reset('k');
    t.recordFailure('k', 1);
    expect(t.isLocked('k', 2)).toBe(false);
  });
});

describe('parseCookie', () => {
  it('이름으로 값을 찾고 잘못된 인코딩은 무시한다', () => {
    expect(parseCookie('a=1; sid=abc%20d; b=2', 'sid')).toBe('abc d');
    expect(parseCookie('a=1', 'sid')).toBeUndefined();
    expect(parseCookie(undefined, 'sid')).toBeUndefined();
    expect(parseCookie('sid=%E0%A4%A', 'sid')).toBeUndefined();
  });
});

describe('AuthService.login', () => {
  async function setup(userStatus: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
    const hash = await hashPassword('secret-pass');
    const audits: AuditEntry[] = [];
    const rows: Record<string, unknown[]> = {
      user: [{ user_id: '7', login_id: 'kim', password_hash: hash, name: '김', status: userStatus, linked_instructor_id: null, must_change_password: false }],
      roles: [{ role_code: 'OPS_MANAGER' }],
    };
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM user_account')) return { rows: params[0] === 'kim' ? rows.user : [] };
        if (sql.includes('FROM user_role')) return { rows: rows.roles };
        return { rows: [] };
      }),
    };
    const audit = { record: vi.fn(async (e: AuditEntry) => void audits.push(e)) };
    const transactions = { run: vi.fn() };
    const sessions = new SessionService(new InMemorySessionStore(), config);
    const service = new AuthService(pool as never, sessions, audit as never, transactions as never, config);
    return { service, sessions, audits, audit };
  }

  it('성공: 세션 발급, LOGIN 감사 기록(행위자 USER), 이전 세션 폐기', async () => {
    const { service, sessions, audits } = await setup();
    const old = sessions.issue({ userId: 7, loginId: 'kim', name: '김', roles: [], linkedInstructorId: null, ip: null });
    const { sessionId, user } = await service.login('kim', 'secret-pass', '10.0.0.1', old);
    expect(user).toEqual({ userId: 7, loginId: 'kim', name: '김', roles: ['OPS_MANAGER'], linkedInstructorId: null, mustChangePassword: false });
    expect(sessionId).not.toBe(old);
    expect(sessions.resolve(old)).toBeNull(); // 세션 고정 방지
    expect(sessions.resolve(sessionId)?.userId).toBe(7);
    expect(audits).toEqual([expect.objectContaining({ actorType: 'USER', actorUserId: 7, action: 'LOGIN', targetTable: 'user_account', targetId: 7, ip: '10.0.0.1' })]);
  });

  it('비밀번호 오류: 401, LOGIN_FAILED(actor_user_id 지정), 비밀번호 미기록', async () => {
    const { service, audits } = await setup();
    await expect(service.login('kim', 'bad-pass', null)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(audits[0]).toMatchObject({ actorType: 'USER', actorUserId: 7, action: 'LOGIN_FAILED', reason: 'INVALID_CREDENTIALS' });
    expect(JSON.stringify(audits)).not.toContain('bad-pass');
  });

  it('존재하지 않는 계정: 같은 401 응답, LOGIN_FAILED 는 actor_user_id·target_id 없이 기록, 시도한 ID 미기록', async () => {
    const { service, audits } = await setup();
    await expect(service.login('nobody', 'x', null)).rejects.toMatchObject({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    expect(audits[0]).toMatchObject({ actorType: 'USER', action: 'LOGIN_FAILED', reason: 'INVALID_CREDENTIALS' });
    expect(audits[0].actorUserId ?? null).toBeNull();
    expect(audits[0].targetId ?? null).toBeNull();
    expect(JSON.stringify(audits)).not.toContain('nobody');
  });

  it('비활성 계정: 비밀번호가 맞아도 401 이며 INACTIVE_ACCOUNT 로 기록, 응답 메시지는 동일', async () => {
    const { service, audits, sessions } = await setup('INACTIVE');
    await expect(service.login('kim', 'secret-pass', null)).rejects.toMatchObject({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    expect(audits[0]).toMatchObject({ action: 'LOGIN_FAILED', reason: 'INACTIVE_ACCOUNT', actorUserId: 7 });
    expect(sessions.destroyAllForUser(7)).toBe(0);
  });

  it('연속 실패 3회 후 429, 잠금 중에는 올바른 비밀번호도 거부, LOCKED 기록', async () => {
    const { service, audits } = await setup();
    for (let i = 0; i < 3; i += 1) await expect(service.login('kim', 'bad', '1.1.1.1')).rejects.toBeInstanceOf(UnauthorizedException);
    const err = await service.login('kim', 'secret-pass', '1.1.1.1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(audits.at(-1)).toMatchObject({ action: 'LOGIN_FAILED', reason: 'LOCKED' });
    // 다른 IP 는 영향 없음
    await expect(service.login('kim', 'secret-pass', '2.2.2.2')).resolves.toHaveProperty('sessionId');
  });

  it('감사 기록이 실패하면 세션을 만들지 않는다', async () => {
    const { service, audit, sessions } = await setup();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.login('kim', 'secret-pass', null)).rejects.toThrow('audit down');
    expect(sessions.destroyAllForUser(7)).toBe(0);
  });

  it('로그아웃: 세션 폐기 + LOGOUT 감사 기록', async () => {
    const { service, sessions, audits } = await setup();
    const { sessionId } = await service.login('kim', 'secret-pass', null);
    const session = sessions.resolve(sessionId)!;
    await service.logout(session, sessionId, '9.9.9.9');
    expect(sessions.resolve(sessionId)).toBeNull();
    expect(audits.at(-1)).toMatchObject({ actorType: 'USER', actorUserId: 7, action: 'LOGOUT', ip: '9.9.9.9' });
  });
});
