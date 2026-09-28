import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditedTx, Row } from '../audit/audited-transaction.js';

export const conflict = (code: string, message: string): ConflictException => new ConflictException({ statusCode: 409, code, message });

// 상태 검사·중복 검사를 위해 행을 잠그고 읽는다(V5). 같은 트랜잭션의 update() 가 다시 잠가도 무방하다.
export async function lockRow(tx: AuditedTx, table: 'course' | 'instructor' | 'class_schedule' | 'trainee' | 'trainee_enrollment' | 'instructor_assignment' | 'attendance' | 'operation_log' | 'course_issue' | 'verification_case' | 'submission', pk: string, id: number): Promise<Row> {
  const { rows } = await tx.query(`SELECT * FROM ${table} WHERE ${pk} = $1 FOR UPDATE`, [id]);
  if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
  return rows[0];
}

export const CLOSED_COURSE = ['CLOSED', 'SUSPENDED'];

/** V7: 종료·중단 과정의 하위 데이터 변경 거부 */
export function assertCourseOpen(course: Row): void {
  if (CLOSED_COURSE.includes(course.status as string)) throw conflict('COURSE_LOCKED', '종료 또는 중단된 과정은 변경할 수 없습니다.');
}
