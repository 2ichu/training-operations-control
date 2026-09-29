import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

// 저장 형식: scrypt$N$r$p$<salt b64>$<hash b64>  (시드와 로그인이 같은 형식을 공유한다)
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;
  try {
    const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, params);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// D-15(#29) 확정(2026-09-29): 새 비밀번호는 10자 이상 200자 이하, 영문·숫자·기호를 모두 포함해야 한다.
// 프론트엔드(ChangePasswordPage)가 같은 규칙을 안내용으로 미리 검사하고, 서버가 최종 검증한다.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `${PASSWORD_MIN_LENGTH}자 이상 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다`;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return '영문, 숫자, 기호를 모두 포함해야 합니다';
  }
  return null;
}

// 계정 생성·비밀번호 초기화 시 발급하는 임시 비밀번호(응답에 1회 노출, 어떤 로그에도 남기지 않는다).
// 최초 로그인 시 변경 강제(baseline 10-2 #5)는 user_account.must_change_password 로 표현한다.
export function generateTempPassword(): string {
  return randomBytes(12).toString('base64url');
}

let dummyHash: Promise<string> | undefined;

// 존재하지 않는 계정에도 동일한 연산을 수행해 응답 시간 차이로 계정 존재 여부를 알 수 없게 한다
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(password, await dummyHash);
}
