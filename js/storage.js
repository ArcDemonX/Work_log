/*
 * storage.js — data model, validation, persistence, backup import/export.
 *
 * Safety rules this module enforces (data loss is the #1 risk of a local-only app):
 *  1. Corrupted stored data is NEVER overwritten: the raw text is copied aside before starting fresh.
 *  2. Backups carry a schema version; files from a newer app version are rejected, not half-read.
 *  3. Imports are validated shift-by-shift; invalid rows are skipped and counted, not silently kept.
 *  4. Before an import replaces data, the previous state is snapshotted so it can be undone.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.WL = root.WL || {}).store = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_ID = 'work-log';
  const SCHEMA_VERSION = 1;
  const KEY = 'worklog.data';
  const PREIMPORT_KEY = 'worklog.preimport';
  const MAX_SHIFT_MS = 48 * 3600 * 1000; // anything longer is almost certainly a typo

  function storeError(code, detail) {
    const e = new Error(detail || code);
    e.code = code;
    return e;
  }

  function defaultSettings(lang) {
    return {
      lang: lang === 'en' ? 'en' : 'he',
      theme: 'auto', // auto | light | dark
      currency: 'ILS',
      hourlyRate: 0,
      defaultBreakMin: 0,
      overtime: { enabled: false, after1: 8, rate1: 1.25, after2: 10, rate2: 1.5 },
    };
  }

  function emptyState(lang) {
    return {
      version: SCHEMA_VERSION,
      settings: defaultSettings(lang),
      shifts: [],
      meta: { createdAt: Date.now(), lastBackupAt: null },
    };
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /** Accept epoch ms or any Date-parsable string (lets hand-edited backups use ISO dates). */
  function toTs(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) return n;
    }
    return null;
  }

  function num(v, def, min, max) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeSettings(raw, fallbackLang) {
    const d = defaultSettings(fallbackLang);
    const s = raw && typeof raw === 'object' ? raw : {};
    const ot = s.overtime && typeof s.overtime === 'object' ? s.overtime : {};
    return {
      lang: s.lang === 'en' || s.lang === 'he' ? s.lang : d.lang,
      theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : d.theme,
      currency: typeof s.currency === 'string' && /^[A-Za-z]{3}$/.test(s.currency) ? s.currency.toUpperCase() : d.currency,
      hourlyRate: num(s.hourlyRate, d.hourlyRate, 0, 1e6),
      defaultBreakMin: Math.round(num(s.defaultBreakMin, d.defaultBreakMin, 0, 600)),
      overtime: {
        enabled: Boolean(ot.enabled),
        after1: num(ot.after1, d.overtime.after1, 0, 24),
        rate1: num(ot.rate1, d.overtime.rate1, 1, 10),
        after2: num(ot.after2, d.overtime.after2, 0, 24),
        rate2: num(ot.rate2, d.overtime.rate2, 1, 10),
      },
    };
  }

  /** Returns a clean shift object, or null if the row is unusable. */
  function normalizeShift(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const start = toTs(raw.start);
    if (start == null) return null;
    let end = raw.end == null || raw.end === '' ? null : toTs(raw.end);
    if (raw.end != null && raw.end !== '' && end == null) return null; // end present but unreadable
    if (end != null && (end <= start || end - start > MAX_SHIFT_MS)) return null;
    const now = Date.now();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      start,
      end,
      breakMin: Math.round(num(raw.breakMin, 0, 0, 24 * 60)),
      rate: raw.rate == null || raw.rate === '' ? null : num(raw.rate, null, 0, 1e6),
      bonus: num(raw.bonus, 0, -1e7, 1e7),
      note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
      createdAt: toTs(raw.createdAt) || now,
      updatedAt: toTs(raw.updatedAt) || now,
    };
  }

  /** Placeholder for future schema upgrades: each step converts version N -> N+1. */
  function migrate(raw) {
    const out = Object.assign({}, raw);
    if (out.version == null) out.version = 1;
    return out;
  }

  /** Validate any raw object into a full state. Returns { state, skipped }. */
  function normalizeState(raw, fallbackLang) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.shifts)) throw storeError('format');
    if (typeof raw.version === 'number' && raw.version > SCHEMA_VERSION) throw storeError('newer');
    const m = migrate(raw);
    let skipped = 0;
    const seen = new Set();
    const shifts = [];
    for (const r of m.shifts) {
      const s = normalizeShift(r);
      if (!s || seen.has(s.id)) {
        skipped++;
        continue;
      }
      seen.add(s.id);
      shifts.push(s);
    }
    // The UI supports exactly one running shift; keep the newest, drop the rest.
    const active = shifts.filter((s) => s.end == null).sort((a, b) => b.start - a.start);
    const dropped = new Set(active.slice(1).map((s) => s.id));
    skipped += dropped.size;
    const cleanShifts = shifts.filter((s) => !dropped.has(s.id)).sort((a, b) => a.start - b.start);
    const meta = m.meta && typeof m.meta === 'object' ? m.meta : {};
    return {
      state: {
        version: SCHEMA_VERSION,
        settings: normalizeSettings(m.settings, fallbackLang),
        shifts: cleanShifts,
        meta: { createdAt: toTs(meta.createdAt) || Date.now(), lastBackupAt: toTs(meta.lastBackupAt) },
      },
      skipped,
    };
  }

  /** Object written to a backup file. `app` + `version` let future versions recognise it. */
  function serializeBackup(state) {
    return {
      app: APP_ID,
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      shifts: state.shifts,
      meta: state.meta,
    };
  }

  function parseBackup(text, fallbackLang) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw storeError('json');
    }
    if (raw && raw.app && raw.app !== APP_ID) throw storeError('format');
    return normalizeState(raw, fallbackLang);
  }

  /**
   * Merge an imported state into the current one. Settings stay as they are on this device.
   * Same id on both sides -> the copy with the newer `updatedAt` wins.
   */
  function mergeStates(current, incoming) {
    const byId = new Map(current.shifts.map((s) => [s.id, s]));
    let added = 0;
    let updated = 0;
    for (const s of incoming.shifts) {
      const existing = byId.get(s.id);
      if (!existing) {
        byId.set(s.id, s);
        added++;
      } else if (s.updatedAt > existing.updatedAt) {
        byId.set(s.id, s);
        updated++;
      }
    }
    // Re-run normalisation to enforce the single-active-shift rule after merging.
    const merged = normalizeState(
      { version: SCHEMA_VERSION, settings: current.settings, meta: current.meta, shifts: [...byId.values()] },
      current.settings.lang
    ).state;
    return { state: merged, added, updated };
  }

  /**
   * Load from a Storage-like object (localStorage). Returns { state, recovered }.
   * `recovered` is true when stored data was unreadable and has been copied aside.
   */
  function load(ls, fallbackLang) {
    let text = null;
    try {
      text = ls.getItem(KEY);
    } catch (e) {
      return { state: emptyState(fallbackLang), recovered: false, unavailable: true };
    }
    if (text == null) return { state: emptyState(fallbackLang), recovered: false };
    try {
      return { state: normalizeState(JSON.parse(text), fallbackLang).state, recovered: false };
    } catch (e) {
      try {
        ls.setItem('worklog.corrupt.' + Date.now(), text);
      } catch (_) {
        /* storage full — at least we did not overwrite KEY yet */
      }
      return { state: emptyState(fallbackLang), recovered: true };
    }
  }

  function save(ls, state) {
    ls.setItem(KEY, JSON.stringify(state));
  }

  function savePreImport(ls, state) {
    try {
      ls.setItem(PREIMPORT_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadPreImport(ls) {
    try {
      const text = ls.getItem(PREIMPORT_KEY);
      return text ? normalizeState(JSON.parse(text)).state : null;
    } catch (e) {
      return null;
    }
  }

  return {
    APP_ID,
    SCHEMA_VERSION,
    KEY,
    defaultSettings,
    emptyState,
    uid,
    normalizeSettings,
    normalizeShift,
    normalizeState,
    serializeBackup,
    parseBackup,
    mergeStates,
    load,
    save,
    savePreImport,
    loadPreImport,
  };
});
