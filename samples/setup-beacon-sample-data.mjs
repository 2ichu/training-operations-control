#!/usr/bin/env node
// 비콘 출결 규모(30명 × 10회차)의 가상 과정 준비 스크립트(선택 사항). 기본 setup-sample-data.mjs 와 같은 방식이며 과정만 다르다.
//
// - 이것은 DB 시드가 아니다. 앱이 화면에서 쓰는 것과 같은 API 로 로그인해서 만들기 때문에 감사 기록이 남고 권한 규칙도 그대로 적용된다.
// - 로컬 시험 전용이다. 운영 서버에는 실행하지 마라(가상 과정·훈련생이 실제 DB 에 남고 삭제 기능이 없다).
//   그래서 접속 대상이 localhost·127.0.0.1·web(컴포즈 내부 이름)이 아니면 SAMPLE_ALLOW_REMOTE=yes 없이는 실행을 거부한다.
// - 만드는 것: 시험 계정 2개(sample_ops·sample_ins, 이미 있으면 재사용), 가상 강사 1명, 가상 과정 1개, 가상 훈련생 30명(확정),
//   평일 10회차(2026-09-14~25), 그리고 1~5회차의 내부 출결(공식 자료와 일부 다름 → 대사 때 확인 필요가 생김).
// - 두 계정은 임시 비밀번호로 만들어지고 마지막에 한 번만 출력된다(첫 로그인 때 변경하게 된다).
//
// 필요한 것: Node 20 이상, 실행 중인 앱, 시스템 관리자 로그인(SAMPLE_ADMIN_LOGIN_ID / SAMPLE_ADMIN_PASSWORD).
//   관리자 비밀번호를 바꿨다면 바꾼 현재 값을 넣어야 한다. 값은 명령줄 기록에 남으니 로컬 시험용으로만 쓴다.
//   API_BASE 기본값은 http://localhost:8080

const API_BASE = (process.env.API_BASE ?? 'http://localhost:8080').replace(/\/$/, '')
const ADMIN_ID = process.env.SAMPLE_ADMIN_LOGIN_ID ?? process.env.SEED_ADMIN_LOGIN_ID
const ADMIN_PW = process.env.SAMPLE_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const host = new URL(API_BASE).hostname
if (!['localhost', '127.0.0.1', '::1', 'web'].includes(host) && process.env.SAMPLE_ALLOW_REMOTE !== 'yes') {
  console.error(`거부: ${host} 는 로컬 시험 대상이 아닙니다. 가상 데이터가 그 서버의 DB 에 영구히 남습니다.`)
  process.exit(2)
}
if (!ADMIN_ID || !ADMIN_PW) {
  console.error('시스템 관리자 계정이 필요합니다: SAMPLE_ADMIN_LOGIN_ID, SAMPLE_ADMIN_PASSWORD 를 환경변수로 전달하세요.')
  process.exit(2)
}

// ── 가상 데이터(generate_beacon_samples.py 가 만든 beacon-scenario.json) ───────────────
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
const scenario = JSON.parse(readFileSync(new URL('./beacon-scenario.json', import.meta.url), 'utf8'))
const COURSE_NAME = 'AI 활용 데이터 분석 실무 1기'
const INSTRUCTOR_NAMES = scenario.instructors
const TRAINEES = scenario.trainees
const ROUNDS = scenario.dates.map((date, i) => ({ round: i + 1, date }))
const KST = (date, hhmm) => new Date(`${date}T${hhmm}:00+09:00`).toISOString()

