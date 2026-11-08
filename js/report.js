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

  return { buildSheets, buildWorkbook };
});
