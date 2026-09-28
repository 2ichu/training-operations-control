import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AuditedTxError } from '../audit/audit-context.js';

// 제약조건 이름 → API 오류 코드
const CONSTRAINT_CODES: Record<string, string> = {
  uq_trainee_enrollment_active: 'ENROLLMENT_EXISTS',
  uq_class_schedule_course_round: 'ROUND_EXISTS',
  uq_instructor_assignment_active: 'ASSIGNMENT_CONFLICT',
  uq_instructor_assignment_course_wide: 'ASSIGNMENT_CONFLICT',
  uq_user_account_login_id: 'LOGIN_ID_EXISTS',
  uq_user_account_linked_instructor: 'INSTRUCTOR_ALREADY_LINKED',
  uq_attendance_trainee_schedule: 'ATTENDANCE_EXISTS',
  uq_operation_log_schedule: 'OPERATION_LOG_EXISTS',
  uq_submission_trainee_course_title: 'SUBMISSION_EXISTS',
  ck_course_dates: 'INVALID_DATE_RANGE',
  ck_course_total_hours: 'INVALID_TOTAL_HOURS',
  ck_operation_log_participant_count: 'INVALID_PARTICIPANT_COUNT',
};

// 서비스 계층 오류와 DB 제약 위반을 HTTP 응답으로 변환한다. 알 수 없는 오류의 내부 메시지는 응답에 노출하지 않는다.
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof AuditedTxError) {
      const status = exception.code === 'NOT_FOUND' ? 404 : exception.code === 'INVALID' ? 400 : 500;
      response.status(status).json({ statusCode: status, code: exception.code === 'INVALID' ? 'INVALID_REQUEST' : exception.code, message: exception.message });
      return;
    }
    const pgError = exception as { code?: string; constraint?: string };
    if (typeof pgError?.code === 'string' && /^(23|22)/.test(pgError.code)) {
      const code = (pgError.constraint && CONSTRAINT_CODES[pgError.constraint]) || undefined;
      if (pgError.code === '23505') return void response.status(409).json({ statusCode: 409, code: code ?? 'UNIQUE_VIOLATION', message: '이미 존재하는 값입니다' });
      if (pgError.code === '23503') return void response.status(409).json({ statusCode: 409, code: 'REFERENCE_VIOLATION', message: '참조 대상이 없거나 사용 중입니다' });
      if (pgError.code === '23514') return void response.status(400).json({ statusCode: 400, code: code ?? 'CHECK_VIOLATION', message: '허용되지 않는 값입니다' });
      if (pgError.code.startsWith('22')) return void response.status(400).json({ statusCode: 400, code: 'INVALID_VALUE', message: '값의 형식이 올바르지 않습니다' });
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    response.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
