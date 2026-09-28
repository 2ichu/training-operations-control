import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { InstructorController } from './instructor.controller.js';
import { InstructorService } from './instructor.service.js';

@Module({ imports: [RbacModule], controllers: [InstructorController], providers: [InstructorService] })
export class InstructorModule {}
