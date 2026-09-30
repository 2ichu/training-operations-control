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

GIVEN = ['가온', '나래', '다솜', '라온', '마루', '바다', '사랑', '아름', '자람', '차오', '카이', '타온', '하늘', '고운', '나빛',
         '다온', '라희', '모아', '보람', '소담', '여울', '이든', '준서', '지안', '채원', '하율', '해솔', '휘온', '누리', '새봄']
TRAINEES = []
for i, g in enumerate(GIVEN, start=1):
    y = 1990 + rng.randint(0, 14)
    m = rng.randint(1, 12)
    d = rng.randint(1, 28)
    TRAINEES.append({'name': f'샘플{g}', 'birth': f'{y}-{m:02d}-{d:02d}'})

DATES = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
         '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
WD = ['월', '화', '수', '목', '금', '월', '화', '수', '목', '금']
INTERNAL_ROUNDS = 5  # 1~5회차는 운영담당자가 웹에서 입력한 내부 기록이 있다. 6~10회차는 공식 자료만 있다.


def hm(minutes):
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


def beacon_day():
    """한 사람의 하루 비콘 기록 → (status, check_in, check_out)"""
    p = rng.random()
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
        records[(ti, di)] = beacon_day()

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

# ── 시나리오 JSON(setup-beacon-sample-data.mjs 가 읽는다) ───────────────────────
(ROOT / 'beacon-scenario.json').write_text(
    json.dumps({'trainees': TRAINEES, 'dates': DATES, 'internal': internal}, ensure_ascii=False, indent=1), encoding='utf-8')

# ── 공식 출결 CSV(비콘 로그 형식) ───────────────────────────────────────────────
KOR = {'PRESENT': '출석', 'LATE': '지각', 'EARLY_LEAVE': '조퇴', 'ABSENT': '결석', 'EXCUSED': '인정결석'}
rows = ['round_no,trainee_name,birth_date,status,check_in,check_out']
for di in range(len(DATES)):
    for ti, t in enumerate(TRAINEES):
        st, cin, cout = records[(ti, di)]
        rows.append(f'{di + 1},{t["name"]},{t["birth"]},{KOR[st]},{"" if cin is None else hm(cin)},{"" if cout is None else hm(cout)}')
# 오류 행(반영되지 않고 사유가 표시된다)
rows += [
    '11,샘플가온,1990-01-01,출석,08:50,18:00',   # 없는 회차
    f'3,샘플없는사람,,출석,08:50,18:00',           # 과정에 없는 훈련생
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
