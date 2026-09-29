import { describe, expect, it } from 'vitest';
import { makeAttendanceSheet, makeXlsx } from '../../test/support/xlsx-fixture.js';
import { OfficialFileError } from './official-attendance.parse.js';
import { birthDateFromRrn, parseAttendanceSheet } from './official-attendance.sheet.js';
import { isXlsx, readFirstSheet, XlsxError } from './xlsx-reader.js';

describe('xlsx-reader', () => {
  it('압축·무압축 xlsx 의 첫 시트를 셀 격자로 읽는다(공유 문자열·개행·XML 이스케이프)', () => {
    for (const deflate of [true, false]) {
      const buf = makeXlsx({ A1: '훈련생\r\n상태', B2: 'A&B <x>', C3: '3' }, { deflate });
      expect(isXlsx(buf)).toBe(true);
      const grid = readFirstSheet(buf);
      expect(grid.get(1)?.get(1)).toBe('훈련생\r\n상태');
      expect(grid.get(2)?.get(2)).toBe('A&B <x>');
      expect(grid.get(3)?.get(3)).toBe('3');
    }
  });
  it('xlsx 가 아니거나 손상된 파일은 오류', () => {
    expect(isXlsx(Buffer.from('round_no,trainee_name\n'))).toBe(false);
    expect(() => readFirstSheet(Buffer.from('PK\x03\x04garbage-garbage-garbage-garbage'))).toThrow(XlsxError);
    const ok = makeXlsx({ A1: 'x' });
    expect(() => readFirstSheet(ok.subarray(0, ok.length - 10))).toThrow(XlsxError);
  });
});

describe('birthDateFromRrn', () => {
  it('앞 6자리 + 성별 자리로 세기를 정하고, 익명화·불완전 값은 버린다', () => {
    expect(birthDateFromRrn('900131-1234567')).toBe('1990-01-31');
    expect(birthDateFromRrn('0503153******')).toBe('2005-03-15');
    expect(birthDateFromRrn('850229-2******')).toBeUndefined(); // 1985 는 윤년이 아님
    expect(birthDateFromRrn('000000-3******')).toBeUndefined(); // 익명화
    expect(birthDateFromRrn('900131')).toBeUndefined(); // 성별 자리 없음
    expect(birthDateFromRrn(undefined)).toBeUndefined();
  });
});

describe('parseAttendanceSheet', () => {
  const sheet = makeAttendanceSheet(2026, 9, [7, 8, 9, 10], [
    { name: '김하나', rrn: '900131-2******', marks: ['○', '×', '▦15', '-'] },
    { name: '이두리', marks: ['◎', '▲', '▶', ''] },
    { name: '박세찌', marks: ['★', '', '', ''] },
  ]);

  it('훈련생 × 날짜 칸을 행으로 펼치고, 기호를 상태로 바꾸며, 미도래(-)·빈칸은 건너뛴다', () => {
    const rows = parseAttendanceSheet(readFirstSheet(sheet));
    expect(rows.map((r) => `${r.traineeName}:${r.classDate}:${r.status ?? 'ERR'}`)).toEqual([
      '김하나:2026-09-07:PRESENT',
      '김하나:2026-09-08:ABSENT',
      '김하나:2026-09-09:EXCUSED',
      '이두리:2026-09-07:LATE',
      '이두리:2026-09-08:EARLY_LEAVE',
      '이두리:2026-09-09:PRESENT', // 외출은 출석
      '박세찌:2026-09-07:ERR',
    ]);
    expect(rows[6].error).toContain('★');
    expect(rows[0].birthDate).toBe('1990-01-31');
    expect(rows[3].birthDate).toBeUndefined();
    expect(rows[2].raw).toMatchObject({ symbol: '▦15', cell: 'P4' });
  });

  it('주민등록번호는 원본 데이터에 남기지 않는다', () => {
    const rows = parseAttendanceSheet(readFirstSheet(sheet));
    expect(JSON.stringify(rows)).not.toContain('900131-2');
    expect(JSON.stringify(rows)).not.toContain('******');
  });

  it('월 머리글이 두 번(9월·10월)이면 열 위치로 각 날짜의 월을 정한다', () => {
    const cells: Record<string, string> = { B1: '성명', C1: '주민등록번호', N1: '2026년09월', P1: '2026년10월', N2: '30', O2: '31', P2: '1', Q2: '2', B4: '김하나', N4: '○', O4: '○', P4: '×', Q4: '○' };
    const rows = parseAttendanceSheet(readFirstSheet(makeXlsx(cells)));
    // 9월 31일은 없는 날짜라 건너뜀
    expect(rows.map((r) => `${r.classDate}:${r.status}`)).toEqual(['2026-09-30:PRESENT', '2026-10-01:ABSENT', '2026-10-02:PRESENT']);
  });

  it('출석부 형식이 아니면 오류', () => {
    expect(() => parseAttendanceSheet(readFirstSheet(makeXlsx({ A1: '이름', B1: '값' })))).toThrow(OfficialFileError);
    expect(() => parseAttendanceSheet(readFirstSheet(makeXlsx({ B1: '성명', N2: '7' })))).toThrow(/YYYY년MM월/);
  });
});
