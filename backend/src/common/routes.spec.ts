import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AttachmentController } from '../attachment/attachment.controller.js';
import { AttendanceController } from '../attendance/attendance.controller.js';
import { AuditLogViewController } from '../audit-log/audit-log-view.controller.js';
import { CourseIssueController } from '../course-issue/course-issue.controller.js';
import { CourseController } from '../course/course.controller.js';
import { DashboardController } from '../dashboard/dashboard.controller.js';
import { InstructorController } from '../instructor/instructor.controller.js';
import { OperationLogController } from '../operation-log/operation-log.controller.js';
import { REQUIRE_PERMISSION_KEY } from '../rbac/rbac.types.js';
import { RolePermissionController } from '../role-permission/role-permission.controller.js';
import { ScheduleController } from '../schedule/schedule.controller.js';
import { SubmissionController } from '../submission/submission.controller.js';
import { TraineeController } from '../trainee/trainee.controller.js';
import { UserController } from '../user/user.controller.js';
import { DetectionRuleController } from '../verification/detection-rule.controller.js';
import { VerificationCaseController } from '../verification/verification-case.controller.js';

const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// 컨트롤러의 모든 라우트 → "METHOD /경로" : "화면:기능"
function routes(controller: new (...args: never[]) => unknown): Record<string, string | undefined> {
  const base = (Reflect.getMetadata('path', controller) as string) ?? '';
  const out: Record<string, string | undefined> = {};
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = controller.prototype[name] as object;
    const method = Reflect.getMetadata('method', handler) as number | undefined;
    if (method === undefined) continue;
    const path = ((Reflect.getMetadata('path', handler) as string) ?? '').replace(/^\//, '');
    const key = `${REQUEST_METHODS[method]} /${[base, path].filter((p) => p && p !== '/').join('/')}`;
    const perm = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler) as { screenId: string; action: string } | undefined;
    out[key] = perm && `${perm.screenId}:${perm.action}`;
  }
  return out;
}

