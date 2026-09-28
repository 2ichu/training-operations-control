import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { ScheduleService } from './schedule.service.js';

// 화면: S13 강의 일정/교육일정 (회차·휴강·강사 배정) — baseline 5-2
@Controller()
export class ScheduleController {
  constructor(@Inject(ScheduleService) private readonly schedules: ScheduleService) {}

  @Get('schedules')
  @Authorize('S13', 'R')
  list(@Req() req: RbacRequest, @Query() query: Record<string, unknown>) {
    return this.schedules.list(req.access!, query);
  }

  @Post('courses/:id/schedules')
  @Authorize('S13', 'C')
  create(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.create(req, parseId(id), body);
  }

  @Patch('schedules/:id')
  @Authorize('S13', 'U')
  update(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.update(req, parseId(id), body);
  }

  @Post('schedules/:id/cancel-class')
  @HttpCode(200)
  @Authorize('S13', 'U')
  cancelClass(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.cancelClass(req, parseId(id), body);
  }

  @Post('schedules/:id/reassign-instructor')
  @HttpCode(200)
  @Authorize('S13', 'U')
  reassignInstructor(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.reassignInstructor(req, parseId(id), body);
  }

  @Post('courses/:id/instructor-assignments')
  @Authorize('S13', 'C')
  assign(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.assign(req, parseId(id), body);
  }

  @Post('instructor-assignments/:id/cancel')
  @HttpCode(200)
  @Authorize('S13', 'U')
  cancelAssignment(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.schedules.cancelAssignment(req, parseId(id), body);
  }
}
