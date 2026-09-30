#!/usr/bin/env node
// 시험용 가상 과정 준비 스크립트(선택 사항). README 의 "준비 A"를 한 번에 해 준다.
//
// - 이것은 DB 시드가 아니다. 앱이 화면에서 쓰는 것과 같은 API 로 로그인해서 만들기 때문에 감사 기록이 남고 권한 규칙도 그대로 적용된다.
// - 로컬 시험 전용이다. 운영 서버에는 실행하지 마라(가상 과정·훈련생이 실제 DB 에 남고 삭제 기능이 없다).
//   그래서 접속 대상이 localhost·127.0.0.1·web(컴포즈 내부 이름)이 아니면 SAMPLE_ALLOW_REMOTE=yes 없이는 실행을 거부한다.
// - 만드는 것: 시험 계정 2개(sample_ops 운영담당자·sample_ins 강사), 가상 강사 1명, 가상 과정 1개, 가상 훈련생 6명(확정),
//   회차 4개(2026-09-21~24), 그리고 회차 1·3 의 내부 출결(대사 시험의 "내부 기록" 역할).
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

// ── 가상 데이터(generate_samples.py·README 와 같은 값) ────────────────────────────
const COURSE_NAME = '웹 프로그래밍 기초 1기'
const INSTRUCTOR_NAME = '한상우'
const TRAINEES = [
  { name: '서주원', birth: '1998-03-15' },
  { name: '박민재', birth: '1999-07-21' },
  { name: '이하은', birth: '2000-01-09' },
  { name: '정도윤', birth: '1997-11-30' },
  { name: '최지우', birth: '2001-05-05' },
  { name: '강예준', birth: '1996-09-12' },
]
const ROUNDS = [
  { round: 1, date: '2026-09-21' },
  { round: 2, date: '2026-09-22' },
  { round: 3, date: '2026-09-23' },
  { round: 4, date: '2026-09-24' },
]
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

  const instructor = (await findAll(ops, `/instructors?name=${encodeURIComponent(INSTRUCTOR_NAME)}`, 'items', (i) => i.name === INSTRUCTOR_NAME))
    ?? (await ops.call('POST', '/instructors', { name: INSTRUCTOR_NAME, contact: '000-0000-0000' }))
  const instructorId = instructor.instructorId
  step(`가상 강사 '${INSTRUCTOR_NAME}' (ID ${instructorId})`)

  const insAcct = await ensureUser(admin, 'sample_ins', '한상우계정', 'INSTRUCTOR', instructorId)
  step('시험 계정 sample_ins(강사, 위 강사에 연결) 준비')

  const course = await ops.call('POST', '/courses', {
    course_name: COURSE_NAME,
    start_date: '2026-09-07',
    end_date: '2026-10-30',
    total_hours: 160,
    training_site: '본관 301호',
    manager_user_id: opsAcct.userId,
    submission_due_date: '2026-09-30',
  })
  const courseId = course.courseId
  step(`가상 과정 (ID ${courseId})`)

  await ops.call('POST', `/courses/${courseId}/instructor-assignments`, { instructor_id: instructorId })
  const schedules = {}
  for (const r of ROUNDS) {
    const s = await ops.call('POST', `/courses/${courseId}/schedules`, {
      round_no: r.round, class_date: r.date, start_time: '09:00', end_time: '18:00', instructor_id: instructorId, content: `가상 수업 ${r.round}회차`,
    })
    schedules[r.round] = s.scheduleId
  }
  step(`회차 4개 (${ROUNDS.map((r) => r.date).join(', ')})`)

  const ids = {}
  for (const t of TRAINEES) {
    const e = await ops.call('POST', '/enrollments', { course_id: courseId, trainee: { name: t.name, birth_date: t.birth, contact: '000-0000-0000' } })
    await ops.call('POST', `/enrollments/${e.enrollment.enrollmentId}/start-review`)
    await ops.call('POST', `/enrollments/${e.enrollment.enrollmentId}/confirm`, { reason: '가상 데이터 시험용 확정' })
    ids[t.name] = e.trainee.traineeId
  }
  step(`가상 훈련생 ${TRAINEES.length}명 등록·확정`)

  // ── 내부 출결(공식 출결 대사에서 "내부 기록"이 되는 것) ──
  const checkIn = async (round, names, time) => {
    const r = await ops.call('POST', `/schedules/${schedules[round]}/attendance/check-in`, {
      trainee_ids: names.map((n) => ids[n]), check_in_time: KST(ROUNDS[round - 1].date, time),
    })
    return r.created
  }
  await checkIn(1, ['서주원', '박민재'], '09:00')
  await checkIn(1, ['이하은'], '09:20') // 지각 유예 10분을 넘어 자동으로 지각
  await checkIn(1, ['최지우'], '08:55')
  await ops.call('POST', `/schedules/${schedules[1]}/attendance/confirm-absence`, { trainee_ids: [ids['정도윤']] })
  const r3 = await checkIn(3, ['서주원'], '09:00')
  await ops.call('POST', '/attendance/check-out', { attendance_ids: r3.map((a) => a.attendanceId), check_out_time: KST('2026-09-23', '18:00') })
  await checkIn(3, ['박민재'], '09:00')
  step('내부 출결: 1회차(가온·나래 출석, 다솜 지각, 마루 출석, 라온 결석) / 3회차(가온 09:00~18:00, 나래 09:00)')

  await ops.call('POST', `/courses/${courseId}/start`, { acknowledge_no_confirmed_trainees: false })
  step('과정 운영중 전환')

  console.log(`
완료. 가상 과정 '${COURSE_NAME}' (ID ${courseId}) 이 준비되었습니다.

시험 계정(임시 비밀번호 — 첫 로그인 때 새 비밀번호로 바꾸게 됩니다. 이 화면에서만 볼 수 있습니다)
  운영담당자  sample_ops  ${opsAcct.tempPassword}
  강사        sample_ins  ${insAcct.tempPassword}

다음: 운영담당자(sample_ops)로 로그인해 출결 관리 → 공식 출결 대사에서 samples/official-attendance 의 파일을 올려 보세요.`)
}

main().catch((e) => {
  console.error(`\n실패: ${e.message}`)
  process.exit(1)
})
