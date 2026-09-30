#!/usr/bin/env python3
"""비콘 출결 규모의 가상 샘플 생성기(개발용). 결과물은 저장소에 들어 있으므로 다시 만들 때만 실행한다.
  pip install openpyxl && python3 samples/generate_beacon_samples.py
비콘 출결 시스템이 내보낸 공식 출결 기록을 가정한다: 훈련생 30명 × 평일 10회차, 입·퇴실 시각이 분 단위로 흩어져 있다.
시스템 기능·정책은 바꾸지 않는다(출결은 웹 입력, 기기 식별자는 쓰지 않음) — 공식 출결 대사(S29)에 올리는 파일의 내용만 현실적으로 만든 것이다.
모든 이름·생년월일은 가상이다. 같은 seed 로 항상 같은 결과가 나온다."""
import json
import random
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

ROOT = Path(__file__).resolve().parent
rng = random.Random(20260914)

SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전']
GIVEN = ['민준', '서연', '지호', '하윤', '도현', '수아', '예준', '지우', '건우', '서윤', '현우', '지안', '우진', '하은', '선우',
         '다은', '시우', '유진', '주원', '채원', '지훈', '나은', '승현', '소율', '태윤', '아린', '재윤', '가영', '동현', '보라']
RESERVED = {'서주원', '박민재', '이하은', '정도윤', '최지우', '강예준', '윤태민'}  # 소규모 세트(A)의 이름과 겹치지 않게
TRAINEES = []
used = set()
for g in GIVEN:
    while True:
        name = rng.choice(SURNAMES) + g
        if name not in used and name not in RESERVED:
            break
    used.add(name)
    y = 1990 + rng.randint(0, 14)
    m = rng.randint(1, 12)
    d = rng.randint(1, 28)
    TRAINEES.append({'name': name, 'birth': f'{y}-{m:02d}-{d:02d}'})

DATES = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
         '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
WD = ['월', '화', '수', '목', '금', '월', '화', '수', '목', '금']
INTERNAL_ROUNDS = 5  # 1~5회차는 운영담당자가 웹에서 입력한 내부 기록이 있다. 6~10회차는 공식 자료만 있다.


def hm(minutes):
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


# 이수 위험군 시험용: 결석·지각이 잦은 훈련생 3명(전체 30명 중)
AT_RISK = {4, 13, 21}


def beacon_day(ti=-1):
    """한 사람의 하루 비콘 기록 → (status, check_in, check_out)"""
    p = rng.random()
    if ti in AT_RISK:  # 결석 35%, 지각 30%, 나머지는 보통
        if p < 0.35:
            return ('ABSENT', None, None)
        if p < 0.65:
            return ('LATE', 9 * 60 + rng.randint(11, 45), 18 * 60 + rng.randint(0, 8))
        p = 0.65 + rng.random() * 0.35
    if p < 0.02:
        return ('ABSENT', None, None)
    if p < 0.04:
        return ('EXCUSED', None, None)
    if p < 0.10:  # 지각: 09:11~09:45 (내부 지각 유예 10분 초과)
        cin = 9 * 60 + rng.randint(11, 45)
        return ('LATE', cin, 18 * 60 + rng.randint(0, 8))
    if p < 0.13:  # 조퇴: 15:00~17:20 퇴실
        return ('EARLY_LEAVE', 8 * 60 + rng.randint(40, 59), 15 * 60 + rng.randint(0, 140))
    cin = 8 * 60 + rng.randint(35, 59) if rng.random() < 0.7 else 9 * 60 + rng.randint(0, 9)
    cout = 18 * 60 + rng.randint(0, 12) if rng.random() < 0.94 else None  # 6%는 퇴실 비콘 누락
    return ('PRESENT', cin, cout)


records = {}  # (trainee_idx, day_idx) → (status, cin, cout)
for ti in range(len(TRAINEES)):
    for di in range(len(DATES)):
        records[(ti, di)] = beacon_day(ti)

