import { Controller, Get, Inject, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { OfficialAttendanceService } from './official-attendance.service.js';

// 화면: S29 공식 출결 대사(D-12 확정: CSV 파일 업로드). 업로드·반영은 OPS_MANAGER(S29:C), 이력 조회는 SYS·EXEC 도 가능(S29:R).
@Controller()
export class OfficialAttendanceController {
  constructor(@Inject(OfficialAttendanceService) private readonly official: OfficialAttendanceService) {}

  @Post('courses/:courseId/official-attendance')
  @Authorize('S29', 'C')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), defParamCharset: 'utf8' }))
  upload(@Req() req: RbacRequest, @Param('courseId') courseId: string, @UploadedFile() file?: Express.Multer.File) {
    return this.official.importFile(req, parseId(courseId), file);
  }

  @Get('official-attendance-imports')
  @Authorize('S29', 'R')
  list(@Query() query: Record<string, unknown>) {
    return this.official.listBatches(query);
  }

  @Get('official-attendance-imports/:batchId')
  @Authorize('S29', 'R')
  rows(@Param('batchId') batchId: string) {
    return this.official.batchRows(batchId);
  }
}