// ── 최소 API 클라이언트(세션 쿠키 보관) ────────────────────────────────────────────
class Session {
  cookie = ''
  async call(method, path, body) {
    const res = await fetch(`${API_BASE}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = res.headers.getSetCookie?.() ?? []
    if (setCookie.length) this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.code ?? ''} ${data?.message ?? text}`.trim())
    return data
  }
  async upload(path, file) {
    const form = new FormData()
    form.append('file', new Blob([readFileSync(new URL(`./excuse-evidence/${file}`, import.meta.url))]), basename(file))
    const res = await fetch(`${API_BASE}/api/v1${path}`, { method: 'POST', headers: this.cookie ? { Cookie: this.cookie } : {}, body: form })
    if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`)
  }
  login(loginId, password) {
    return this.call('POST', '/auth/login', { loginId, password })
  }
}
const step = (msg) => console.log(`• ${msg}`)

async function findAll(s, path, key, match) {
  for (let page = 1; page <= 20; page += 1) {
    const r = await s.call('GET', `${path}${path.includes('?') ? '&' : '?'}page=${page}&size=100`)
    const hit = r.items.find(match)
    if (hit || r.items.length < 100) return hit
  }
}

async function ensureUser(admin, loginId, name, role, linkedInstructorId) {
  const existing = await findAll(admin, '/users', 'items', (u) => u.loginId === loginId)
  if (existing) {
    const r = await admin.call('POST', `/users/${existing.userId}/reset-password`)
    return { userId: existing.userId, tempPassword: r.tempPassword }
  }
  const r = await admin.call('POST', '/users', { login_id: loginId, name, role, ...(linkedInstructorId ? { linked_instructor_id: linkedInstructorId } : {}) })
  return { userId: r.userId, tempPassword: r.tempPassword }
}

async function main() {
  const admin = new Session()
  await admin.login(ADMIN_ID, ADMIN_PW)
  step(`시스템 관리자 로그인 (${API_BASE})`)

  // 이미 만든 적이 있으면 중복으로 만들지 않고 안내만 한다
  const ops0 = await findAll(admin, '/users', 'items', (u) => u.loginId === 'sample_ops')
  if (ops0) {
    const ops = new Session()
    const reset = await admin.call('POST', `/users/${ops0.userId}/reset-password`)
    await ops.login('sample_ops', reset.tempPassword)
    const course = await findAll(ops, `/courses?name=${encodeURIComponent(COURSE_NAME)}`, 'items', (c) => c.courseName === COURSE_NAME)
    if (course) {
      console.log(`\n이미 가상 과정이 있습니다(과정 ID ${course.courseId}). 새로 만들지 않았습니다.`)
      console.log('처음부터 다시 하려면 로컬 DB 를 초기화하세요: docker compose --env-file deploy.env down -v')
      return
    }
  }

  // 강사 정보는 운영담당자만 만들 수 있다(시스템 관리자는 업무 데이터를 만들 수 없음) → 운영담당자 계정을 먼저 만든다
  const opsAcct = await ensureUser(admin, 'sample_ops', '문정아', 'OPS_MANAGER')
  const ops = new Session()
  await ops.login('sample_ops', opsAcct.tempPassword)
  step('시험 계정 sample_ops(운영담당자) 준비')

  const instructorIds = []
  for (const name of INSTRUCTOR_NAMES) {
    const ins = (await findAll(ops, `/instructors?name=${encodeURIComponent(name)}`, 'items', (i) => i.name === name))
      ?? (await ops.call('POST', '/instructors', { name, contact: '000-0000-0000' }))
    instructorIds.push(ins.instructorId)
  }
  const instructorId = instructorIds[0]
  step(`가상 강사 ${INSTRUCTOR_NAMES.join(', ')}`)

  const insAcct = await ensureUser(admin, 'sample_ins', '노현우', 'INSTRUCTOR', instructorId)
  step('시험 계정 sample_ins(강사, 위 강사에 연결) 준비')

  const course = await ops.call('POST', '/courses', {
    course_name: COURSE_NAME,
    start_date: '2026-09-14',
    end_date: '2026-10-30',
    total_hours: 80,
    training_site: '본관 302호',
    manager_user_id: opsAcct.userId,
    submission_due_date: '2026-10-09',
  })
  const courseId = course.courseId
  step(`가상 과정 (ID ${courseId})`)

  const schedules = {}
  for (const r of ROUNDS) {
    // 강사가 2명이라 회차별로 배정한다(과정 전체 담당은 1명만 가능)
    await ops.call('POST', `/courses/${courseId}/instructor-assignments`, { instructor_id: instructorIds[(r.round - 1) % instructorIds.length], round_no: r.round })
    const s = await ops.call('POST', `/courses/${courseId}/schedules`, {
      round_no: r.round, class_date: r.date, start_time: '09:00', end_time: '18:00', instructor_id: instructorIds[(r.round - 1) % instructorIds.length], content: `가상 수업 ${r.round}회차`,
    })
    schedules[r.round] = s.scheduleId
  }
  step(`회차 ${ROUNDS.length}개 (${ROUNDS[0].date} ~ ${ROUNDS.at(-1).date})`)

  const ids = {}
  for (const t of TRAINEES) {
    const e = await ops.call('POST', '/enrollments', { course_id: courseId, trainee: { name: t.name, birth_date: t.birth, contact: '000-0000-0000' } })
    await ops.call('POST', `/enrollments/${e.enrollment.enrollmentId}/start-review`)
    await ops.call('POST', `/enrollments/${e.enrollment.enrollmentId}/confirm`, { reason: '가상 데이터 시험용 확정' })
    ids[t.name] = e.trainee.traineeId
  }
  step(`가상 훈련생 ${TRAINEES.length}명 등록·확정`)

  // ── 내부 출결: 1~5회차를 운영담당자가 웹에서 입력한 것으로 가정(공식 비콘 자료와 대부분 같고 일부는 다름) ──
  let n = 0
  for (const r of scenario.internal) {
    const name = TRAINEES[r.ti].name
    if (r.kind === 'absent') {
      await ops.call('POST', `/schedules/${schedules[r.round]}/attendance/confirm-absence`, { trainee_ids: [ids[name]] })
    } else {
      const date = ROUNDS[r.round - 1].date
      const res = await ops.call('POST', `/schedules/${schedules[r.round]}/attendance/check-in`, { trainee_ids: [ids[name]], check_in_time: KST(date, r.check_in) })
      if (r.check_out) await ops.call('POST', '/attendance/check-out', { attendance_ids: res.created.map((a) => a.attendanceId), check_out_time: KST(date, r.check_out) })
    }
    n += 1
  }
  step(`내부 출결 ${n}건(1~5회차). 6~10회차는 공식 자료만 있음`)

  await ops.call('POST', `/courses/${courseId}/start`, { acknowledge_no_confirmed_trainees: false })
  step('과정 운영중 전환')

  // 공결(사유결석) 신청: 증빙서류를 붙여 승인 대기로 두고(화면에서 승인·반려해 보세요), 1건은 반려까지 처리해 둔다
  for (const e of scenario.excuses ?? []) {
    const created = await ops.call('POST', '/excuse-requests', { trainee_id: ids[TRAINEES[e.ti].name], schedule_id: schedules[e.round], reason_type: e.reason, reason_note: e.note })
    await ops.upload(`/excuse-requests/${created.requestId}/evidence`, e.evidence)
    if (e.decision === 'REJECT') await ops.call('POST', `/excuse-requests/${created.requestId}/reject`, { decision_note: e.decision_note })
  }
  step(`공결 신청 ${(scenario.excuses ?? []).length}건(증빙 첨부, 승인 대기 ${(scenario.excuses ?? []).filter((e) => e.decision !== 'REJECT').length}건 + 반려 1건)`)

  console.log(`
완료. 가상 과정 '${COURSE_NAME}' (ID ${courseId}) 이 준비되었습니다.

시험 계정(임시 비밀번호 — 첫 로그인 때 새 비밀번호로 바꾸게 됩니다. 이 화면에서만 볼 수 있습니다)
  운영담당자  sample_ops  ${opsAcct.tempPassword}
  강사        sample_ins  ${insAcct.tempPassword}

다음: 운영담당자(sample_ops)로 로그인해 출결 관리 → 공식 출결 대사에서 samples/official-attendance/beacon_official_log_sample.csv (또는 beacon_official_sheet_sample.xlsx) 를 올려 보세요.`)
}

main().catch((e) => {
  console.error(`\n실패: ${e.message}`)
  process.exit(1)
})
