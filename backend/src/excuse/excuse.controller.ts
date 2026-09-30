import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { ExcuseService } from './excuse.service.js';

// 화면: S30 공결(사유결석) 신청·승인. 등록·증빙 추가는 S30:C, 조회·증빙 보기는 S30:R, 승인·반려는 S30:U.
@Controller('excuse-requests')
export class ExcuseController {
  constructor(@Inject(ExcuseService) private readonly excuse: ExcuseService) {}

  @Get()
  @Authorize('S30', 'R')
  list(@Req() req: RbacRequest, @Query() query: Record<string, unknown>) {
    return this.excuse.list(req, query);
  }

  @Get(':id')
  @Authorize('S30', 'R')
  detail(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.excuse.detail(req, parseId(id));
  }

  @Post()
  @Authorize('S30', 'C')
  create(@Req() req: RbacRequest, @Body() body: unknown) {
    return this.excuse.create(req, body);
  }

  @Post(':id/evidence')
  @Authorize('S30', 'C')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), defParamCharset: 'utf8' }))
  addEvidence(@Req() req: RbacRequest, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.excuse.addEvidence(req, parseId(id), file);
  }

  // 미리보기(이미지·PDF)용으로 inline 으로 내려준다. 형식은 업로드 때 검증한 MIME 만 쓰고 nosniff 를 붙인다.
  @Get(':id/evidence/:evidenceId')
  @Authorize('S30', 'R')
  async evidence(@Req() req: RbacRequest, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Res() res: Response) {
    const { absolutePath, fileName, mime } = await this.excuse.evidenceFile(req, parseId(id), parseId(evidenceId));
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.sendFile(absolutePath);
  }

  @Post(':id/approve')
  @Authorize('S30', 'U')
  approve(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.excuse.approve(req, parseId(id), body);
  }

  @Post(':id/reject')
  @Authorize('S30', 'U')
  reject(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.excuse.reject(req, parseId(id), body);
  }
}
