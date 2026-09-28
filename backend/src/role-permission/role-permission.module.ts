import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { RolePermissionController } from './role-permission.controller.js';
import { RolePermissionService } from './role-permission.service.js';

@Module({ imports: [RbacModule], controllers: [RolePermissionController], providers: [RolePermissionService] })
export class RolePermissionModule {}
