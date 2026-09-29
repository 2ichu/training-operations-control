import { registerAs } from '@nestjs/config';

// BATCH_ENABLED: 시간 기반 배치(BatchSchedulerService)를 켠다.
// 기본은 켜짐이며 NODE_ENV=test(vitest)에서만 꺼진다 — 테스트는 서비스를 직접 호출한다.
// 인스턴스를 여러 대 띄우면 한 대만 true 로 둔다(두 대가 겹쳐도 advisory lock·멱등 처리로 중복 건은 생기지 않지만 불필요한 실행이 늘어난다).
export default registerAs('batch', () => ({
  enabled: process.env.BATCH_ENABLED ? process.env.BATCH_ENABLED === 'true' : process.env.NODE_ENV !== 'test',
}));
