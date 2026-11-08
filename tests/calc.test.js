const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../js/calc.js');

const H = 3600 * 1000;
const base = new Date(2026, 10, 3, 9, 0).getTime(); // 3 Nov 2026 09:00 local
const settings = { hourlyRate: 40, overtime: { enabled: false, after1: 8, rate1: 1.25, after2: 10, rate2: 1.5 } };

test('plain shift: hours and pay', () => {
  const p = calc.shiftPay({ start: base, end: base + 8 * H, breakMin: 0, rate: 40, bonus: 0 }, settings);
  assert.equal(p.minutes, 480);
  assert.equal(p.total, 320);
});

test('break is subtracted and never makes hours negative', () => {
  assert.equal(calc.shiftMinutes({ start: base, end: base + 8 * H, breakMin: 30 }), 450);
  assert.equal(calc.shiftMinutes({ start: base, end: base + 10 * 60000, breakMin: 30 }), 0);
});

test('overnight shift crossing midnight', () => {
  const start = new Date(2026, 10, 3, 22, 0).getTime();
  const end = new Date(2026, 10, 4, 6, 0).getTime();
  assert.equal(calc.shiftMinutes({ start, end, breakMin: 0 }), 480);
  assert.equal(calc.monthKey(start), '2026-11'); // belongs to the month it started in
});

test('overtime tiers: 8h regular, 2h at 125%, rest at 150%', () => {
  const s = { ...settings, overtime: { ...settings.overtime, enabled: true } };
  const p = calc.shiftPay({ start: base, end: base + 11 * H, breakMin: 0, rate: 40, bonus: 0 }, s);
  // 8*40 + 2*40*1.25 + 1*40*1.5 = 320 + 100 + 60
  assert.equal(p.base, 480);
  assert.deepEqual(p.split, { regular: 480, ot1: 120, ot2: 60 });
});

test('bonus is added; rate falls back to settings when missing', () => {
  const p = calc.shiftPay({ start: base, end: base + 2 * H, breakMin: 0, rate: null, bonus: 15.5 }, settings);
  assert.equal(p.rate, 40);
  assert.equal(p.total, 95.5);
});

test('active shift counts until now', () => {
  assert.equal(calc.shiftMinutes({ start: base, end: null, breakMin: 0 }, base + 90 * 60000), 90);
});

test('summarize sums rounded per-shift values', () => {
  const shifts = [
    { start: base, end: base + 20 * 60000, breakMin: 0, rate: 33.33, bonus: 0 }, // 11.11
    { start: base + H, end: base + H + 20 * 60000, breakMin: 0, rate: 33.33, bonus: 0 },
  ];
  const s = calc.summarize(shifts, settings);
  assert.equal(s.total, 22.22);
  assert.equal(s.count, 2);
  assert.equal(s.minutes, 40);
});

test('month helpers', () => {
  assert.equal(calc.addMonths('2026-12', 1), '2027-01');
  assert.equal(calc.addMonths('2026-01', -1), '2025-12');
  assert.equal(calc.formatDuration(510), '8:30');
  assert.equal(calc.formatDuration(5), '0:05');
});

test('overlap detection', () => {
  const a = { id: 'a', start: base, end: base + 4 * H };
  const b = { id: 'b', start: base + 3 * H, end: base + 6 * H };
  const c = { id: 'c', start: base + 4 * H, end: base + 5 * H }; // touches a, does not overlap
  assert.deepEqual(calc.findOverlaps([a, b, c], b).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(calc.findOverlaps([a], c), []);
});
