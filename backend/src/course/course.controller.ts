import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { CourseService } from './course.service.js';

// 화면: S15 과정 목록, S16 과정 등록/수정/상세 (baseline 5-2)
@Controller('courses')
export class CourseController {
  constructor(@Inject(CourseService) private readonly courses: CourseService) {}

  @Get()
  @Authorize('S15', 'R')
  list(@Req() req: RbacRequest, @Query() query: Record<string, unknown>) {
    return this.courses.list(req.access!, query);
  }

  // ':id' 보다 먼저 선언해야 경로가 가려지지 않는다
  @Get('manager-candidates')
  @Authorize('S16', 'U')
  managerCandidates() {
    return this.courses.managerCandidates();
  }

  @Get(':id')
  @Authorize('S16', 'R')
  detail(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.courses.detail(req, parseId(id));
  }

  @Post()
  @Authorize('S16', 'C')
  create(@Body() body: unknown) {
    return this.courses.create(body);
  }

  @Patch(':id')
  @Authorize('S16', 'U')
  update(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.courses.update(req, parseId(id), body);
  }

  @Post(':id/open-recruitment')
  @HttpCode(200)
  @Authorize('S16', 'U')
  openRecruitment(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.courses.openRecruitment(req, parseId(id));
  }

  @Post(':id/start')
  @HttpCode(200)
  @Authorize('S16', 'U')
  start(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.courses.start(req, parseId(id), body);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @Authorize('S16', 'U')
  suspend(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.courses.suspend(req, parseId(id), body);
  }

  // OPS·SYS·EXEC 만(INSTRUCTOR 는 baseline 5-2 상 종료 체크리스트 접근 대상이 아니라 S16:R 과 다른 액션으로 분리)
  @Get(':id/closure-checklist')
  @Authorize('S16', 'A')
  closureChecklist(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.courses.closureChecklist(req, parseId(id));
  }

  @Post(':id/close')
  @HttpCode(200)
  @Authorize('S16', 'U')
  close(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.courses.close(req, parseId(id), body);
  }
}
