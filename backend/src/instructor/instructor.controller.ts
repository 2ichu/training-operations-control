import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { InstructorService } from './instructor.service.js';

// 화면: S11 강사 목록, S12 강사 등록/수정, S14 강사 변경이력 (baseline 5-2)
@Controller()
export class InstructorController {
  constructor(@Inject(InstructorService) private readonly instructors: InstructorService) {}

  @Get('instructors')
  @Authorize('S11', 'R')
  list(@Req() req: RbacRequest, @Query() query: Record<string, unknown>) {
    return this.instructors.list(req.access!, query);
  }

  @Get('instructors/:id')
  @Authorize('S12', 'R')
  detail(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.instructors.detail(req, parseId(id));
  }

  @Post('instructors')
  @Authorize('S12', 'C')
  create(@Body() body: unknown) {
    return this.instructors.create(body);
  }

  @Patch('instructors/:id')
  @Authorize('S12', 'U')
  update(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.instructors.update(req, parseId(id), body);
  }

  @Get('instructor-change-logs')
  @Authorize('S14', 'R')
  changeLogs(@Query() query: Record<string, unknown>) {
    return this.instructors.changeLogs(query);
  }
}
