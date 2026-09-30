import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { ExcuseController } from './excuse.controller.js';
import { ExcuseService } from './excuse.service.js';

@Module({ imports: [RbacModule], controllers: [ExcuseController], providers: [ExcuseService] })
export class ExcuseModule {}
