const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const report = require('../js/report.js');

const H = 3600 * 1000;
const settings = { lang: 'he', currency: 'ILS', hourlyRate: 40, overtime: { enabled: false } };
const fixture = (n) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));

test('export -> import round-trip keeps times, break, rate, bonus, note', async () => {
  const d = new Date(2026, 10, 3, 22, 0).getTime();
  const shifts = [
    { id: 'a', start: d, end: d + 8 * H, breakMin: 30, rate: 45, bonus: 20, note: 'night & <x>' },
    { id: 'b', start: d + 36 * H, end: d + 44 * H, breakMin: 0, rate: 50, bonus: 0, note: '' },
  ];
  for (const lang of ['he', 'en']) {
    const bytes = report.buildWorkbook({ shifts, settings: { ...settings, lang }, now: d + 50 * H });
    const res = await report.importWorkbook(bytes, settings);
    assert.equal(res.matchedHeader, true);
    assert.equal(res.skipped, 0);
    assert.deepEqual(
      res.shifts.map((s) => [s.start, s.end, s.breakMin, s.rate, s.bonus, s.note]),
      shifts.map((s) => [s.start, s.end, s.breakMin, s.rate, s.bonus, s.note])
    );
  }
});

test('running shift in an export is skipped, totals row ignored', async () => {
  const d = new Date(2026, 10, 3, 9, 0).getTime();
  const bytes = report.buildWorkbook({
    shifts: [{ id: 'a', start: d, end: d + H, breakMin: 0, rate: 40, bonus: 0, note: '' }, { id: 'b', start: d + 5 * H, end: null, breakMin: 0, rate: 40, bonus: 0, note: '' }],
    settings, now: d + 6 * H,
  });
  const res = await report.importWorkbook(bytes, settings);
  assert.equal(res.shifts.length, 1);
  assert.equal(res.skipped, 1);
});

test('file re-saved by another spreadsheet program (compressed, shared strings)', async () => {
  const res = await report.importWorkbook(fixture('resaved-export.xlsx'), settings);
  assert.equal(res.shifts.length, 2);
  const [a] = res.shifts;
  assert.equal(a.start, new Date(2026, 10, 3, 22, 0).getTime());
  assert.equal(a.end, new Date(2026, 10, 4, 6, 0).getTime()); // overnight
  assert.equal(a.breakMin, 30);
  assert.equal(a.bonus, 20);
  assert.equal(a.note, 'לילה');
});

test('hand-made sheet: headers in any order, text dates and times', async () => {
  const res = await report.importWorkbook(fixture('custom-headers.xlsx'), settings);
  assert.equal(res.shifts.length, 2);
  assert.equal(res.skipped, 1); // the "soon" row
  const [a, b] = res.shifts;
  assert.equal(a.start, new Date(2026, 10, 2, 9, 0).getTime());
  assert.equal(a.end, new Date(2026, 10, 2, 17, 0).getTime());
  assert.equal(a.bonus, 15);
  assert.equal(a.rate, 40); // no rate column -> settings rate
  assert.equal(a.note, 'opening');
  assert.equal(b.end - b.start, 7 * H); // 23:00 -> 06:00 next day
});

test('not a spreadsheet -> format error', async () => {
  await assert.rejects(report.importWorkbook(new TextEncoder().encode('hello'), settings), { code: 'format' });
});
