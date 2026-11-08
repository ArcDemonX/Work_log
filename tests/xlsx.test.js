const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('../js/xlsx.js');
const report = require('../js/report.js');

/** Read the central directory of a stored ZIP and verify each entry's CRC. */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const localNameLen = dv.getUint16(off + 26, true);
    const data = bytes.subarray(off + 30 + localNameLen, off + 30 + localNameLen + size);
    assert.equal(xlsx.crc32(data), crc, 'crc of ' + name);
    files[name] = new TextDecoder().decode(data);
    p += 46 + nameLen;
  }
  return files;
}

test('crc32 known vector', () => {
  assert.equal(xlsx.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('column names', () => {
  assert.equal(xlsx.colName(0), 'A');
  assert.equal(xlsx.colName(25), 'Z');
  assert.equal(xlsx.colName(26), 'AA');
});

test('sheet names are made Excel-safe', () => {
  assert.equal(xlsx.safeSheetName('a/b:c', 0), 'a b c');
  assert.equal(xlsx.safeSheetName('x'.repeat(40), 0).length, 31);
});

test('workbook contains all parts, escapes text, sets RTL', () => {
  const H = 3600 * 1000;
  const start = new Date(2026, 10, 3, 9, 0).getTime();
  const bytes = report.buildWorkbook({
    shifts: [{ id: '1', start, end: start + 8 * H, breakMin: 0, rate: 40, bonus: 0, note: 'A & <B>' }],
    settings: { lang: 'he', currency: 'ILS', hourlyRate: 40, overtime: { enabled: false } },
    now: start + 9 * H,
  });
  const files = readZip(bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(files[part], part);
  }
  assert.match(files['xl/worksheets/sheet1.xml'], /rightToLeft="1"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /A &amp; &lt;B&gt;/);
  assert.match(files['xl/worksheets/sheet1.xml'], /<v>320<\/v>/);
});

test('date / time serials', () => {
  assert.equal(xlsx.dateSerial(new Date(2026, 0, 1, 15, 30).getTime()), 46023);
  assert.equal(xlsx.timeSerial(new Date(2026, 0, 1, 12, 0).getTime()), 0.5);
});
