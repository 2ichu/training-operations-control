import { registerAs } from '@nestjs/config';

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// 세션·잠금 정책값(D-15, #29 확정 2026-09-29): 유휴 30분·절대 8시간, 5회 실패 시 15분 잠금. 환경변수로 조정할 수 있다.
// 비밀번호 규칙은 password.ts(PASSWORD_MIN_LENGTH·passwordPolicyError).
export default registerAs('auth', () => ({
  cookieName: process.env.SESSION_COOKIE_NAME || 'sid',
  idleMinutes: num('SESSION_IDLE_MINUTES', 30),
  absoluteHours: num('SESSION_ABSOLUTE_HOURS', 8),
  cookieSecure: process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production',
  loginMaxFailures: num('LOGIN_MAX_FAILURES', 5),
  loginLockMinutes: num('LOGIN_LOCK_MINUTES', 15),
}));
