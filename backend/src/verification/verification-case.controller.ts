import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import { VerificationCaseService } from './verification-case.service.js';

// 화면: S22 확인 필요 목록, S23 확인 필요 상세, S24 조치이력 (baseline 5-2). INSTRUCTOR 는 권한 미부여로 전면 접근 불가.
@Controller()
export class VerificationCaseController {
  constructor(@Inject(VerificationCaseService) private readonly cases: VerificationCaseService) {}

  @Get('verification-cases')
  @Authorize('S22', 'R')
  list(@Query() query: Record<string, unknown>) {
    return this.cases.list(query);
  }

  @Post('verification-cases/assign')
  @HttpCode(200)
  @Authorize('S22', 'A')
  assign(@Body() body: unknown) {
    return this.cases.assign(body);
  }

  @Get('verification-cases/:id')
  @Authorize('S23', 'R')
  detail(@Param('id') id: string) {
    return this.cases.detail(parseId(id));
  }

  @Post('verification-cases/:id/start-review')
  @HttpCode(200)
  @Authorize('S23', 'A')
  startReview(@Param('id') id: string, @Body() body: unknown) {
    return this.cases.startReview(parseId(id), body);
  }

  @Post('verification-cases/:id/complete-confirmation')
  @HttpCode(200)
  @Authorize('S23', 'A')
  completeConfirmation(@Param('id') id: string, @Body() body: unknown) {
    return this.cases.completeConfirmation(parseId(id), body);
  }

  @Post('verification-cases/:id/require-action')
  @HttpCode(200)
  @Authorize('S23', 'A')
  requireAction(@Param('id') id: string, @Body() body: unknown) {
    return this.cases.requireAction(parseId(id), body);
  }

  @Post('verification-cases/:id/complete-action')
  @HttpCode(200)
  @Authorize('S23', 'A')
  completeAction(@Param('id') id: string, @Body() body: unknown) {
    return this.cases.completeAction(parseId(id), body);
  }

  @Post('verification-cases/:id/reopen')
  @HttpCode(200)
  @Authorize('S23', 'A')
  reopen(@Param('id') id: string, @Body() body: unknown) {
    return this.cases.reopen(parseId(id), body);
  }

  @Get('verification-action-logs')
  @Authorize('S24', 'R')
  actionLogs(@Query() query: Record<string, unknown>) {
    return this.cases.actionLogs(query);
  }

  // S05 훈련생 상세의 "관련 확인 건" — OPS·EXEC·SYS 전용(baseline 5-2). S05:R(INSTRUCTOR 포함)과 구분하기 위해 A 재사용.
  @Get('trainees/:id/verification-cases')
  @Authorize('S05', 'A')
  byTrainee(@Param('id') id: string) {
    return this.cases.byTrainee(parseId(id));
  }
}
