import { Body, Controller, Get, Inject, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { AttachmentService } from './attachment.service.js';

// 화면: S17·S18·S19 첨부 업로드/다운로드 공용 엔드포인트(baseline 5-2, entity_type 3종 모두 지원).
// RBAC 가드는 라우트당 화면 하나만 선언할 수 있어, 4개 역할 모두 어떤 형태로든 보유한 S19:R 을 최소 인증 게이트로
// 두고, entity_type 에 맞는 실제 화면·기능(S17/S18/S19 의 C·U·R)은 AttachmentService.authorizeParent() 가 다시 확인한다.
@Controller()
export class AttachmentController {
  constructor(@Inject(AttachmentService) private readonly attachments: AttachmentService) {}

  @Post('attachments')
  @Authorize('S19', 'R')
  // defParamCharset: 브라우저는 filename 을 UTF-8 로 보내는데 multer 기본값(latin1)으로 읽으면 한글 파일명이 깨진다
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), defParamCharset: 'utf8' }))
  upload(@Req() req: RbacRequest, @Body() body: unknown, @UploadedFile() file?: Express.Multer.File) {
    return this.attachments.upload(req, body, file);
  }

  @Get('attachments/:id/download')
  @Authorize('S19', 'R')
  async download(@Req() req: RbacRequest, @Param('id') id: string, @Res() res: Response) {
    const { absolutePath, fileName } = await this.attachments.download(req, parseId(id));
    res.download(absolutePath, fileName);
  }
}