// baseline 5-2 의 화면·기능과 role_permission 매트릭스에 대응하는 기대값. 새 라우트는 여기에 추가해야 통과한다(권한 누락 방지).
const EXPECTED: Record<string, string> = {
  'GET /courses': 'S15:R',
  'GET /courses/:id': 'S16:R',
  'POST /courses': 'S16:C',
  'PATCH /courses/:id': 'S16:U',
  'POST /courses/:id/open-recruitment': 'S16:U',
  'POST /courses/:id/start': 'S16:U',
  'POST /courses/:id/suspend': 'S16:U',
  'GET /courses/:id/closure-checklist': 'S16:A',
  'POST /courses/:id/close': 'S16:U',

  'GET /instructors': 'S11:R',
  'GET /instructors/:id': 'S12:R',
  'POST /instructors': 'S12:C',
  'PATCH /instructors/:id': 'S12:U',
  'GET /instructor-change-logs': 'S14:R',

  'GET /enrollments': 'S02:R',
  'GET /courses/:id/completion-candidates': 'S02:R',
  'POST /enrollments/:id/start-review': 'S02:U',
  'POST /enrollments/:id/confirm': 'S02:U',
  'POST /enrollments/:id/reject': 'S02:U',
  'POST /enrollments/:id/complete': 'S02:U',
  'POST /enrollments/:id/drop': 'S02:U',
  'POST /enrollments/:id/expel': 'S02:U',
  'POST /enrollments': 'S04:C',
  'GET /trainees/search': 'S04:R',
  'PATCH /trainees/:id': 'S04:U',
  'GET /trainees': 'S03:R',
  'GET /trainees/:id': 'S05:R',
  'GET /trainees/:id/enrollments': 'S05:R',
  'GET /trainees/:id/attendance-summary': 'S05:R',
  'GET /trainees/:id/verification-cases': 'S05:A',
  'GET /trainee-change-logs': 'S06:R',

  'GET /schedules': 'S13:R',
  'POST /courses/:id/schedules': 'S13:C',
  'PATCH /schedules/:id': 'S13:U',
  'POST /schedules/:id/cancel-class': 'S13:U',
  'POST /schedules/:id/reassign-instructor': 'S13:U',
  'POST /courses/:id/instructor-assignments': 'S13:C',
  'POST /instructor-assignments/:id/cancel': 'S13:U',

  'GET /roles/permissions': 'S26:R',
  'PUT /roles/:id/permissions': 'S26:U',

  'GET /audit-logs': 'S27:R',
  'GET /audit-logs/:id': 'S27:R',

  'GET /detection-rules': 'S28:R',
  'PATCH /detection-rules/:id': 'S28:U',

  'GET /users': 'S25:R',
  'GET /users/:id': 'S25:R',
  'POST /users': 'S25:C',
  'PATCH /users/:id': 'S25:U',
  'POST /users/:id/reset-password': 'S25:U',

  'GET /schedules/:scheduleId/attendance-roster': 'S07:R',
  'POST /schedules/:scheduleId/attendance/check-in': 'S07:C',
  'POST /attendance/check-out': 'S07:U',
  'POST /schedules/:scheduleId/attendance/confirm-absence': 'S07:A',
  'GET /courses/:id/attendance-matrix': 'S08:R',
  'GET /attendance/:id': 'S09:R',
  'POST /attendance/:id/correct': 'S09:U',
  'GET /attendance-change-logs': 'S10:R',

  'GET /courses/:id/operation-logs': 'S17:R',
  'GET /schedules/:id/operation-log': 'S17:R',
  'POST /schedules/:id/operation-log': 'S17:C',
  'PATCH /operation-logs/:id': 'S17:U',

  'GET /course-issues': 'S18:R',
  'POST /course-issues': 'S18:C',
  'PATCH /course-issues/:id': 'S18:U',
  'POST /course-issues/:id/resolve': 'S18:U',
  'POST /course-issues/:id/escalate': 'S18:A',

  'GET /verification-cases': 'S22:R',
  'POST /verification-cases/assign': 'S22:A',
  'GET /verification-cases/:id': 'S23:R',
  'POST /verification-cases/:id/start-review': 'S23:A',
  'POST /verification-cases/:id/complete-confirmation': 'S23:A',
  'POST /verification-cases/:id/require-action': 'S23:A',
  'POST /verification-cases/:id/complete-action': 'S23:A',
  'POST /verification-cases/:id/reopen': 'S23:A',
  'GET /verification-action-logs': 'S24:R',

  'GET /courses/:id/submission-status': 'S19:R',
  'POST /courses/:id/submissions': 'S19:C',
  'POST /submissions/:id/re-register': 'S19:U',
  'GET /submissions/:id': 'S21:R',
  'POST /submissions/:id/reviews': 'S21:C',
  'GET /trainees/:id/submissions': 'S05:R',

  'POST /attachments': 'S19:R',
  'GET /attachments/:id/download': 'S19:R',

  'GET /dashboard': 'S01:R',
};

describe('도메인 API 라우트 권한 메타데이터', () => {
  const actual = {
    ...routes(CourseController),
    ...routes(InstructorController),
    ...routes(TraineeController),
    ...routes(ScheduleController),
    ...routes(RolePermissionController),
    ...routes(AuditLogViewController),
    ...routes(UserController),
    ...routes(AttendanceController),
    ...routes(OperationLogController),
    ...routes(CourseIssueController),
    ...routes(VerificationCaseController),
    ...routes(DetectionRuleController),
    ...routes(SubmissionController),
    ...routes(AttachmentController),
    ...routes(DashboardController),
  };

  it('모든 라우트에 @Authorize 가 있고 baseline 화면·기능과 일치한다', () => {
    expect(actual).toEqual(EXPECTED);
  });

  it('DELETE 메서드 라우트가 없다(hard delete 금지, baseline 8절)', () => {
    expect(Object.keys(actual).filter((k) => k.startsWith('DELETE '))).toEqual([]);
  });
});
