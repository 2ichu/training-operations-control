import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { securityHeaders } from './common/security-headers.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1'); // baseline 5절 API 경로 기준
  app.disable('x-powered-by'); // 프레임워크 노출 헤더 제거
  app.use(securityHeaders);
  // 리버스 프록시(nginx 등) 뒤에서는 X-Forwarded-For 를 믿어야 감사로그·로그인 기록에 실제 접속 IP 가 남는다.
  // 믿을 프록시를 명시할 때만 켠다(예: "loopback, uniquelocal" 또는 앞단 프록시 수 "1"). 비워 두면 직접 접속 IP 를 쓴다.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  // SIGTERM(컨테이너 종료 등)에서 배치·출결 이벤트 평가를 마무리하고 DB 풀을 닫는다(beforeApplicationShutdown·onApplicationShutdown 훅)
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
