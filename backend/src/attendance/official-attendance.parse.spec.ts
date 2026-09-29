import { describe, expect, it } from 'vitest';
import { compareAttendance, MAX_OFFICIAL_ROWS, OfficialFileError, parseCsv, parseOfficialFile } from './official-attendance.parse.js';

describe('parseCsv', () => {
  it('BOM·CRLF·따옴표·이중 따옴표를 처리한다', () => {
    expect(parseCsv('﻿a,b\r\n"x,1","y ""q"""\r\n')).toEqual([['a', 'b'], ['x,1', 'y "q"']]);
  });
  it('빈 줄은 버리고 닫히지 않은 따옴표는 오류', () => {
    expect(parseCsv('a\n\n\nb\n')).toEqual([['a'], ['b']]);
    expect(() => parseCsv('a,"b')).toThrow(OfficialFileError);
  });
});

describe('parseOfficialFile', () => {
  const header = 'round_no,trainee_name,birth_date,status,check_in,check_out\n';
  it('영문·한글 머리글과 상태 별칭을 받는다', () => {
    const rows = parseOfficialFile('회차,이름,생년월일,상태,입실,퇴실\n1,김하나,1990-03-05,지각,9:05,18:00\n2,김하나,1990-03-05,LATE,,\n');
    expect(rows[0]).toMatchObject({ rowNo: 2, roundNo: 1, traineeName: '김하나', birthDate: '1990-03-05', status: 'LATE', checkIn: '09:05:00', checkOut: '18:00:00' });
    expect(rows[1]).toMatchObject({ rowNo: 3, checkIn: null, checkOut: null });
    expect(rows.every((r) => !r.error)).toBe(true);
  });
  it('행 단위 오류를 모아서 알려 준다(다른 행은 계속 처리)', () => {
    const rows = parseOfficialFile(`${header}x,,1990-3-5,없음,25:00,10:00\n1,홍,1990-03-05,출석,10:00,09:00\n`);
    expect(rows[0].error).toContain('회차');
    expect(rows[0].error).toContain('훈련생명');
    expect(rows[0].error).toContain('생년월일');
    expect(rows[0].error).toContain('상태');
    expect(rows[0].error).toContain('입실');
    expect(rows[1].error).toContain('퇴실 시각이 입실 시각보다 빠릅니다');
  });
  it('필수 열 누락·빈 파일·행 수 초과는 파일 오류', () => {
    expect(() => parseOfficialFile('round_no,status\n1,PRESENT\n')).toThrow(/trainee_name/);
    expect(parseOfficialFile('round_no,trainee_name,status\n1,김하나,출석\n')[0]).toMatchObject({ traineeName: '김하나', status: 'PRESENT' }); // 생년월일 열은 선택
    expect(() => parseOfficialFile('')).toThrow(OfficialFileError);
    const many = header + '1,a,1990-01-01,PRESENT,,\n'.repeat(MAX_OFFICIAL_ROWS + 1);
    expect(() => parseOfficialFile(many)).toThrow(/3000/);
  });
});

describe('compareAttendance', () => {
  const at = (h: number, m: number) => new Date(Date.UTC(2027, 0, 5, h, m));
  const base = { status: 'PRESENT', checkIn: at(0, 0), checkOut: at(9, 0) };
  it('완전 일치 / 임계치 이내 / 초과 / 상태 불일치', () => {
    expect(compareAttendance(base, { ...base }, 15)).toBe('IDENTICAL');
    expect(compareAttendance(base, { ...base, checkIn: at(0, 15) }, 15)).toBe('CONSISTENT'); // 정확히 15분은 임계치 이내
    expect(compareAttendance(base, { ...base, checkIn: at(0, 16) }, 15)).toBe('MISMATCH');
    expect(compareAttendance(base, { ...base, status: 'LATE' }, 15)).toBe('MISMATCH');
  });
  it('한쪽에만 시각이 있으면 불일치가 아니라 공식값으로 채울 수 있는 일치', () => {
    expect(compareAttendance({ ...base, checkOut: null }, base, 15)).toBe('CONSISTENT');
    expect(compareAttendance(base, { ...base, checkOut: null }, 15)).toBe('CONSISTENT');
  });
});
