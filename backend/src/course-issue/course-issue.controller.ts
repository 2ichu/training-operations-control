import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { CourseIssueService } from './course-issue.service.js';

// 화면: S18 특이사항 (baseline 5-2, escalate 는 Phase 3 verification_case 연동).
@Controller('course-issues')
export class CourseIssueController {
  constructor(@Inject(CourseIssueService) private readonly courseIssues: CourseIssueService) {}

  @Get()
  @Authorize('S18', 'R')
  list(@Req() req: RbacRequest, @Query() query: Record<string, unknown>) {
    return this.courseIssues.list(req, query);
  }

  @Post()
  @Authorize('S18', 'C')
  create(@Req() req: RbacRequest, @Body() body: unknown) {
    return this.courseIssues.create(req, body);
  }

  @Patch(':id')
  @Authorize('S18', 'U')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.courseIssues.update(parseId(id), body);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @Authorize('S18', 'U')
  resolve(@Param('id') id: string) {
    return this.courseIssues.resolve(parseId(id));
  }

  // 신규 verification_case 생성이 주 효과이므로 check-in·결석확정과 같이 기본 201(HttpCode 재정의 없음).
  @Post(':id/escalate')
  @Authorize('S18', 'A')
  escalate(@Param('id') id: string, @Body() body: unknown) {
    return this.courseIssues.escalate(parseId(id), body);
  }
}
