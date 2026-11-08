/*
 * report.js — turns shifts into spreadsheet sheets (consumed by xlsx.js).
 * Kept separate from the UI so it can be unit-tested in Node.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const deps = isNode
    ? { calc: require('./calc.js'), i18n: require('./i18n.js'), xlsx: require('./xlsx.js') }
    : root.WL;
  const mod = factory(deps.calc, deps.i18n, deps.xlsx);
  if (isNode) module.exports = mod;
  else (root.WL = root.WL || {}).report = mod;
})(typeof self !== 'undefined' ? self : this, function (calc, i18n, xlsx) {
  'use strict';

  /**
   * @param {object} opts { shifts, settings, now }
   * @returns sheet specs for xlsx.write()
   */
  function buildSheets({ shifts, settings, now }) {
    const lang = settings.lang;
    const t = (k, v) => i18n.t(lang, k, v);
    const loc = i18n.locale(lang);
    const cur = settings.currency;
    const dayFmt = new Intl.DateTimeFormat(loc, { weekday: 'long' });
    const monthFmt = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' });
    const sorted = [...shifts].sort((a, b) => a.start - b.start);

    // ---- Sheet 1: every shift ----
    const header = [t('xlDate'), t('xlDay'), t('xlStart'), t('xlEnd'), t('xlBreak'), t('xlHours'),
      t('xlRate') + ' (' + cur + ')', t('xlBase') + ' (' + cur + ')', t('xlBonus') + ' (' + cur + ')',
      t('xlTotal') + ' (' + cur + ')', t('xlNote')].map((v) => ({ v, s: 'header' }));
    const rows = [header];
    for (const s of sorted) {
      const p = calc.shiftPay(s, settings, now);
      rows.push([
        { v: xlsx.dateSerial(s.start), s: 'date' },
        dayFmt.format(new Date(s.start)),
        { v: xlsx.timeSerial(s.start), s: 'time' },
        s.end == null ? t('xlActive') : { v: xlsx.timeSerial(s.end), s: 'time' },
        s.breakMin || 0,
        { v: calc.round2(p.hours), s: 'hours' },
        { v: p.rate, s: 'money' },
        { v: p.base, s: 'money' },
        { v: p.bonus, s: 'money' },
        { v: p.total, s: 'money' },
        s.note || '',
      ]);
    }
    const tot = calc.summarize(sorted, settings, now);
    rows.push([
      { v: t('xlGrandTotal'), s: 'bold' }, null, null, null, null,
      { v: calc.round2(tot.minutes / 60), s: 'boldHours' }, null,
      { v: tot.base, s: 'boldMoney' }, { v: tot.bonus, s: 'boldMoney' }, { v: tot.total, s: 'boldMoney' }, null,
    ]);

    // ---- Sheet 2: per-month summary ----
    const byMonth = new Map();
    for (const s of sorted) {
      const k = calc.monthKey(s.start);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(s);
    }
    const sumRows = [[t('xlMonth'), t('xlShiftsCount'), t('xlHours'), t('xlBase') + ' (' + cur + ')',
      t('xlBonus') + ' (' + cur + ')', t('xlTotal') + ' (' + cur + ')'].map((v) => ({ v, s: 'header' }))];
    for (const [k, list] of byMonth) {
      const m = calc.summarize(list, settings, now);
      const { year, month } = calc.parseMonthKey(k);
      sumRows.push([
        monthFmt.format(new Date(year, month - 1, 1)),
        m.count,
        { v: calc.round2(m.minutes / 60), s: 'hours' },
        { v: m.base, s: 'money' },
        { v: m.bonus, s: 'money' },
        { v: m.total, s: 'money' },
      ]);
    }
    sumRows.push([
      { v: t('xlGrandTotal'), s: 'bold' }, { v: tot.count, s: 'boldInt' },
      { v: calc.round2(tot.minutes / 60), s: 'boldHours' },
      { v: tot.base, s: 'boldMoney' }, { v: tot.bonus, s: 'boldMoney' }, { v: tot.total, s: 'boldMoney' },
    ]);

    const rtl = lang === 'he';
    return [
      { name: t('xlShifts'), rtl, freezeHeader: true, cols: [12, 10, 8, 8, 10, 8, 12, 12, 12, 12, 30], rows },
      { name: t('xlSummary'), rtl, freezeHeader: true, cols: [18, 10, 10, 14, 14, 14], rows: sumRows },
    ];
  }

  function buildWorkbook(opts) {
    return xlsx.write(buildSheets(opts));
  }

  // ---------- Import from a spreadsheet ----------

  // Header names recognised per field (compared lower-case, with any "(...)" suffix removed).
  // Includes the app's own export headers in both languages, so an exported file imports back as-is.
  const HEADER_ALIASES = {
    date: ['תאריך', 'date', 'day date'],
    start: ['כניסה', 'שעת כניסה', 'התחלה', 'in', 'start', 'clock in', 'start time', 'time in'],
    end: ['יציאה', 'שעת יציאה', 'סיום', 'out', 'end', 'clock out', 'end time', 'time out'],
    breakMin: ['הפסקה', 'break', 'break min', 'break minutes'],
    rate: ['שכר לשעה', 'תעריף', 'rate', 'hourly rate'],
    bonus: ['תוספות', 'תוספת', 'טיפים', 'bonus', 'tips'],
    note: ['הערה', 'הערות', 'note', 'notes', 'comment'],
  };
  // Column positions of the app's own export, used if no header row is found.
  const DEFAULT_COLUMNS = { date: 0, start: 2, end: 3, breakMin: 4, rate: 6, bonus: 8, note: 10 };

  const normHeader = (v) => String(v == null ? '' : v).replace(/\(.*?\)/g, '').replace(/[׳']/g, '').trim().toLowerCase();

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const map = {};
      (rows[r] || []).forEach((cell, c) => {
        const h = normHeader(cell);
        if (!h) return;
        for (const [field, names] of Object.entries(HEADER_ALIASES)) {
          if (map[field] == null && names.includes(h)) map[field] = c;
        }
      });
      if (map.date != null && map.start != null && map.end != null) return { row: r, map };
    }
    return null;
  }

  /** Excel date serial or "dd/mm/yyyy" / "dd.mm.yyyy" / "yyyy-mm-dd" -> {y, m, d} (m is 0-11). */
  function readDate(v) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
    }
    if (typeof v !== 'string') return null;
    const s = v.trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return { y: +m[1], m: +m[2] - 1, d: +m[3] };
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
    if (m) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: +m[2] - 1, d: +m[1] };
    return null;
  }

  /** Excel time fraction (or full date-time serial) or "HH:MM[:SS]" -> minutes after midnight. */
  function readTime(v) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      const frac = v - Math.floor(v);
      return Math.round(frac * 1440) % 1440;
    }
    if (typeof v !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return +m[1] * 60 + +m[2];
  }

  function readNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = parseFloat(v.replace(/[^\d.,-]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /**
   * Turn spreadsheet rows into shifts.
   * Rows without a readable date (titles, header, totals row) are ignored.
   * Rows WITH a date but unreadable times are counted in `skipped` so the user is told.
   * Returns { shifts, skipped }. Shifts have no id yet; the caller assigns them.
   */
  function parseShiftRows(rows, settings) {
    const header = findHeader(rows);
    const col = header ? Object.assign({}, header.map) : DEFAULT_COLUMNS;
    const firstRow = header ? header.row + 1 : 0;
    const shifts = [];
    let skipped = 0;
    for (let r = firstRow; r < rows.length; r++) {
      const row = rows[r] || [];
      const date = readDate(row[col.date]);
      if (!date) continue;
      const startMin = readTime(row[col.start]);
      const endMin = readTime(row[col.end]);
      if (startMin == null || endMin == null) { skipped++; continue; }
      const start = new Date(date.y, date.m, date.d, Math.floor(startMin / 60), startMin % 60).getTime();
      const endDate = new Date(date.y, date.m, date.d, Math.floor(endMin / 60), endMin % 60);
      if (endDate.getTime() <= start) endDate.setDate(endDate.getDate() + 1); // overnight shift
      const rate = col.rate != null ? readNumber(row[col.rate]) : null;
      const breakMin = col.breakMin != null ? readNumber(row[col.breakMin]) : null;
      const bonus = col.bonus != null ? readNumber(row[col.bonus]) : null;
      const note = col.note != null && row[col.note] != null ? String(row[col.note]) : '';
      shifts.push({
        start,
        end: endDate.getTime(),
        breakMin: Math.max(0, Math.round(breakMin || 0)),
        rate: rate != null && rate >= 0 ? rate : Number(settings.hourlyRate) || 0,
        bonus: bonus || 0,
        note: note.slice(0, 500),
      });
    }
    return { shifts, skipped, matchedHeader: Boolean(header) };
  }

  async function importWorkbook(bytes, settings) {
    return parseShiftRows(await xlsx.readFirstSheet(bytes), settings);
  }

  return { buildSheets, buildWorkbook, parseShiftRows, importWorkbook };
});
