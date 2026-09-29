import { crc32, deflateRawSync } from 'node:zlib';

// 테스트용 최소 xlsx 생성기. 셀 좌표 → 문자열을 첫 시트에 넣고(공유 문자열 사용) zip 으로 묶는다.
function zip(entries: Record<string, string>, deflate: boolean): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text, 'utf8');
    const body = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function makeXlsx(cells: Record<string, string>, options: { deflate?: boolean } = {}): Buffer {
  const strings: string[] = [];
  const byRow = new Map<number, string[]>();
  for (const [ref, value] of Object.entries(cells)) {
    const row = Number(/\d+/.exec(ref)![0]);
    let idx = strings.indexOf(value);
    if (idx < 0) idx = strings.push(value) - 1;
    byRow.set(row, [...(byRow.get(row) ?? []), `<c r="${ref}" t="s"><v>${idx}</v></c>`]);
  }
  const sheetData = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `<row r="${r}">${cs.join('')}</row>`).join('');
  return zip(
    {
      '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${sheetData}</sheetData></worksheet>`,
      'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
    },
    options.deflate ?? true,
  );
}

// 공식 출석부(HRD-Net) 모양: 1행 머리글·월 이름(첫 칸에만), 2행 일, 3행 요일, 4행부터 훈련생. days 는 열 N 부터 차례로 놓는다.
export function makeAttendanceSheet(
  year: number,
  month: number,
  days: number[],
  trainees: { name: string; rrn?: string; marks: string[] }[],
  options: { deflate?: boolean } = {},
): Buffer {
  const col = (n: number): string => {
    let s = '';
    for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    return s;
  };
  const first = 14; // N
  const cells: Record<string, string> = { A1: '연번', B1: '성명', C1: '주민등록번호', F1: '훈련생\r\n상태', G1: '훈\r\n련\r\n일\r\n수' };
  cells[`${col(first)}1`] = `${year}년${String(month).padStart(2, '0')}월`;
  days.forEach((d, i) => {
    cells[`${col(first + i)}2`] = String(d);
    cells[`${col(first + i)}3`] = '월';
  });
  trainees.forEach((t, idx) => {
    const r = 4 + idx;
    cells[`A${r}`] = String(idx + 1);
    cells[`B${r}`] = t.name;
    if (t.rrn) cells[`C${r}`] = t.rrn;
    cells[`F${r}`] = '훈련중';
    cells[`G${r}`] = '19'; // 요약 열은 읽지 않는다
    t.marks.forEach((m, i) => {
      if (m !== '') cells[`${col(first + i)}${r}`] = m;
    });
  });
  return makeXlsx(cells, options);
}
