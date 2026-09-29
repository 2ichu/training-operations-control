// D-12 확정(공식 출결 = CSV 파일 업로드 대사) 입력 파일 해석. 순수 함수만 둔다(DB·시간대 처리는 서비스).
// 형식: UTF-8(BOM 허용) CSV, 첫 줄 머리글. 열 이름은 영문 또는 한글 별칭을 받는다.

export const OFFICIAL_STATUSES = ['PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED'] as const;
export type OfficialStatus = (typeof OFFICIAL_STATUSES)[number];

// 출석부(엑셀)는 훈련생 × 날짜 칸마다 한 행이 되므로 CSV 보다 넉넉히 둔다(30명 × 2개월 ≈ 1,800칸).
export const MAX_OFFICIAL_ROWS = 3000;

const COLUMN_ALIASES: Record<string, string> = {
  round_no: 'round_no', 회차: 'round_no',
  trainee_name: 'trainee_name', 훈련생명: 'trainee_name', 훈련생: 'trainee_name', 이름: 'trainee_name',
  birth_date: 'birth_date', 생년월일: 'birth_date',
  status: 'status', 상태: 'status', 출결상태: 'status',
  check_in: 'check_in', 입실: 'check_in', 입실시각: 'check_in',
  check_out: 'check_out', 퇴실: 'check_out', 퇴실시각: 'check_out',
};
// 생년월일은 선택이다: 비우면 이름만으로 찾고(동명이인이면 오류), 값이 있으면 그 생년월일과 일치하는 훈련생만 대상이다.
const REQUIRED_COLUMNS = ['round_no', 'trainee_name', 'status'] as const;

const STATUS_ALIASES: Record<string, OfficialStatus> = {
  PRESENT: 'PRESENT', 출석: 'PRESENT',
  LATE: 'LATE', 지각: 'LATE',
  EARLY_LEAVE: 'EARLY_LEAVE', 조퇴: 'EARLY_LEAVE',
  ABSENT: 'ABSENT', 결석: 'ABSENT',
  EXCUSED: 'EXCUSED', 인정결석: 'EXCUSED',
};

export interface OfficialRow {
  rowNo: number; // CSV: 파일 안 줄 번호(머리글이 1, 첫 데이터가 2). 출석부(엑셀): 칸 순번
  raw: Record<string, string>;
  roundNo?: number;
  classDate?: string; // 출석부(엑셀)는 회차가 아니라 날짜로 회차를 찾는다(하루 한 회차)
  traineeName?: string;
  birthDate?: string;
  status?: OfficialStatus;
  checkIn?: string | null; // HH:MM:SS, 비어 있으면 null
  checkOut?: string | null;
  error?: string;
}

export class OfficialFileError extends Error {}

// RFC 4180 수준의 최소 CSV 해석: 따옴표 필드·이중 따옴표 이스케이프·CRLF.
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new OfficialFileError('따옴표가 닫히지 않았습니다.');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTime(value: string): string | null | undefined {
  const v = value.trim();
  if (v === '') return null;
  const m = TIME.exec(v);
  if (!m) return undefined; // 형식 오류
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

export function parseOfficialFile(text: string): OfficialRow[] {
  const table = parseCsv(text);
  if (table.length === 0) throw new OfficialFileError('파일이 비어 있습니다.');
  const header = table[0].map((h) => COLUMN_ALIASES[h.trim().toLowerCase()] ?? COLUMN_ALIASES[h.trim()] ?? null);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new OfficialFileError(`머리글에 필수 열이 없습니다: ${missing.join(', ')}`);
  if (table.length - 1 > MAX_OFFICIAL_ROWS) throw new OfficialFileError(`한 번에 ${MAX_OFFICIAL_ROWS}행까지만 올릴 수 있습니다.`);

  return table.slice(1).map((cells, index) => {
    const raw: Record<string, string> = {};
    header.forEach((key, col) => {
      if (key) raw[key] = (cells[col] ?? '').trim();
    });
    const row: OfficialRow = { rowNo: index + 2, raw };
    const errors: string[] = [];

    if (!/^\d+$/.test(raw.round_no) || Number(raw.round_no) < 1) errors.push('회차는 1 이상의 정수여야 합니다');
    else row.roundNo = Number(raw.round_no);
    if (!raw.trainee_name) errors.push('훈련생명이 비어 있습니다');
    else row.traineeName = raw.trainee_name;
    if ((raw.birth_date ?? '') !== '' && !DATE.test(raw.birth_date)) errors.push('생년월일은 YYYY-MM-DD 형식이어야 합니다');
    else if (raw.birth_date) row.birthDate = raw.birth_date;
    const status = STATUS_ALIASES[(raw.status ?? '').toUpperCase()] ?? STATUS_ALIASES[raw.status ?? ''];
    if (!status) errors.push(`상태를 알 수 없습니다(${OFFICIAL_STATUSES.join('/')} 또는 출석·지각·조퇴·결석·인정결석)`);
    else row.status = status;
    for (const [key, label] of [['check_in', '입실'], ['check_out', '퇴실']] as const) {
      const t = normalizeTime(raw[key] ?? '');
      if (t === undefined) errors.push(`${label} 시각은 HH:MM 형식이어야 합니다`);
      else if (key === 'check_in') row.checkIn = t;
      else row.checkOut = t;
    }
    if (row.checkIn && row.checkOut && row.checkOut < row.checkIn) errors.push('퇴실 시각이 입실 시각보다 빠릅니다');
    if (errors.length > 0) row.error = errors.join('; ');
    return row;
  });
}

export interface AttendanceValues {
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
}

export type Comparison = 'IDENTICAL' | 'CONSISTENT' | 'MISMATCH';

// 공식값과 내부값 비교(system-design STEP 8.2 5번).
// MISMATCH: 상태가 다르거나, 양쪽에 값이 있는 입·퇴실 시각 차이가 임계치(분)를 넘음.
// IDENTICAL: 상태·시각이 정확히 같음. CONSISTENT: 임계치 이내(한쪽만 값이 있는 경우 포함)라 공식값으로 갱신 가능.
export function compareAttendance(internal: AttendanceValues, official: AttendanceValues, toleranceMinutes: number): Comparison {
  if (internal.status !== official.status) return 'MISMATCH';
  let identical = true;
  for (const [a, b] of [[internal.checkIn, official.checkIn], [internal.checkOut, official.checkOut]] as const) {
    if (a && b) {
      const diff = Math.abs(a.getTime() - b.getTime());
      if (diff > toleranceMinutes * 60_000) return 'MISMATCH';
      if (diff !== 0) identical = false;
    } else if (a?.getTime() !== b?.getTime()) identical = false;
  }
  return identical ? 'IDENTICAL' : 'CONSISTENT';
}
