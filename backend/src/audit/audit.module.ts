import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContext } from './audit-context.js';
import { AuditContextInterceptor } from './audit-context.interceptor.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditedTransactionService } from './audited-transaction.js';

@Global()
@Module({
  providers: [
    AuditLogService,
    AuditContext,
    AuditedTransactionService,
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
  ],
  exports: [AuditLogService, AuditContext, AuditedTransactionService],
})
export class AuditModule {}
