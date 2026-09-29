import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type pg from 'pg';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AuditedTransactionService } from '../audit/audited-transaction.js';
import { PG_POOL } from '../database/database.module.js';
import authConfig from './auth.config.js';
import type { AuthUser, PermissionGrant } from './auth.types.js';
import { LoginThrottle } from './login-throttle.js';
import { hashPassword, passwordPolicyError, verifyAgainstDummy, verifyPassword } from './password.js';
import { SessionService } from './session.service.js';
import type { SessionData } from './session.store.js';

const INVALID_CREDENTIALS = '아이디 또는 비밀번호가 올바르지 않습니다.';
// 새 비밀번호 최소 길이: D-15(비밀번호 정책값) 확정 전 임시 기술적 하한(복잡도 규칙은 아님, 세션값과 같은 성격의 임시값)

interface UserRow {
  user_id: string;
  login_id: string;
  password_hash: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  linked_instructor_id: string | null;
  must_change_password: boolean;
}

@Injectable()
export class AuthService {
  private readonly throttle: LoginThrottle;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
    @Inject(authConfig.KEY) config: ConfigType<typeof authConfig>,
  ) {
    this.throttle = new LoginThrottle(config.loginMaxFailures, config.loginLockMinutes * 60_000);
  }

  // 로그인 성공 시 새 세션 ID 를 발급하고 이전 세션(쿠키로 제시된 것)은 폐기한다. 실패 사유는 응답에 구분해 노출하지 않는다.
  async login(
    loginId: string,
    password: string,
    ip: string | null,
    previousSessionId?: string,
  ): Promise<{ sessionId: string; user: AuthUser }> {
    const throttleKey = `${loginId.toLowerCase()}|${ip ?? ''}`;
    if (this.throttle.isLocked(throttleKey)) {
      await this.audit.record({ actorType: 'USER', action: 'LOGIN_FAILED', targetTable: 'user_account', reason: 'LOCKED', ip });
      throw new HttpException('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const found = await this.pool.query<UserRow>(
      `SELECT user_id, login_id, password_hash, name, status, linked_instructor_id, must_change_password FROM user_account WHERE login_id = $1`,
      [loginId],
    );
    const row = found.rows[0];

    if (!row) {
      await verifyAgainstDummy(password);
      this.throttle.recordFailure(throttleKey);
      // 시도한 로그인 ID·비밀번호는 기록하지 않는다(오입력된 비밀번호가 로그에 남는 것을 방지)
      await this.audit.record({ actorType: 'USER', action: 'LOGIN_FAILED', targetTable: 'user_account', reason: 'INVALID_CREDENTIALS', ip });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const userId = Number(row.user_id);
    const passwordOk = await verifyPassword(password, row.password_hash);
    if (!passwordOk || row.status !== 'ACTIVE') {
      this.throttle.recordFailure(throttleKey);
      await this.audit.record({
        actorType: 'USER',
        actorUserId: userId,
        action: 'LOGIN_FAILED',
        targetTable: 'user_account',
        targetId: userId,
        reason: passwordOk ? 'INACTIVE_ACCOUNT' : 'INVALID_CREDENTIALS',
        ip,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.throttle.reset(throttleKey);
    const user: AuthUser = {
      userId,
      loginId: row.login_id,
      name: row.name,
      roles: await this.loadRoles(userId),
      linkedInstructorId: row.linked_instructor_id === null ? null : Number(row.linked_instructor_id),
      mustChangePassword: row.must_change_password,
    };

    // 감사 기록이 실패하면 세션을 만들지 않는다
    await this.audit.record({ actorType: 'USER', actorUserId: userId, action: 'LOGIN', targetTable: 'user_account', targetId: userId, ip });
    this.sessions.destroy(previousSessionId);
    const sessionId = this.sessions.issue({ ...user, ip });
    return { sessionId, user };
  }

  async logout(session: SessionData, sessionId: string, ip: string | null): Promise<void> {
    this.sessions.destroy(sessionId);
    await this.audit.record({ actorType: 'USER', actorUserId: session.userId, action: 'LOGOUT', targetTable: 'user_account', targetId: session.userId, ip });
  }

  // 현재 DB 기준의 사용자·역할·권한을 반환한다. 비활성화되었거나 삭제된 계정이면 세션을 종료하고 401.
  async me(session: SessionData, sessionId: string): Promise<{ user: AuthUser; permissions: PermissionGrant[] }> {
    const found = await this.pool.query<UserRow>(
      `SELECT user_id, login_id, password_hash, name, status, linked_instructor_id, must_change_password FROM user_account WHERE user_id = $1`,
      [session.userId],
    );
    const row = found.rows[0];
    if (!row || row.status !== 'ACTIVE') {
      this.sessions.destroy(sessionId);
      throw new UnauthorizedException('세션이 유효하지 않습니다.');
    }
    const permissions = await this.pool.query<{ screen_id: string; action: string; scope_type: string }>(
      `SELECT rp.screen_id, rp.action, rp.scope_type
         FROM role_permission rp JOIN user_role ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = $1 ORDER BY rp.screen_id, rp.action`,
      [session.userId],
    );
    return {
      user: {
        userId: Number(row.user_id),
        loginId: row.login_id,
        name: row.name,
        roles: await this.loadRoles(session.userId),
        linkedInstructorId: row.linked_instructor_id === null ? null : Number(row.linked_instructor_id),
        mustChangePassword: row.must_change_password,
      },
      permissions: permissions.rows.map((p) => ({ screenId: p.screen_id, action: p.action, scope: p.scope_type })),
    };
  }

  // 본인 비밀번호 변경(강제 변경 포함). 현재 비밀번호 확인 후 갱신하고 must_change_password 를 해제한다.
  // 새 비밀번호 값은 어떤 로그에도 남기지 않는다(user_account.password_hash 는 redact 대상으로 이미 등록됨).
  async changePassword(session: SessionData, currentPassword: string, newPassword: string): Promise<void> {
    const policyError = passwordPolicyError(newPassword);
    if (policyError) throw new BadRequestException({ code: 'VALIDATION', field: 'newPassword', message: policyError });
    const found = await this.pool.query<UserRow>(`SELECT password_hash FROM user_account WHERE user_id = $1`, [session.userId]);
    const row = found.rows[0];
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.transactions.run((tx) =>
      tx.update('user_account', { user_id: session.userId }, { password_hash: passwordHash, must_change_password: false }),
    );
  }

  private async loadRoles(userId: number): Promise<string[]> {
    const result = await this.pool.query<{ role_code: string }>(
      `SELECT r.role_code::text AS role_code FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.role_code`,
      [userId],
    );
    return result.rows.map((r) => r.role_code);
  }
}