# 내부 기록(1~5회차): 대부분 공식과 같고(±3분), 일부는 15분 넘게 다르거나 상태가 다르다 → 대사 때 "확인 필요"가 생긴다
internal = []  # {round, trainee, status, check_in, check_out}
mismatch = 0
for di in range(INTERNAL_ROUNDS):
    for ti in range(len(TRAINEES)):
        st, cin, cout = records[(ti, di)]
        if st == 'EXCUSED':
            continue  # 공가는 공식 자료로만 들어온다
        if st == 'ABSENT':
            internal.append({'round': di + 1, 'ti': ti, 'kind': 'absent'})
            continue
        icin = cin + rng.randint(-2, 3)
        icout = None if cout is None else cout + rng.randint(-3, 3)
        if rng.random() < 0.06:  # 불일치: 운영담당자가 입실을 늦게 눌러 20~50분 차이
            icin = cin + rng.randint(20, 50)
            mismatch += 1
        internal.append({'round': di + 1, 'ti': ti, 'kind': 'present', 'check_in': hm(icin), 'check_out': None if icout is None else hm(icout)})

# 공결(사유결석) 신청 시나리오: 공식 기록이 결석인 사람 3명(병원·예비군·면접)과 지각 1명(반려 예시)
absent = [(ti, di) for di in range(len(DATES)) for ti in range(len(TRAINEES)) if records[(ti, di)][0] == 'ABSENT']
late = [(ti, di) for di in range(len(DATES)) for ti in range(len(TRAINEES)) if records[(ti, di)][0] == 'LATE']
EXCUSE_PLAN = [('MEDICAL', '급성 장염으로 통원 치료', 'medical_certificate.png', 'PENDING'),
               ('MILITARY', '동원 예비군 훈련 소집', 'reserve_forces_notice.pdf', 'PENDING'),
               ('INTERVIEW', '채용 면접 응시', 'interview_confirmation.png', 'PENDING')]
excuses = []
for (ti, di), (reason, note, evidence, decision) in zip(absent, EXCUSE_PLAN):
    excuses.append({'ti': ti, 'round': di + 1, 'reason': reason, 'note': note, 'evidence': f'excuse_{len(excuses) + 1:02d}_{evidence}', 'kind': evidence, 'decision': decision})
if late:
    ti, di = late[0]
    excuses.append({'ti': ti, 'round': di + 1, 'reason': 'MEDICAL', 'note': '진료 후 지각', 'evidence': f'excuse_{len(excuses) + 1:02d}_medical_certificate.png', 'kind': 'medical_certificate.png', 'decision': 'REJECT', 'decision_note': '진료 시각이 지각 시각과 맞지 않아 반려'})

# ── 시나리오 JSON(setup-beacon-sample-data.mjs 가 읽는다) ───────────────────────
(ROOT / 'beacon-scenario.json').write_text(
    json.dumps({'trainees': TRAINEES, 'dates': DATES, 'instructors': ['노현우', '송지혜'], 'internal': internal, 'excuses': excuses}, ensure_ascii=False, indent=1), encoding='utf-8')

# ── 공식 출결 CSV(비콘 로그 형식) ───────────────────────────────────────────────
KOR = {'PRESENT': '출석', 'LATE': '지각', 'EARLY_LEAVE': '조퇴', 'ABSENT': '결석', 'EXCUSED': '인정결석'}
rows = ['round_no,trainee_name,birth_date,status,check_in,check_out']
for di in range(len(DATES)):
    for ti, t in enumerate(TRAINEES):
        st, cin, cout = records[(ti, di)]
        rows.append(f'{di + 1},{t["name"]},{t["birth"]},{KOR[st]},{"" if cin is None else hm(cin)},{"" if cout is None else hm(cout)}')
# 오류 행(반영되지 않고 사유가 표시된다)
rows += [
    f'11,{TRAINEES[0]["name"]},1990-01-01,출석,08:50,18:00',   # 없는 회차
    f'3,윤태민,,출석,08:50,18:00',           # 과정에 없는 훈련생
    f'4,{TRAINEES[2]["name"]},1980-05-05,출석,08:55,18:00',  # 생년월일이 다른 사람
    f'5,{TRAINEES[3]["name"]},,출석,9시,18:00',   # 시각 형식 오류
    f'6,{TRAINEES[4]["name"]},,미확인,08:55,18:00',  # 알 수 없는 상태
    f'7,{TRAINEES[5]["name"]},,출석,08:55,18:00',  # 같은 훈련생·회차 중복(아래 정상 행과 겹침)
]
(ROOT / 'official-attendance' / 'beacon_official_log_sample.csv').write_bytes(('﻿' + '\r\n'.join(rows) + '\r\n').encode('utf-8'))

