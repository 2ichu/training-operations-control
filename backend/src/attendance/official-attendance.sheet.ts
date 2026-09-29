import type { Grid } from './xlsx-reader.js';
import { OfficialFileError, type OfficialRow, type OfficialStatus } from './official-attendance.parse.js';

// 공식 출석부(HRD-Net 월별 출석부) 엑셀 해석. 훈련생 한 줄 × 날짜 칸, 칸마다 기호 하나.
// 기호 뜻은 2026-09-29 확인(파일에 범례가 없어 사용자에게 확인): ○ 출석, × 결석, ▦ 공가(뒤 숫자는 사유 코드), ◎ 지각, ▲ 조퇴, ▶ 외출,
// - 아직 오지 않은 날. 빈칸은 수업 없는 날(주말·휴일)이라 건너뛴다. 요약 열(훈련일수·출석률 등)은 읽지 않는다.
// 외출은 별도 상태가 없어 출석으로 반영한다. 지각 3회 = 결석 1일 같은 공식 환산은 여기서 다루지 않는다(칸의 상태만 옮김).

const SYMBOLS: Record<string, OfficialStatus> = { '○': 'PRESENT', '×': 'ABSENT', '▦': 'EXCUSED', '◎': 'LATE', '▲': 'EARLY_LEAVE', '▶': 'PRESENT' };
const SKIP = new Set(['', '-', '－', '–']);

const compact = (s: string | undefined): string => (s ?? '').replace(/\s+/g, '');

// 주민등록번호에서 생년월일만 뽑는다. 앞 6자리 + 성별 자리(7번째)로 세기를 정한다. 주민번호 자체는 어디에도 남기지 않는다.
export function birthDateFromRrn(value: string | undefined): string | undefined {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  const century = { '1': 1900, '2': 1900, '5': 1900, '6': 1900, '3': 2000, '4': 2000, '7': 2000, '8': 2000, '9': 1800, '0': 1800 }[digits[6]];
  if (!century) return undefined;
  const y = century + Number(digits.slice(0, 2));
  const m = Number(digits.slice(2, 4));
  const d = Number(digits.slice(4, 6));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined; // 익명화된 값(000000 등) 포함
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseAttendanceSheet(grid: Grid): OfficialRow[] {
  // 1) 머리글: '성명' 열과 '주민등록번호' 열
  let headerRow = 0;
  let nameCol = 0;
  let rrnCol = 0;
  for (const [r, cols] of [...grid.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [c, v] of cols) if (compact(v) === '성명') { headerRow = r; nameCol = c; }
    if (headerRow) {
      for (const [c, v] of cols) if (compact(v) === '주민등록번호') rrnCol = c;
      break;
    }
  }
  if (!headerRow) throw new OfficialFileError("출석부 형식이 아닙니다('성명' 머리글을 찾을 수 없습니다).");

  // 2) 월 머리글('2026년09월') → 그 아래 행이 일(1~31), 그 아래가 요일, 데이터는 그 다음 행부터
  let monthRow = 0;
  const months: { col: number; year: number; month: number }[] = [];
  for (let r = headerRow; r <= headerRow + 3 && !monthRow; r += 1) {
    for (const [c, v] of grid.get(r) ?? []) {
      const m = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(v);
      if (m) months.push({ col: c, year: Number(m[1]), month: Number(m[2]) });
    }
    if (months.length > 0) monthRow = r;
  }
  if (!monthRow) throw new OfficialFileError("출석부 형식이 아닙니다('YYYY년MM월' 머리글을 찾을 수 없습니다).");
  months.sort((a, b) => a.col - b.col);

  const dayCols: { col: number; date: string }[] = [];
  for (const [c, v] of grid.get(monthRow + 1) ?? []) {
    if (!/^\d{1,2}$/.test(v.trim())) continue;
    const owner = [...months].reverse().find((m) => m.col <= c); // 병합 셀이라 월 이름은 첫 칸에만 있다
    if (!owner) continue;
    const day = Number(v);
    const date = new Date(Date.UTC(owner.year, owner.month - 1, day));
    if (date.getUTCMonth() !== owner.month - 1) continue; // 없는 날짜
    dayCols.push({ col: c, date: `${owner.year}-${String(owner.month).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
  }
  dayCols.sort((a, b) => a.col - b.col);
  if (dayCols.length === 0) throw new OfficialFileError('날짜 머리글을 찾을 수 없습니다.');

  // 3) 훈련생 행 → 칸마다 한 행
  const out: OfficialRow[] = [];
  const firstData = monthRow + 3;
  const lastRow = Math.max(...grid.keys());
  for (let r = firstData; r <= lastRow; r += 1) {
    const cols = grid.get(r);
    const name = (cols?.get(nameCol) ?? '').replace(/\s+/g, ' ').trim();
    if (!cols || !name) continue;
    const birthDate = birthDateFromRrn(rrnCol ? cols.get(rrnCol) : undefined);
    for (const { col, date } of dayCols) {
      const cell = (cols.get(col) ?? '').trim();
      if (SKIP.has(cell)) continue;
      const symbol = cell[0];
      const status = SYMBOLS[symbol];
      const row: OfficialRow = {
        rowNo: out.length + 1,
        // 원본에는 주민등록번호를 넣지 않는다(생년월일만).
        raw: { source: 'ATTENDANCE_SHEET', date, trainee_name: name, ...(birthDate ? { birth_date: birthDate } : {}), symbol: cell, cell: `${columnLetters(col)}${r}` },
        classDate: date,
        traineeName: name,
        ...(birthDate ? { birthDate } : {}),
        checkIn: null,
        checkOut: null,
      };
      if (!status) row.error = `알 수 없는 출결 기호입니다(${cell})`;
      else row.status = status;
      out.push(row);
    }
  }
  if (out.length === 0) throw new OfficialFileError('반영할 출결 칸이 없습니다(훈련생 행이나 기호가 비어 있습니다).');
  return out;
}

function columnLetters(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
