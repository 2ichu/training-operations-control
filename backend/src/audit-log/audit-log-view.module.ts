import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { AuditLogViewController } from './audit-log-view.controller.js';
import { AuditLogViewService } from './audit-log-view.service.js';

@Module({ imports: [RbacModule], controllers: [AuditLogViewController], providers: [AuditLogViewService] })
export class AuditLogViewModule {}
