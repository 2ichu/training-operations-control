import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { OperationLogController } from './operation-log.controller.js';
import { OperationLogService } from './operation-log.service.js';

@Module({ imports: [RbacModule], controllers: [OperationLogController], providers: [OperationLogService] })
export class OperationLogModule {}
