// 인증 스모크 테스트: 빌드된 서버(dist)를 띄워 실제 DB 로 로그인·세션·로그아웃과 감사로그를 확인한다.
// 주의: audit_log 는 append-only 이므로 실행할 때마다 감사 행이 영구히 추가된다(약 7건). 사전에 npm run build 필요.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import pg from 'pg';

const PORT = 3100;
const base = `http://localhost:${PORT}/api/v1`;
const loginId = process.env.SEED_ADMIN_LOGIN_ID!;
const password = process.env.SEED_ADMIN_PASSWORD!;

const results: { ok: boolean; name: string; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string): void => {
  results.push({ ok, name, detail });
};

const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (d) => (output += d));
server.stderr.on('data', (d) => (output += d));
for (let i = 0; i < 60 && !/successfully started/.test(output); i += 1) await new Promise((r) => setTimeout(r, 250));
if (!/successfully started/.test(output)) {
  server.kill();
  console.error('서버 기동 실패\n' + output);
  process.exit(1);
}

const cookieOf = (res: Response): string | undefined => res.headers.getSetCookie().find((c) => c.startsWith('sid='));
const call = (path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> =>
  fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) } });
const login = (id: string, pw: string, cookie?: string): Promise<Response> => call('/auth/login', { method: 'POST', body: JSON.stringify({ loginId: id, password: pw }), cookie });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const auditBefore = Number((await pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n);
const maxIdBefore = Number((await pool.query('SELECT coalesce(max(log_id),0)::int m FROM audit_log')).rows[0].m);

try {
  check('로그인 전 /auth/me → 401', (await call('/auth/me')).status === 401);
  check('위조된 세션 쿠키 → 401', (await call('/auth/me', { cookie: 'sid=forged' })).status === 401);
  check('잘못된 본문 → 400', (await call('/auth/login', { method: 'POST', body: JSON.stringify({ loginId: 1 }) })).status === 400);

  const bad = await login(loginId, 'wrong-password-xyz');
  const unknown = await login('no-such-user-xyz', 'wrong-password-xyz');
  check('비밀번호 오류 → 401, 세션 쿠키 없음', bad.status === 401 && !cookieOf(bad));
  check('없는 계정과 비밀번호 오류의 응답이 동일(계정 존재 노출 없음)', unknown.status === 401 && (await unknown.text()) === (await bad.text()));

  const ok = await login(loginId, password);
  const set1 = cookieOf(ok);
  check('로그인 성공 → 200', ok.status === 200);
  check('세션 쿠키: HttpOnly, SameSite=Lax, Path=/', !!set1 && /HttpOnly/i.test(set1) && /SameSite=Lax/i.test(set1) && /Path=\//.test(set1), set1?.replace(/sid=[^;]+/, 'sid=…'));
  const body = (await ok.json()) as { user: { roles: string[]; loginId: string } };
  // mustChangePassword 처럼 필드명에 "password" 를 포함하는 정상 필드는 허용하고, 실제 비밀번호·해시 값(scrypt 해시 포맷)만 검사한다.
  check('응답에 비밀번호·해시 값 미포함, 역할 SYS_ADMIN', !JSON.stringify(body).includes('scrypt$') && !JSON.stringify(body).includes(password) && body.user.roles.join() === 'SYS_ADMIN');
  const cookie1 = set1!.split(';')[0];

  const me = await call('/auth/me', { cookie: cookie1 });
  const meBody = (await me.json()) as { user: { loginId: string }; permissions: unknown[] };
  check('로그인 후 /auth/me → 200, 사용자 + 권한 목록', me.status === 200 && meBody.user.loginId === loginId && meBody.permissions.length > 0, `권한 ${meBody.permissions?.length}건`);
  check('/auth/me Cache-Control: no-store', me.headers.get('cache-control') === 'no-store');

  const relogin = await login(loginId, password, cookie1);
  const cookie2 = cookieOf(relogin)!.split(';')[0];
  check('재로그인 시 새 세션 ID 발급 (세션 고정 방지)', cookie2 !== cookie1);
  check('이전 세션은 재로그인 즉시 폐기', (await call('/auth/me', { cookie: cookie1 })).status === 401);

  const out = await call('/auth/logout', { method: 'POST', cookie: cookie2 });
  check('로그아웃 → 200, 쿠키 삭제', out.status === 200 && /sid=;/.test(out.headers.getSetCookie().join(';')));
  check('로그아웃 후 세션 무효 (/auth/me → 401)', (await call('/auth/me', { cookie: cookie2 })).status === 401);
  check('로그인 없이 /auth/logout → 401', (await call('/auth/logout', { method: 'POST' })).status === 401);

  const audit = (await pool.query(
    `SELECT actor_type::text, actor_user_id, action::text, target_table, target_id, reason, ip_address, before_value, after_value
       FROM audit_log WHERE log_id > $1 ORDER BY log_id`,
    [maxIdBefore],
  )).rows;
  const seq = audit.map((a) => `${a.action}${a.reason ? `(${a.reason})` : ''}`);
  check('감사로그 순서: LOGIN_FAILED×2 → LOGIN×2 → LOGOUT', JSON.stringify(seq) === JSON.stringify(['LOGIN_FAILED(INVALID_CREDENTIALS)', 'LOGIN_FAILED(INVALID_CREDENTIALS)', 'LOGIN', 'LOGIN', 'LOGOUT']), seq.join(' → '));
  const failedKnown = audit[0], failedUnknown = audit[1], loginRow = audit[2];
  check('실패(존재하는 계정): actor_user_id·target_id 기록', failedKnown.actor_type === 'USER' && failedKnown.actor_user_id !== null && failedKnown.target_id !== null);
  check('실패(없는 계정): actor_user_id·target_id NULL, 시도한 ID 미기록', failedUnknown.actor_user_id === null && failedUnknown.target_id === null && !JSON.stringify(failedUnknown).includes('no-such-user-xyz'));
  check('LOGIN 행: actor_type=USER, target=user_account, ip 기록', loginRow.actor_type === 'USER' && loginRow.target_table === 'user_account' && !!loginRow.ip_address);
  check('감사로그에 비밀번호·입력값 미기록', !JSON.stringify(audit).includes('wrong-password-xyz') && !JSON.stringify(audit).includes(password));
} finally {
  server.kill();
  await pool.end();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과 (실행 전 감사로그 ${auditBefore}건, 이번 실행으로 5건 추가)`);
process.exit(failed.length ? 1 : 0);
