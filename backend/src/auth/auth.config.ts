import { registerAs } from '@nestjs/config';

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// 세션·비밀번호 정책값은 STEP 12 #29 미확정이므로 아래 기본값은 임시 설정값이다(환경변수로 조정, 코드 상수 아님).
export default registerAs('auth', () => ({
  cookieName: process.env.SESSION_COOKIE_NAME || 'sid',
  idleMinutes: num('SESSION_IDLE_MINUTES', 30),
  absoluteHours: num('SESSION_ABSOLUTE_HOURS', 12),
  cookieSecure: process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production',
  loginMaxFailures: num('LOGIN_MAX_FAILURES', 5),
  loginLockMinutes: num('LOGIN_LOCK_MINUTES', 15),
}));
