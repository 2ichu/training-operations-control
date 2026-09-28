import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({ imports: [RbacModule], controllers: [UserController], providers: [UserService] })
export class UserModule {}
