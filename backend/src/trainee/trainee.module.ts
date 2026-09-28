import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { TraineeController } from './trainee.controller.js';
import { TraineeService } from './trainee.service.js';

@Module({ imports: [RbacModule], controllers: [TraineeController], providers: [TraineeService] })
export class TraineeModule {}
