import { inflateRawSync } from 'node:zlib';

// 최소 xlsx 읽기(외부 라이브러리 없음). xlsx 는 zip 안의 XML 이라, 공식 출석부 업로드에 필요한 첫 시트의 셀 문자열만 읽는다.
// 신뢰할 수 없는 업로드 파일이므로 zip 폭탄을 막기 위해 항목 수·압축 해제 크기를 제한한다. ZIP64·암호화·수식 계산은 지원하지 않는다.

export class XlsxError extends Error {}

const MAX_ENTRIES = 200;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

export type Grid = Map<number, Map<number, string>>; // 행 번호(1부터) → 열 번호(1부터) → 셀 문자열

export function isXlsx(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function readZip(buffer: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('엑셀(xlsx) 파일이 아니거나 손상되었습니다.');
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || pos === 0xffffffff) throw new XlsxError('지원하지 않는 압축 형식(ZIP64)입니다.');
  if (count > MAX_ENTRIES) throw new XlsxError('엑셀 파일 구조가 올바르지 않습니다.');

  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) throw new XlsxError('엑셀 파일이 손상되었습니다.');
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const size = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (size > MAX_ENTRY_BYTES) throw new XlsxError('엑셀 파일 안의 데이터가 너무 큽니다.');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new XlsxError('엑셀 파일이 손상되었습니다.');
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compSize);
    try {
      out.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) : (() => { throw new XlsxError('지원하지 않는 압축 방식입니다.'); })());
    } catch (e) {
      if (e instanceof XlsxError) throw e;
      throw new XlsxError('엑셀 파일을 읽을 수 없습니다(손상되었거나 너무 큼).');
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] !== '#') return ENTITIES[e];
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

const textOf = (xml: string): string =>
  [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

export function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// 첫 번째 시트를 셀 격자로 읽는다. 병합 셀은 왼쪽 위 칸에만 값이 있는 그대로 둔다(해석은 호출한 쪽).
export function readFirstSheet(buffer: Buffer): Grid {
  const files = readZip(buffer, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const workbook = files.get('xl/workbook.xml')?.toString('utf8');
  if (!workbook) throw new XlsxError('엑셀 파일이 아니거나 손상되었습니다.');

  // 첫 시트의 파일 경로: workbook.xml 의 첫 <sheet r:id> → rels 의 Target. 못 찾으면 sheet1.xml
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rid = /<sheet\s[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (rid && rels) {
    for (const rel of rels.matchAll(/<Relationship\s[^>]*>/g)) {
      if (new RegExp(`Id="${rid}"`).test(rel[0])) {
        const target = /Target="([^"]+)"/.exec(rel[0])?.[1];
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  const sheet = files.get(sheetPath)?.toString('utf8');
  if (!sheet) throw new XlsxError('첫 번째 시트를 찾을 수 없습니다.');

  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const grid: Grid = new Map();
  for (const cell of sheet.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cell[1];
    const body = cell[2] ?? '';
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
    let value: string;
    if (type === 'inlineStr') value = textOf(body);
    else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (v === undefined) continue;
      value = type === 's' ? (shared[Number(v)] ?? '') : decode(v);
    }
    if (value === '') continue;
    const row = Number(ref[2]);
    const cols = grid.get(row) ?? new Map<number, string>();
    cols.set(columnNumber(ref[1]), value);
    grid.set(row, cols);
  }
  return grid;
}
