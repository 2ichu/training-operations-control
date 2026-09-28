import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { AttendanceService } from './attendance.service.js';

// 화면: S07 일일 출결, S08 과정별 출결, S09 출결 수정, S10 출결 수정이력 (baseline 5-2, Phase 2)
@Controller()
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly attendance: AttendanceService) {}

  // ── S07 ──
  @Get('schedules/:scheduleId/attendance-roster')
  @Authorize('S07', 'R')
  roster(@Req() req: RbacRequest, @Param('scheduleId') scheduleId: string, @Query() query: Record<string, unknown>) {
    return this.attendance.roster(req, parseId(scheduleId), query);
  }

  @Post('schedules/:scheduleId/attendance/check-in')
  @Authorize('S07', 'C')
  checkIn(@Req() req: RbacRequest, @Param('scheduleId') scheduleId: string, @Body() body: unknown) {
    return this.attendance.checkIn(req, parseId(scheduleId), body);
  }

  @Post('attendance/check-out')
  @HttpCode(200)
  @Authorize('S07', 'U')
  checkOut(@Req() req: RbacRequest, @Body() body: unknown) {
    return this.attendance.checkOut(req, body);
  }

  @Post('schedules/:scheduleId/attendance/confirm-absence')
  @Authorize('S07', 'A')
  confirmAbsence(@Req() req: RbacRequest, @Param('scheduleId') scheduleId: string, @Body() body: unknown) {
    return this.attendance.confirmAbsence(req, parseId(scheduleId), body);
  }

  // ── S08 ──
  @Get('courses/:id/attendance-matrix')
  @Authorize('S08', 'R')
  matrix(@Req() req: RbacRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.attendance.matrix(req, parseId(id), query);
  }

  // ── S09 ──
  @Get('attendance/:id')
  @Authorize('S09', 'R')
  detail(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.attendance.detail(req, parseId(id));
  }

  @Post('attendance/:id/correct')
  @HttpCode(200)
  @Authorize('S09', 'U')
  correct(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.attendance.correct(req, parseId(id), body);
  }

  // ── S10 ──
  @Get('attendance-change-logs')
  @Authorize('S10', 'R')
  changeLogs(@Query() query: Record<string, unknown>) {
    return this.attendance.changeLogs(query);
  }

  // ── S05 훈련생 상세의 출결 요약(baseline 5-2, 전 역할 ◎) ──
  @Get('trainees/:id/attendance-summary')
  @Authorize('S05', 'R')
  attendanceSummary(@Req() req: RbacRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.attendance.attendanceSummary(req, parseId(id), query);
  }
}
