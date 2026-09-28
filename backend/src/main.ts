import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1'); // baseline 5절 API 경로 기준
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
