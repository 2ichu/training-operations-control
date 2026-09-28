import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { CourseController } from './course.controller.js';
import { CourseService } from './course.service.js';

@Module({ imports: [RbacModule], controllers: [CourseController], providers: [CourseService], exports: [CourseService] })
export class CourseModule {}
