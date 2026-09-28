import { Controller, Get, INestApplication, Post, Req, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuditEntry, AuditLogService } from '../audit/audit-log.service.js';
import authConfig from '../auth/auth.config.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { SessionService } from '../auth/session.service.js';
import { InMemorySessionStore, SESSION_STORE } from '../auth/session.store.js';
import { PG_POOL } from '../database/database.module.js';
import { Authorize } from './authorize.decorator.js';
import { PermissionGuard } from './permission.guard.js';
import { mergeScopes, PermissionService } from './permission.service.js';
import type { AccessContext, RbacRequest } from './rbac.types.js';
import { ScopeService } from './scope.service.js';

const config = { cookieName: 'sid', idleMinutes: 30, absoluteHours: 12, cookieSecure: false, loginMaxFailures: 5, loginLockMinutes: 15 };

// ── 테스트용 컨트롤러 (배포 코드 아님) ──────────────────────────────────────
@Controller('t')
class TestController {
  @Get('read')
  @Authorize('S03', 'R')
  read(@Req() req: RbacRequest) {
    return { scope: req.access?.scope, roles: req.access?.roles };
  }

  @Post('write')
  @Authorize('S04', 'C')
  write() {
    return { ok: true };
  }

  @Get('undeclared')
  @UseGuards(SessionAuthGuard, PermissionGuard) // @Authorize 없이 가드만 붙인 설정 오류
  undeclared() {
    return { ok: true };
  }
}

interface FakeDb {
  users: Record<number, { status: string; linked: number | null; roles: string[] }>;
  grants: { userId: number; screen: string; action: string; scope: string }[];
}

