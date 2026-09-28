import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { AttachmentController } from './attachment.controller.js';
import { AttachmentService } from './attachment.service.js';

@Module({ imports: [RbacModule], controllers: [AttachmentController], providers: [AttachmentService] })
export class AttachmentModule {}
