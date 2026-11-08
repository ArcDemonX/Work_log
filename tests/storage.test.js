const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../js/storage.js');

const H = 3600 * 1000;
const t0 = Date.UTC(2026, 10, 3, 7, 0);

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), keys: () => [...m.keys()] };
}

test('backup round-trip keeps every shift and setting', () => {
  const s = store.emptyState('he');
  s.settings.hourlyRate = 45;
  s.shifts.push({ id: 'x1', start: t0, end: t0 + 8 * H, breakMin: 30, rate: 45, bonus: 10, note: 'שלום', createdAt: t0, updatedAt: t0 });
  const text = JSON.stringify(store.serializeBackup(s));
  const { state, skipped } = store.parseBackup(text);
  assert.equal(skipped, 0);
  assert.deepEqual(state.shifts, s.shifts);
  assert.equal(state.settings.hourlyRate, 45);
});

test('invalid JSON / foreign file / newer version are rejected with codes', () => {
  assert.throws(() => store.parseBackup('{not json'), { code: 'json' });
  assert.throws(() => store.parseBackup('{"app":"other","shifts":[]}'), { code: 'format' });
  assert.throws(() => store.parseBackup('{"hello":1}'), { code: 'format' });
  assert.throws(() => store.parseBackup('{"app":"work-log","version":99,"shifts":[]}'), { code: 'newer' });
});

test('bad rows are skipped and counted, ISO strings accepted', () => {
  const { state, skipped } = store.normalizeState({
    shifts: [
      { id: 'ok', start: '2026-11-03T09:00:00Z', end: '2026-11-03T17:00:00Z' },
      { id: 'neg', start: t0, end: t0 - H }, // end before start
      { id: 'long', start: t0, end: t0 + 72 * H }, // 3-day typo
      { start: 'garbage' },
      { id: 'ok', start: t0, end: t0 + H }, // duplicate id
    ],
  });
  assert.equal(state.shifts.length, 1);
  assert.equal(skipped, 4);
});

test('only one active shift survives', () => {
  const { state, skipped } = store.normalizeState({ shifts: [{ id: 'a', start: t0, end: null }, { id: 'b', start: t0 + H, end: null }] });
  assert.deepEqual(state.shifts.map((s) => s.id), ['b']);
  assert.equal(skipped, 1);
});

test('merge: new ids added, newer updatedAt wins, settings kept', () => {
  const cur = store.emptyState('en');
  cur.settings.hourlyRate = 50;
  cur.shifts = [
    { id: 'a', start: t0, end: t0 + H, breakMin: 0, rate: 50, bonus: 0, note: 'old', createdAt: 1, updatedAt: 100 },
    { id: 'b', start: t0 + 24 * H, end: t0 + 25 * H, breakMin: 0, rate: 50, bonus: 0, note: 'mine', createdAt: 1, updatedAt: 500 },
  ];
  const inc = store.emptyState('he');
  inc.shifts = [
    { ...cur.shifts[0], note: 'new', updatedAt: 200 },
    { ...cur.shifts[1], note: 'stale', updatedAt: 300 },
    { id: 'c', start: t0 + 48 * H, end: t0 + 49 * H, breakMin: 0, rate: 30, bonus: 0, note: '', createdAt: 1, updatedAt: 1 },
  ];
  const r = store.mergeStates(cur, inc);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  const notes = Object.fromEntries(r.state.shifts.map((s) => [s.id, s.note]));
  assert.deepEqual(notes, { a: 'new', b: 'mine', c: '' });
  assert.equal(r.state.settings.hourlyRate, 50);
  assert.equal(r.state.settings.lang, 'en');
});

test('corrupted storage is copied aside, never overwritten', () => {
  const ls = memStorage({ [store.KEY]: '{broken' });
  const { state, recovered } = store.load(ls, 'he');
  assert.equal(recovered, true);
  assert.equal(state.shifts.length, 0);
  assert.equal(ls.getItem(store.KEY), '{broken'); // untouched until the app saves
  assert.ok(ls.keys().some((k) => k.startsWith('worklog.corrupt.')));
});

test('save/load round-trip', () => {
  const ls = memStorage();
  const s = store.emptyState('en');
  s.shifts.push({ id: 'z', start: t0, end: t0 + H, breakMin: 0, rate: 10, bonus: 0, note: '', createdAt: t0, updatedAt: t0 });
  store.save(ls, s);
  assert.deepEqual(store.load(ls).state.shifts, s.shifts);
});

test('settings are clamped and sanitised', () => {
  const s = store.normalizeSettings({ hourlyRate: '-5', currency: 'usd', lang: 'fr', theme: 'neon', overtime: { enabled: 1, rate1: 0.5 } });
  assert.equal(s.hourlyRate, 0);
  assert.equal(s.currency, 'USD');
  assert.equal(s.lang, 'he');
  assert.equal(s.theme, 'auto');
  assert.equal(s.overtime.enabled, true);
  assert.equal(s.overtime.rate1, 1);
});
