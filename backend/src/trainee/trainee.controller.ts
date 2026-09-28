import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { TraineeService } from './trainee.service.js';

// 화면: S02 대상자 확인, S03 훈련생 목록, S04 훈련생 등록, S05 훈련생 상세, S06 훈련생 변경이력 (baseline 5-2)
@Controller()
export class TraineeController {
  constructor(@Inject(TraineeService) private readonly trainees: TraineeService) {}

  // ── S02 ──
  @Get('enrollments')
  @Authorize('S02', 'R')
  listEnrollments(@Query() query: Record<string, unknown>) {
    return this.trainees.listEnrollments(query);
  }

  // D-05 §6(2026-09-28 확정): 자동 판정은 후보 표시까지만, 최종 확정은 complete/drop/expel 로 사람이 실행
  @Get('courses/:id/completion-candidates')
  @Authorize('S02', 'R')
  completionCandidates(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.trainees.completionCandidates(req, parseId(id));
  }

  @Post('enrollments/:id/start-review')
  @HttpCode(200)
  @Authorize('S02', 'U')
  startReview(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.trainees.startReview(req, parseId(id), body);
  }

  @Post('enrollments/:id/confirm')
  @HttpCode(200)
  @Authorize('S02', 'U')
  confirm(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.trainees.confirm(req, parseId(id), body);
  }

  @Post('enrollments/:id/reject')
  @HttpCode(200)
  @Authorize('S02', 'U')
  reject(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.trainees.reject(req, parseId(id), body);
  }

  // P1-04(2026-09-22 확정): 수료·중도포기·제적 — 확정(CONFIRMED) 상태에서 수동 전환, 자동 판정 없음
  @Post('enrollments/:id/complete')
  @HttpCode(200)
  @Authorize('S02', 'U')
  complete(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.trainees.complete(req, parseId(id), body);
  }

  @Post('enrollments/:id/drop')
  @HttpCode(200)
  @Authorize('S02', 'U')
  drop(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.trainees.drop(req, parseId(id), body);
  }

  @Post('enrollments/:id/expel')
  @HttpCode(200)
  @Authorize('S02', 'U')
  expel(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.trainees.expel(req, parseId(id), body);
  }

  // ── S04 ──
  @Post('enrollments')
  @Authorize('S04', 'C')
  createEnrollment(@Req() req: RbacRequest, @Body() body: unknown) {
    return this.trainees.createEnrollment(req, body);
  }

  @Get('trainees/search')
  @Authorize('S04', 'R')
  search(@Query() query: Record<string, unknown>) {
    return this.trainees.search(query);
  }

  @Patch('trainees/:id')
  @Authorize('S04', 'U')
  updateTrainee(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.trainees.updateTrainee(req, parseId(id), body);
  }

  // ── S03 / S05 (강사 스코프 적용) ──
  @Get('trainees')
  @Authorize('S03', 'R')
  list(@Req() req: RbacRequest, @Query() query: Record<string, unknown>) {
    return this.trainees.list(req.access!, query);
  }

  @Get('trainees/:id')
  @Authorize('S05', 'R')
  detail(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.trainees.detail(req, parseId(id));
  }

  @Get('trainees/:id/enrollments')
  @Authorize('S05', 'R')
  enrollments(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.trainees.enrollments(req, parseId(id));
  }

  // ── S06 ──
  @Get('trainee-change-logs')
  @Authorize('S06', 'R')
  changeLogs(@Query() query: Record<string, unknown>) {
    return this.trainees.changeLogs(query);
  }
}
