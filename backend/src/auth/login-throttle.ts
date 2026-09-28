interface Entry {
  count: number;
  lockedUntil: number;
}

// 로그인 실패 제한(프로세스 메모리). 키는 계정+접속 IP 조합이라 특정 계정을 외부에서 잠가 버리는 것을 어렵게 한다.
// 잠금 횟수·시간은 STEP 12 #29 확정 전 임시 설정값이다.
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures: number,
    private readonly lockMs: number,
  ) {}

  isLocked(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.lockedUntil > now) return true;
    if (entry.lockedUntil !== 0) this.entries.delete(key); // 잠금 종료
    return false;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.entries.get(key) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= this.maxFailures) {
      entry.lockedUntil = now + this.lockMs;
      entry.count = 0;
    }
    this.entries.set(key, entry);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
