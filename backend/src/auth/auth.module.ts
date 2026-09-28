import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import authConfig from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionService } from './session.service.js';
import { InMemorySessionStore, SESSION_STORE } from './session.store.js';

@Module({
  imports: [ConfigModule.forFeature(authConfig)],
  controllers: [AuthController],
  providers: [
    { provide: SESSION_STORE, useClass: InMemorySessionStore },
    SessionService,
    AuthService,
    SessionAuthGuard,
  ],
  exports: [SessionService, SessionAuthGuard],
})
export class AuthModule {}
