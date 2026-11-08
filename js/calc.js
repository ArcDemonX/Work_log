/*
 * calc.js — pure calculation helpers (no DOM, no storage).
 * Works in the browser (attaches to window.WL.calc) and in Node (module.exports) for tests.
 *
 * Time model: every shift stores `start` / `end` as epoch milliseconds. Durations are computed
 * from the timestamp difference, so DST changes and shifts that cross midnight are handled
 * correctly without any special casing.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.WL = root.WL || {}).calc = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MINUTE = 60 * 1000;

  /** Round to 2 decimals (money). EPSILON avoids 1.005 -> 1.00 style float errors. */
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** Worked minutes of a shift (break subtracted, never negative). Active shift counts up to `now`. */
  function shiftMinutes(shift, now) {
    const end = shift.end == null ? (now == null ? Date.now() : now) : shift.end;
    const gross = Math.round((end - shift.start) / MINUTE);
    return Math.max(0, gross - (Number(shift.breakMin) || 0));
  }

  /**
   * Split worked minutes into regular / overtime tier 1 / overtime tier 2.
   * Overtime is evaluated per shift ("after X hours in a shift").
   */
  function splitOvertime(minutes, ot) {
    if (!ot || !ot.enabled) return { regular: minutes, ot1: 0, ot2: 0 };
    const t1 = Math.max(0, Number(ot.after1) || 0) * 60;
    const t2 = Math.max(t1, (Number(ot.after2) || 0) * 60);
    return {
      regular: Math.min(minutes, t1),
      ot1: Math.max(0, Math.min(minutes, t2) - t1),
      ot2: Math.max(0, minutes - t2),
    };
  }

  /**
   * Full pay breakdown for one shift.
   * The hourly rate is stored on the shift itself (snapshot at creation time), so changing
   * your salary later does not silently rewrite past months. Falls back to settings if missing.
   */
  function shiftPay(shift, settings, now) {
    const minutes = shiftMinutes(shift, now);
    const rate = Number.isFinite(shift.rate) ? shift.rate : Number(settings.hourlyRate) || 0;
    const ot = settings.overtime;
    const split = splitOvertime(minutes, ot);
    const weightedMinutes =
      split.regular + (ot && ot.enabled ? split.ot1 * ot.rate1 + split.ot2 * ot.rate2 : 0);
    const base = round2((weightedMinutes / 60) * rate);
    const bonus = round2(Number(shift.bonus) || 0);
    return { minutes, hours: minutes / 60, rate, base, bonus, total: round2(base + bonus), split };
  }

  /** "YYYY-MM" of a timestamp in local time. A shift belongs to the month it started in. */
  function monthKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function parseMonthKey(key) {
    const [y, m] = key.split('-').map(Number);
    return { year: y, month: m }; // month is 1-12
  }

  function addMonths(key, n) {
    const { year, month } = parseMonthKey(key);
    const d = new Date(year, month - 1 + n, 1);
    return monthKey(d.getTime());
  }

  /** Sum a list of shifts. Totals are sums of already-rounded per-shift values, so they match the Excel export exactly. */
  function summarize(shifts, settings, now) {
    const acc = { count: 0, minutes: 0, base: 0, bonus: 0, total: 0 };
    for (const s of shifts) {
      const p = shiftPay(s, settings, now);
      acc.count += 1;
      acc.minutes += p.minutes;
      acc.base += p.base;
      acc.bonus += p.bonus;
      acc.total += p.total;
    }
    acc.base = round2(acc.base);
    acc.bonus = round2(acc.bonus);
    acc.total = round2(acc.total);
    return acc;
  }

  function shiftsInMonth(shifts, key) {
    return shifts.filter((s) => monthKey(s.start) === key);
  }

  function shiftsInYear(shifts, year) {
    return shifts.filter((s) => new Date(s.start).getFullYear() === year);
  }

  /** Other shifts whose time range intersects `candidate`. Active shifts extend to `now`. */
  function findOverlaps(shifts, candidate, now) {
    const n = now == null ? Date.now() : now;
    const cEnd = candidate.end == null ? n : candidate.end;
    return shifts.filter((s) => {
      if (s.id === candidate.id) return false;
      const sEnd = s.end == null ? n : s.end;
      return s.start < cEnd && candidate.start < sEnd;
    });
  }

  /** Minutes -> "H:MM" (e.g. 510 -> "8:30"). */
  function formatDuration(minutes) {
    const m = Math.max(0, Math.round(minutes));
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  }

  return {
    round2,
    shiftMinutes,
    splitOvertime,
    shiftPay,
    monthKey,
    parseMonthKey,
    addMonths,
    summarize,
    shiftsInMonth,
    shiftsInYear,
    findOverlaps,
    formatDuration,
  };
});
