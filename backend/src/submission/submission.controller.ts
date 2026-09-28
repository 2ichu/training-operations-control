import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { SubmissionService } from './submission.service.js';

// 화면: S19 결과물 제출현황(+S20 미제출, 같은 API 재사용), S21 결과물 검토, S05 훈련생 상세의 결과물 현황 (baseline 5-2)
@Controller()
export class SubmissionController {
  constructor(@Inject(SubmissionService) private readonly submissions: SubmissionService) {}

  @Get('courses/:id/submission-status')
  @Authorize('S19', 'R')
  submissionStatus(@Req() req: RbacRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.submissions.submissionStatus(req, parseId(id), query);
  }

  @Post('courses/:id/submissions')
  @Authorize('S19', 'C')
  register(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.submissions.register(req, parseId(id), body);
  }

  @Post('submissions/:id/re-register')
  @HttpCode(200)
  @Authorize('S19', 'U')
  reRegister(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.submissions.reRegister(req, parseId(id), body);
  }

  @Get('submissions/:id')
  @Authorize('S21', 'R')
  detail(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.submissions.detail(req, parseId(id));
  }

  @Post('submissions/:id/reviews')
  @Authorize('S21', 'C')
  review(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.submissions.review(req, parseId(id), body);
  }

  @Get('trainees/:id/submissions')
  @Authorize('S05', 'R')
  byTrainee(@Req() req: RbacRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.submissions.byTrainee(req, parseId(id), query);
  }
}