describe('PermissionGuard (@Authorize) — HTTP 통합', () => {
  let app: INestApplication;
  let sessions: SessionService;
  let audits: AuditEntry[];
  let db: FakeDb;

  const cookieFor = (userId: number): string => {
    const id = sessions.issue({ userId, loginId: `u${userId}`, name: 'n', roles: [], linkedInstructorId: null, ip: null });
    return `sid=${id}`;
  };

  beforeEach(async () => {
    audits = [];
    db = {
      users: {
        1: { status: 'ACTIVE', linked: null, roles: ['OPS_MANAGER'] },
        2: { status: 'ACTIVE', linked: 5, roles: ['INSTRUCTOR'] },
        3: { status: 'ACTIVE', linked: null, roles: ['EXECUTIVE'] },
        4: { status: 'INACTIVE', linked: null, roles: ['OPS_MANAGER'] },
      },
      grants: [
        { userId: 1, screen: 'S03', action: 'R', scope: 'ALL' },
        { userId: 1, screen: 'S04', action: 'C', scope: 'ALL' },
        { userId: 2, screen: 'S03', action: 'R', scope: 'OWN_ASSIGNED' },
        { userId: 3, screen: 'S03', action: 'R', scope: 'ALL' },
        { userId: 4, screen: 'S03', action: 'R', scope: 'ALL' },
      ],
    };
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM user_account u')) {
          const u = db.users[params[0] as number];
          return { rows: u ? [{ status: u.status, linked_instructor_id: u.linked === null ? null : String(u.linked), roles: u.roles }] : [] };
        }
        if (sql.includes('FROM role_permission')) {
          const [userId, screen, action] = params as [number, string, string];
          return { rows: db.grants.filter((g) => g.userId === userId && g.screen === screen && g.action === action).map((g) => ({ scope_type: g.scope })) };
        }
        return { rows: [] };
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        { provide: PG_POOL, useValue: pool },
        { provide: AuditLogService, useValue: { record: async (e: AuditEntry) => void audits.push(e) } },
        { provide: SESSION_STORE, useClass: InMemorySessionStore },
        { provide: authConfig.KEY, useValue: config },
        SessionService,
        PermissionService,
        ScopeService,
        PermissionGuard,
        SessionAuthGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sessions = moduleRef.get(SessionService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('세션이 없으면 401 이고 ACCESS_DENIED 는 기록하지 않는다(인증 실패 ≠ 권한 거부)', async () => {
    await request(app.getHttpServer()).get('/t/read').expect(401);
    expect(audits).toHaveLength(0);
  });

  it('권한이 있으면 200 이고 요청에 접근 컨텍스트(scope·roles)가 채워진다', async () => {
    const res = await request(app.getHttpServer()).get('/t/read').set('Cookie', cookieFor(1)).expect(200);
    expect(res.body).toEqual({ scope: 'ALL', roles: ['OPS_MANAGER'] });
  });

  it('강사 권한은 OWN_ASSIGNED 범위로 전달된다', async () => {
    const res = await request(app.getHttpServer()).get('/t/read').set('Cookie', cookieFor(2)).expect(200);
    expect(res.body.scope).toBe('OWN_ASSIGNED');
  });

  it('권한이 없으면 403 + ACCESS_DENIED(행위자·경로 패턴·사유 코드) 감사', async () => {
    await request(app.getHttpServer()).post('/t/write').set('Cookie', cookieFor(2)).expect(403);
    expect(audits).toEqual([
      expect.objectContaining({ actorType: 'USER', actorUserId: 2, action: 'ACCESS_DENIED', targetTable: 'POST /t/write', reason: 'NO_PERMISSION:S04:C' }),
    ]);
    expect(audits[0].targetId ?? null).toBeNull();
  });

  it('같은 화면이라도 기능(action) 단위로 구분한다: 조회 권한만 있으면 생성은 거부', async () => {
    await request(app.getHttpServer()).get('/t/read').set('Cookie', cookieFor(3)).expect(200);
    await request(app.getHttpServer()).post('/t/write').set('Cookie', cookieFor(3)).expect(403);
  });

  it('비활성 계정은 401 이고 세션이 즉시 종료된다', async () => {
    const cookie = cookieFor(4);
    await request(app.getHttpServer()).get('/t/read').set('Cookie', cookie).expect(401);
    expect(sessions.resolve(cookie.slice(4))).toBeNull();
  });

  it('권한이 회수되면 다음 요청부터 바로 거부된다(권한 캐시 없음)', async () => {
    const cookie = cookieFor(1);
    await request(app.getHttpServer()).get('/t/read').set('Cookie', cookie).expect(200);
    db.grants = db.grants.filter((g) => !(g.userId === 1 && g.screen === 'S03'));
    await request(app.getHttpServer()).get('/t/read').set('Cookie', cookie).expect(403);
  });

  it('요구 권한이 선언되지 않은 엔드포인트는 거부한다(fail closed) + 기록', async () => {
    await request(app.getHttpServer()).get('/t/undeclared').set('Cookie', cookieFor(1)).expect(403);
    expect(audits[0]).toMatchObject({ action: 'ACCESS_DENIED', reason: 'PERMISSION_NOT_DECLARED' });
  });

  it('감사 기록이 실패해도 거부 결과는 그대로 403', async () => {
    const audit = app.get(AuditLogService);
    vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit down'));
    await request(app.getHttpServer()).post('/t/write').set('Cookie', cookieFor(2)).expect(403);
  });
});

describe('mergeScopes / Authorize 입력 검증', () => {
  it('여러 역할이 부여되면 ALL 이 우선하고 부여가 없으면 null', () => {
    expect(mergeScopes([])).toBeNull();
    expect(mergeScopes(['OWN_ASSIGNED'])).toBe('OWN_ASSIGNED');
    expect(mergeScopes(['OWN_ASSIGNED', 'ALL'])).toBe('ALL');
  });
  it('잘못된 화면 ID 는 애플리케이션 부팅 시점에 거부된다', () => {
    expect(() => Authorize('S29', 'R')).toThrow();
    expect(() => Authorize('X01', 'R')).toThrow();
    expect(() => Authorize('S28', 'R')).not.toThrow();
  });
});

describe('ScopeService', () => {
  const own = (instructorId: number | null): AccessContext => ({ userId: 9, roles: ['INSTRUCTOR'], instructorId, screenId: 'S13', action: 'R', scope: 'OWN_ASSIGNED' });
  const all: AccessContext = { userId: 1, roles: ['OPS_MANAGER'], instructorId: null, screenId: 'S13', action: 'R', scope: 'ALL' };

  function make(rows: boolean) {
    const audits: AuditEntry[] = [];
    const query = vi.fn(async () => ({ rows: rows ? [{ '?column?': 1 }] : [] }));
    const service = new ScopeService({ query } as never, { record: async (e: AuditEntry) => void audits.push(e) } as never);
    return { service, query, audits };
  }

  it('ALL 권한은 DB 조회 없이 통과한다', async () => {
    const { service, query } = make(false);
    expect(await service.canAccessCourse(all, 1)).toBe(true);
    expect(await service.canAccessSchedule(all, 1)).toBe(true);
    expect(await service.canAccessTrainee(all, 1)).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('강사인데 linked_instructor_id 가 없으면 아무것도 허용하지 않는다(fail closed)', async () => {
    const { service, query } = make(true);
    const a = own(null);
    expect(await service.canAccessCourse(a, 1)).toBe(false);
    expect(await service.canAccessSchedule(a, 1)).toBe(false);
    expect(await service.canAccessTrainee(a, 1)).toBe(false);
    expect(service.canAccessInstructor(a, 5)).toBe(false);
    expect(service.courseScopeFilter(a, 'c.course_id', 1).sql).toBe('FALSE');
    expect(query).not.toHaveBeenCalled();
  });

  it('강사는 본인 배정만 통과하고 판정 SQL 은 본인 instructor_id 로 조회한다', async () => {
    const yes = make(true);
    expect(await yes.service.canAccessCourse(own(5), 10)).toBe(true);
    expect(yes.query).toHaveBeenCalledWith(expect.stringContaining("status = 'ASSIGNED'"), [5, 10]);
    const no = make(false);
    expect(await no.service.canAccessSchedule(own(5), 10)).toBe(false);
    expect(no.service.canAccessInstructor(own(5), 5)).toBe(true);
    expect(no.service.canAccessInstructor(own(5), 6)).toBe(false);
  });

  it('범위 밖 ID 요청은 404 + ACCESS_DENIED(SCOPE_VIOLATION) 기록', async () => {
    const { service, audits } = make(false);
    const req = { access: own(5), method: 'GET', path: '/x', route: { path: '/courses/:id' }, ip: '1.2.3.4' } as unknown as RbacRequest;
    await expect(service.requireCourse(req, 99)).rejects.toMatchObject({ status: 404 });
    expect(audits[0]).toMatchObject({ actorUserId: 9, action: 'ACCESS_DENIED', targetTable: 'GET /courses/:id', reason: 'SCOPE_VIOLATION:course', ip: '1.2.3.4' });
  });

  it('@Authorize 없이 스코프 검사를 호출하면 즉시 오류(컨텍스트 누락 방지)', async () => {
    const { service } = make(true);
    await expect(service.requireCourse({} as RbacRequest, 1)).rejects.toThrow('@Authorize');
  });

  it('목록 쿼리 조건: ALL 은 TRUE, 강사는 파라미터화된 소속 조건', () => {
    const { service } = make(true);
    expect(service.courseScopeFilter(all, 'c.course_id', 1)).toEqual({ sql: 'TRUE', params: [] });
    const f = service.courseScopeFilter(own(5), 'c.course_id', 3);
    expect(f.params).toEqual([5]);
    expect(f.sql).toContain('c.course_id');
    expect(f.sql).toContain('$3');
    expect(service.scheduleScopeFilter(own(5), 'cs.instructor_id', 2)).toEqual({ sql: 'cs.instructor_id = $2', params: [5] });
    expect(service.traineeScopeFilter(own(5), 't.trainee_id', 1).sql).toContain("NOT IN ('APPLIED', 'REVIEWING', 'CANCELLED')");
  });
});

