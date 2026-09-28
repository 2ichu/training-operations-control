import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditContext } from '../audit/audit-context.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { toApi } from '../common/api.js';
import { asObject, type Obj, oneOf, qInt } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import { recordAccessDenied } from '../rbac/access-denied.js';
import { PermissionService } from '../rbac/permission.service.js';
import type { PermissionAction, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';

// entity_type 3종 모두 지원한다(baseline 7-19·7-20행: "S17·S18·S19" 공용 엔드포인트). 화면별로 필요한 권한이 서로 달라
// (S17 은 C 또는 U, S18 은 C 또는 U, S19 는 C 전용/조회는 R) RBAC 가드는 라우트당 화면 하나만 선언할 수 있으므로,
// 컨트롤러의 @Authorize 는 "S19:R"(4개 역할 모두 어떤 형태로든 보유)로 최소 인증 게이트만 두고, 실제 권한은 아래
// authorizeParent() 가 entity_type 에 맞는 화면·기능을 다시 조회해 판단한다.
const ENTITY_SCREENS: Record<'SUBMISSION' | 'OPERATION_LOG' | 'COURSE_ISSUE', string> = {
  SUBMISSION: 'S19',
  OPERATION_LOG: 'S17',
  COURSE_ISSUE: 'S18',
};
const SUPPORTED_ENTITY_TYPES = Object.keys(ENTITY_SCREENS) as (keyof typeof ENTITY_SCREENS)[];
type SupportedEntityType = (typeof SUPPORTED_ENTITY_TYPES)[number];

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
// D-14(저장 인프라·용량 제한) 정책 확정 전 임시 기술적 안전장치(정책 아님) — 비공개 로컬 저장소(baseline 현재 잠정안).
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface UploadedFileLike {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class AttachmentService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
    @Inject(AuditContext) private readonly auditContext: AuditContext,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  // multipart/form-data 요청이라 entity_id·entity_version 은 문자열로 들어온다(JSON 본문 전용 reqInt/optInt 대신 qInt 재사용).
  async upload(request: RbacRequest, body: unknown, file: UploadedFileLike | undefined) {
    const o = asObject(body);
    const entityType = oneOf(o.entity_type, 'entity_type', SUPPORTED_ENTITY_TYPES);
    const entityId = qInt(o, 'entity_id');
    if (entityId === undefined) throw new BadRequestException({ code: 'VALIDATION', field: 'entity_id', message: '필수입니다' });
    if (!file) throw new BadRequestException({ code: 'VALIDATION', field: 'file', message: '파일이 필요합니다' });
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: `파일은 ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)}MB 이하여야 합니다` });

    const parent = await this.authorizeParent(request, entityType, entityId, 'WRITE');
    // entity_version 은 SUBMISSION 만 사용(재등록 버전 구분). 그 외 유형은 NULL(ck_attachment_entity_version_submission_only).
    const entityVersion = entityType === 'SUBMISSION' ? (qInt(o, 'entity_version') ?? Number(parent.version)) : null;

    await mkdir(UPLOAD_DIR, { recursive: true });
    const storedName = `${randomUUID()}-${basename(file.originalname)}`;
    // ponytail: 파일쓰기와 DB 커밋이 분리되어 있다(트랜잭션 아님) — DB 실패 시 orphan 파일이 남을 수 있음, 정리 배치는 필요해지면 추가.
    await writeFile(join(UPLOAD_DIR, storedName), file.buffer);

    return this.transactions.run(async (tx) => {
      const created = await tx.create('attachment', {
        entity_type: entityType,
        entity_id: entityId,
        entity_version: entityVersion,
        file_name: file.originalname,
        file_path: storedName,
        file_size: file.size,
        uploaded_by: tx.actor.actorUserId,
      });
      return toApi(created);
    });
  }

  async download(request: RbacRequest, attachmentId: number): Promise<{ absolutePath: string; fileName: string }> {
    const { rows } = await this.db.query(`SELECT * FROM attachment WHERE attachment_id = $1`, [attachmentId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    const row = rows[0];
    await this.authorizeParent(request, row.entity_type as SupportedEntityType, Number(row.entity_id), 'READ');

    const actor = this.auditContext.require();
    await this.audit.record({ actorType: 'USER', actorUserId: actor.actorUserId, action: 'VIEW_SENSITIVE', targetTable: 'attachment', targetId: attachmentId, ip: actor.ip });
    return { absolutePath: join(UPLOAD_DIR, row.file_path as string), fileName: row.file_name as string };
  }

  // 부모 엔티티 존재 확인 + 스코프 검증(각 화면의 기존 규칙 그대로) + 화면별 실제 권한(C/U 중 하나, 또는 R) 확인.
  private async authorizeParent(request: RbacRequest, entityType: SupportedEntityType, entityId: number, mode: 'WRITE' | 'READ'): Promise<Row> {
    const access = request.access!;
    const screen = ENTITY_SCREENS[entityType];

    if (entityType === 'SUBMISSION') {
      const row = await this.findParent('submission', 'submission_id', entityId, 'course_id, version');
      await this.scope.requireCourse(request, Number(row.course_id));
      await this.requirePermission(request, screen, mode === 'WRITE' ? 'C' : 'R');
      return row;
    }
    if (entityType === 'OPERATION_LOG') {
      const row = await this.findParent('operation_log', 'operation_log_id', entityId, 'schedule_id');
      await this.scope.requireSchedule(request, Number(row.schedule_id));
      if (mode === 'WRITE') await this.requireAnyPermission(request, screen, ['C', 'U']);
      else await this.requirePermission(request, screen, 'R');
      return row;
    }
    // COURSE_ISSUE: INSTRUCTOR 스코프는 다른 화면과 달리 "본인 등록 건"(reported_by=본인) — CourseIssueService.list() 와 동일 규칙.
    const row = await this.findParent('course_issue', 'issue_id', entityId, 'course_id, reported_by');
    if (access.scope !== 'ALL' && Number(row.reported_by) !== access.userId) {
      await recordAccessDenied(this.audit, request, access.userId, 'SCOPE_VIOLATION:course_issue');
      throw new NotFoundException('대상을 찾을 수 없습니다.');
    }
    if (mode === 'WRITE') await this.requireAnyPermission(request, screen, ['C', 'U']);
    else await this.requirePermission(request, screen, 'R');
    return row;
  }

  private async findParent(table: string, pk: string, id: number, columns: string): Promise<Row> {
    const { rows } = await this.db.query(`SELECT ${columns} FROM ${table} WHERE ${pk} = $1`, [id]);
    if (rows.length === 0) throw new BadRequestException({ code: 'VALIDATION', field: 'entity_id', message: '존재하지 않는 대상입니다' });
    return rows[0];
  }

  private async requirePermission(request: RbacRequest, screenId: string, action: PermissionAction): Promise<void> {
    const access = request.access!;
    const result = await this.permissions.lookup(access.userId, screenId, action);
    if (result.status !== 'OK') {
      await recordAccessDenied(this.audit, request, access.userId, `NO_PERMISSION:${screenId}:${action}`);
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
  }

  private async requireAnyPermission(request: RbacRequest, screenId: string, actions: PermissionAction[]): Promise<void> {
    const access = request.access!;
    for (const action of actions) {
      if ((await this.permissions.lookup(access.userId, screenId, action)).status === 'OK') return;
    }
    await recordAccessDenied(this.audit, request, access.userId, `NO_PERMISSION:${screenId}:${actions.join('|')}`);
    throw new ForbiddenException('접근 권한이 없습니다.');
  }
}