# ── 공식 출석부 엑셀(기호 형식, 30명 × 10일) ─────────────────────────────────────
MARK = {'PRESENT': '○', 'LATE': '◎', 'EARLY_LEAVE': '▲', 'ABSENT': '×', 'EXCUSED': '▦15'}
wb = Workbook()
ws = wb.active
ws.title = 'sheet1'
thin = Side(style='thin', color='999999')
border = Border(left=thin, right=thin, top=thin, bottom=thin)
gray = PatternFill('solid', fgColor='E8E8E8')
center = Alignment(horizontal='center', vertical='center', wrap_text=True)
fixed = ['연번', '성명', '주민등록번호', '취약계층', '훈련생\n유형', '훈련생\n상태', '훈\n련\n일\n수', '출\n석\n일\n수', '결\n석\n일\n수', '휴\n가\n일\n수', '공\n가\n일\n수', '출석률\n일\n(%)', '출석률\n분\n(%)']
for i, title in enumerate(fixed, start=1):
    ws.cell(row=1, column=i, value=title)
    ws.merge_cells(start_row=1, start_column=i, end_row=3, end_column=i)
c0 = len(fixed) + 1
ws.cell(row=1, column=c0, value='2026년09월')
ws.merge_cells(start_row=1, start_column=c0, end_row=1, end_column=c0 + len(DATES) - 1)
day_nums = [int(d[-2:]) for d in DATES]
for j, d in enumerate(day_nums):
    ws.cell(row=2, column=c0 + j, value=d)
    ws.cell(row=3, column=c0 + j, value=WD[j])
for ti, t in enumerate(TRAINEES):
    r = 4 + ti
    marks = [MARK[records[(ti, di)][0]] for di in range(len(DATES))]
    att = sum(1 for m in marks if m[0] in '○◎▲▦')
    b = t['birth'].replace('-', '')[2:]
    ws.cell(row=r, column=1, value=ti + 1)
    ws.cell(row=r, column=2, value=t['name'])
    ws.cell(row=r, column=3, value=f'{b}-1******')
    ws.cell(row=r, column=6, value='훈련중')
    ws.cell(row=r, column=7, value=len(DATES))
    ws.cell(row=r, column=8, value=att)
    ws.cell(row=r, column=9, value=sum(1 for m in marks if m == '×'))
    for j, m in enumerate(marks):
        ws.cell(row=r, column=c0 + j, value=m)
for row in ws.iter_rows(min_row=1, max_row=3 + len(TRAINEES), min_col=1, max_col=c0 + len(DATES) - 1):
    for cell in row:
        cell.border = border
        cell.alignment = center
        if cell.row <= 3:
            cell.fill = gray
            cell.font = Font(bold=True)
ws.column_dimensions['B'].width = 14
ws.column_dimensions['C'].width = 18
guide = wb.create_sheet('안내')
for i, t in enumerate(['가상 데이터 — 비콘 출결 규모(30명 × 10일) 공식 출석부 샘플. 시스템은 첫 번째 시트만 읽습니다.',
                       '기호: ○ 출석 / × 결석 / ◎ 지각 / ▲ 조퇴 / ▦15 공가. 이 형식에는 입·퇴실 시각이 없어 시각 비교는 CSV 로 시험하세요.'], start=1):
    guide.cell(row=i, column=1, value=t)
wb.save(ROOT / 'official-attendance' / 'beacon_official_sheet_sample.xlsx')

stat = {}
for v in records.values():
    stat[v[0]] = stat.get(v[0], 0) + 1
print('기록 수', len(records), stat, '내부 기록', len(internal), '내부 불일치 심은 수', mismatch)
