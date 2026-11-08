/*
 * app.js — UI layer. Holds the in-memory state, renders views, and wires events.
 * All business logic lives in calc.js / storage.js / report.js; this file only orchestrates.
 */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const BACKUP_REMIND_DAYS = 7;
  const { calc, store, report, xlsx, i18n } = window.WL;

  // localStorage can throw on access in some privacy modes; fall back to an in-memory shim.
  let LS;
  try {
    LS = window.localStorage;
    LS.getItem('x');
  } catch (e) {
    const mem = new Map();
    LS = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  }

  const browserLang = (navigator.language || '').toLowerCase().startsWith('he') ? 'he' : 'en';
  const loaded = store.load(LS, browserLang);
  let state = loaded.state;
  const ui = {
    tab: 'shifts',
    month: calc.monthKey(Date.now()),
    year: new Date().getFullYear(),
    startupNotice: loaded.unavailable ? 'storageUnavailable' : loaded.recovered ? 'recovered' : null,
  };

  // ---------- helpers ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const t = (key, vars) => i18n.t(state.settings.lang, key, vars);
  const loc = () => i18n.locale(state.settings.lang);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const activeShift = () => state.shifts.find((s) => s.end == null) || null;
  const pad = (n) => String(n).padStart(2, '0');

  function fmtMoney(n) {
    try {
      return new Intl.NumberFormat(loc(), { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 2 }).format(n);
    } catch (e) {
      return n.toFixed(2) + ' ' + state.settings.currency;
    }
  }
  const fmtTime = (ts) => new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(ts);
  const fmtDay = (ts) => new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long' }).format(ts);
  const fmtDateShort = (ts) => new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
  function fmtMonth(key) {
    const { year, month } = calc.parseMonthKey(key);
    return new Intl.DateTimeFormat(loc(), { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  }
  const fmtMonthShort = (y, m) => new Intl.DateTimeFormat(loc(), { month: 'short' }).format(new Date(y, m - 1, 1));
  const dateInputValue = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const timeInputValue = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function fmtTimer(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 3600) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
  }
  function parseNum(v) {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function persist() {
    try {
      store.save(LS, state);
      return true;
    } catch (e) {
      toast(t('saveFailed'));
      return false;
    }
  }

  // Ask the browser not to evict our storage under pressure (supported on Chrome/Edge/Firefox; iOS ignores it).
  function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action.label) + '</button>' : '');
    el.hidden = false;
    if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2600);
  }

  // ---------- dialogs ----------
  function openSheet(html, onMount) {
    const dlg = $('#sheet');
    dlg.innerHTML = '<div class="sheet-inner"><div class="sheet-handle" aria-hidden="true"></div>' + html + '</div>';
    if (!dlg.open) dlg.showModal();
    if (onMount) onMount(dlg);
    return dlg;
  }
  function closeSheet() {
    const dlg = $('#sheet');
    if (dlg.open) dlg.close();
  }
  // Tap on the dimmed backdrop closes the sheet.
  for (const id of ['#sheet', '#confirm']) {
    document.addEventListener('DOMContentLoaded', () => {
      $(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    });
  }

  /** Small choice dialog. buttons: [{label, value, kind}] -> Promise<value|null> */
  function choose(title, message, buttons) {
    return new Promise((resolve) => {
      const dlg = $('#confirm');
      dlg.innerHTML =
        '<div class="sheet-inner"><div class="sheet-handle" aria-hidden="true"></div>' +
        '<div class="sheet-head"><h2>' + esc(title) + '</h2></div>' +
        (message ? '<p class="msg">' + esc(message) + '</p>' : '') +
        '<div class="stack">' +
        buttons.map((b, i) => '<button type="button" class="btn btn-block btn-' + (b.kind || 'secondary') + '" data-i="' + i + '">' + esc(b.label) + '</button>').join('') +
        '<button type="button" class="btn btn-block btn-ghost" data-i="-1">' + esc(t('cancel')) + '</button></div></div>';
      let result = null;
      dlg.querySelectorAll('[data-i]').forEach((btn) => {
        btn.onclick = () => {
          const i = Number(btn.dataset.i);
          result = i >= 0 ? buttons[i].value : null;
          dlg.close();
        };
      });
      dlg.addEventListener('close', () => resolve(result), { once: true });
      dlg.showModal();
    });
  }

  // ---------- downloads ----------
  async function saveFile(bytesOrText, filename, mime) {
    const blob = new Blob([bytesOrText], { type: mime });
    // On phones, the share sheet is the friendliest way to put a file into Drive / WhatsApp / Files.
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (coarse && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return true;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return false; // user closed the share sheet
        // any other failure: fall through to a normal download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  // ---------- rendering ----------
  function applyLangAndTheme() {
    const lang = state.settings.lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = i18n.dir(lang);
    if (state.settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', state.settings.theme);
    document.title = t('appName');
    $('#app-title').textContent = t('appName');
    $('#lang-btn').textContent = t('switchLang');
    $('#settings-btn').setAttribute('aria-label', t('settings'));
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('.tab').forEach((el) => {
      if (el.dataset.tab === ui.tab) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  const CHEVRON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></svg>';
  const CHEVRON_R = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6"/></svg>';

  function renderSummaryBar() {
    const now = Date.now();
    let label, list, prevLabel, nextLabel;
    if (ui.tab === 'shifts') {
      label = fmtMonth(ui.month);
      list = calc.shiftsInMonth(state.shifts, ui.month);
      prevLabel = t('prevMonth');
      nextLabel = t('nextMonth');
    } else {
      label = String(ui.year);
      list = calc.shiftsInYear(state.shifts, ui.year);
      prevLabel = t('prevYear');
      nextLabel = t('nextYear');
    }
    const sum = calc.summarize(list, state.settings, now);
    // Chevrons are mirrored in RTL via CSS so "previous" always points toward the start of the line.
    $('#summary-bar').innerHTML =
      '<div class="period-nav">' +
      '<button type="button" class="icon-btn" data-act="prev" aria-label="' + esc(prevLabel) + '">' + CHEVRON + '</button>' +
      '<div class="label">' + esc(label) + '</div>' +
      '<button type="button" class="icon-btn" data-act="next" aria-label="' + esc(nextLabel) + '">' + CHEVRON_R + '</button>' +
      '</div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="v num">' + calc.formatDuration(sum.minutes) + '</div><div class="k">' + esc(t('hours')) + '</div></div>' +
      '<div class="stat money"><div class="v num">' + esc(fmtMoney(sum.total)) + '</div><div class="k">' + esc(t('earnings')) + '</div></div>' +
      '<div class="stat"><div class="v num">' + sum.count + '</div><div class="k">' + esc(t('shiftsCount')) + '</div></div>' +
      '</div>';
  }

  function bannersHtml() {
    let html = '';
    if (ui.startupNotice) html += '<div class="banner danger"><span>' + esc(t(ui.startupNotice)) + '</span></div>';
    if (!state.settings.hourlyRate) {
      html += '<div class="banner"><span>' + esc(t('setRateBanner')) + '</span><button type="button" class="btn" data-act="settings">' + esc(t('setRateAction')) + '</button></div>';
    }
    if (state.shifts.length) {
      const last = state.meta.lastBackupAt;
      const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
      if (last == null || days >= BACKUP_REMIND_DAYS) {
        const msg = last == null ? t('backupNever') : t('backupOld', { days });
        html += '<div class="banner"><span>' + esc(msg) + '</span><button type="button" class="btn" data-act="backup">' + esc(t('backupNow')) + '</button></div>';
      }
    }
    return html;
  }

  function renderShiftsView() {
    const now = Date.now();
    const active = activeShift();
    let html = bannersHtml();

    if (active) {
      const p = calc.shiftPay(active, state.settings, now);
      html +=
        '<div class="clock-card running">' +
        '<div class="running-head"><span class="pulse"></span><span>' + esc(t('onShiftSince', { time: fmtTime(active.start) })) + '</span></div>' +
        '<div class="timer num" id="live-timer">' + fmtTimer(now - active.start) + '</div>' +
        '<div class="timer-pay num" id="live-pay">' + esc(fmtMoney(p.total)) + '</div>' +
        '<button type="button" class="btn btn-danger btn-big btn-block" data-act="clock-out">' + esc(t('endShift')) + '</button>' +
        '</div>';
    } else {
      html += '<div class="clock-card"><button type="button" class="btn btn-primary btn-big btn-block" data-act="clock-in">' + esc(t('startShift')) + '</button></div>';
    }

    html +=
      '<div class="row-actions">' +
      '<button type="button" class="btn btn-secondary" data-act="add">＋ ' + esc(t('addManual')) + '</button>' +
      '<button type="button" class="btn btn-secondary" data-act="export">⤓ ' + esc(t('exportExcel')) + '</button>' +
      '</div>';

    const list = calc.shiftsInMonth(state.shifts, ui.month).sort((a, b) => b.start - a.start);
    if (!list.length) {
      html +=
        '<div class="empty"><svg viewBox="0 0 24 24" width="56" height="56" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>' +
        '<h2>' + esc(t('noShifts')) + '</h2><div>' + esc(t('noShiftsHint')) + '</div></div>';
    } else {
      let currentDay = null;
      for (const s of list) {
        const dayKey = dateInputValue(s.start);
        if (dayKey !== currentDay) {
          if (currentDay) html += '</div>';
          html += '<div class="day-group"><div class="day-label">' + esc(fmtDay(s.start)) + '</div>';
          currentDay = dayKey;
        }
        const p = calc.shiftPay(s, state.settings, now);
        const range = fmtTime(s.start) + ' – ' + (s.end == null ? '…' : fmtTime(s.end));
        html +=
          '<button type="button" class="shift" data-act="edit" data-id="' + esc(s.id) + '">' +
          '<span class="range num">' + range + (s.end == null ? '<span class="badge">' + esc(t('active')) + '</span>' : '') + '</span>' +
          '<span class="dur num">' + calc.formatDuration(p.minutes) + '</span>' +
          '<span class="note">' + esc(s.note || (s.breakMin ? t('breakMin') + ': ' + s.breakMin : '')) + '</span>' +
          '<span class="pay num">' + esc(fmtMoney(p.total)) + '</span>' +
          '</button>';
      }
      html += '</div>';
    }
    $('#view').innerHTML = html;
  }

  function renderSummaryView() {
    const now = Date.now();
    const yearShifts = calc.shiftsInYear(state.shifts, ui.year);
    const ys = calc.summarize(yearShifts, state.settings, now);
    const avgMin = ys.count ? ys.minutes / ys.count : 0;
    const effRate = ys.minutes ? ys.total / (ys.minutes / 60) : 0;

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const key = ui.year + '-' + pad(m);
      months.push({ m, key, sum: calc.summarize(calc.shiftsInMonth(yearShifts, key), state.settings, now) });
    }
    const max = Math.max(1, ...months.map((x) => x.sum.total));
    const currentKey = calc.monthKey(now);

    let html =
      '<div class="cards">' +
      '<div class="card"><div class="k">' + esc(t('avgShift')) + '</div><div class="v num">' + calc.formatDuration(avgMin) + '</div></div>' +
      '<div class="card"><div class="k">' + esc(t('effRate')) + '</div><div class="v num">' + esc(fmtMoney(effRate)) + '</div></div>' +
      '</div>' +
      '<div class="section-title">' + esc(t('byMonth')) + '</div><div class="bars">';
    for (const x of months) {
      const pct = (x.sum.total / max) * 100;
      html +=
        '<button type="button" class="bar-row' + (x.key === currentKey ? ' current' : '') + '" data-act="open-month" data-key="' + x.key + '">' +
        '<span class="m">' + esc(fmtMonthShort(ui.year, x.m)) + '</span>' +
        '<span><span class="bar-track"><span class="bar-fill" style="display:block;width:' + pct.toFixed(1) + '%"></span></span>' +
        '<span class="bar-meta"><span class="num muted">' + (x.sum.count ? calc.formatDuration(x.sum.minutes) + ' ' + esc(t('hours')) : '—') + '</span>' +
        '<span class="money num">' + (x.sum.count ? esc(fmtMoney(x.sum.total)) : '') + '</span></span></span>' +
        '</button>';
    }
    html += '</div>';

    const all = calc.summarize(state.shifts, state.settings, now);
    html +=
      '<div class="section-title all-time">' + esc(t('allTime')) + '</div>' +
      '<div class="cards">' +
      '<div class="card"><div class="k">' + esc(t('hours')) + '</div><div class="v num">' + calc.formatDuration(all.minutes) + '</div></div>' +
      '<div class="card"><div class="k">' + esc(t('earnings')) + '</div><div class="v num">' + esc(fmtMoney(all.total)) + '</div></div>' +
      '</div>';
    $('#view').innerHTML = html;
  }

  function render() {
    applyLangAndTheme();
    renderSummaryBar();
    if (ui.tab === 'shifts') renderShiftsView();
    else renderSummaryView();
    startTicker();
  }

  // Live timer: update only the numbers once per second (no full re-render, no flicker).
  let ticker = null;
  function startTicker() {
    clearInterval(ticker);
    if (!activeShift()) return;
    ticker = setInterval(() => {
      const a = activeShift();
      if (!a) return clearInterval(ticker);
      const now = Date.now();
      const timer = $('#live-timer');
      if (timer) timer.textContent = fmtTimer(now - a.start);
      const pay = $('#live-pay');
      if (pay) pay.textContent = fmtMoney(calc.shiftPay(a, state.settings, now).total);
      if (now % 15000 < 1000) renderSummaryBar(); // refresh totals every ~15s
    }, 1000);
  }

  // ---------- actions ----------
  function clockIn() {
    if (activeShift()) return toast(t('errActiveExists'));
    const now = Date.now();
    state.shifts.push({
      id: store.uid(), start: now, end: null, breakMin: state.settings.defaultBreakMin || 0,
      rate: state.settings.hourlyRate || 0, bonus: 0, note: '', createdAt: now, updatedAt: now,
    });
    ui.month = calc.monthKey(now);
    ui.tab = 'shifts';
    if (persist()) toast(t('shiftStarted'));
    requestPersistentStorage();
    render();
  }

  function clockOut() {
    const a = activeShift();
    if (!a) return;
    const now = Date.now();
    a.end = Math.max(now, a.start + 60000); // at least one minute, keeps end > start valid
    a.updatedAt = now;
    persist();
    toast(t('shiftEnded', { hours: calc.formatDuration(calc.shiftMinutes(a)) }));
    render();
  }

  function deleteShift(id) {
    const idx = state.shifts.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const [removed] = state.shifts.splice(idx, 1);
    persist();
    render();
    toast(t('deleted'), {
      label: t('undo'),
      run: () => {
        state.shifts.push(removed);
        state.shifts.sort((a, b) => a.start - b.start);
        persist();
        render();
      },
    });
  }

  // ---------- shift editor ----------
  function openShiftEditor(id) {
    const existing = id ? state.shifts.find((s) => s.id === id) : null;
    const now = Date.now();
    // A new manual shift defaults to today (or the 1st of the month being viewed), 09:00–17:00.
    let defStart;
    if (calc.monthKey(now) === ui.month) {
      const d = new Date(now); d.setHours(9, 0, 0, 0); defStart = d.getTime();
    } else {
      const { year, month } = calc.parseMonthKey(ui.month); defStart = new Date(year, month - 1, 1, 9, 0).getTime();
    }
    const s = existing || { start: defStart, end: defStart + 8 * 3600000, breakMin: state.settings.defaultBreakMin || 0, rate: state.settings.hourlyRate || 0, bonus: 0, note: '' };
    const rateVal = Number.isFinite(s.rate) ? s.rate : state.settings.hourlyRate || 0;

    const html =
      '<div class="sheet-head"><h2>' + esc(existing ? t('editShift') : t('newShift')) + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="' + esc(t('close')) + '">✕</button></div>' +
      '<form id="shift-form" novalidate>' +
      '<label class="field"><span>' + esc(t('date')) + '</span><input class="input" type="date" name="date" required value="' + dateInputValue(s.start) + '"></label>' +
      '<div class="grid-2 time-pair">' +
      '<label class="field"><span>' + esc(t('startTime')) + '</span><input class="input" type="time" name="start" required value="' + timeInputValue(s.start) + '"></label>' +
      '<label class="field"><span>' + esc(t('endTime')) + '</span><input class="input" type="time" name="end" value="' + (s.end == null ? '' : timeInputValue(s.end)) + '"></label>' +
      '</div>' +
      '<div class="next-day" id="next-day"></div>' +
      '<div class="grid-2" style="margin-bottom:12px">' +
      '<label class="field"><span>' + esc(t('breakMin')) + '</span><input class="input" type="number" inputmode="numeric" min="0" step="5" name="breakMin" value="' + (s.breakMin || 0) + '"></label>' +
      '<label class="field"><span>' + esc(t('rate')) + '</span><input class="input" type="number" inputmode="decimal" min="0" step="0.01" name="rate" value="' + rateVal + '"></label>' +
      '</div>' +
      '<label class="field"><span>' + esc(t('bonus')) + '</span><input class="input" type="number" inputmode="decimal" step="0.01" name="bonus" value="' + (s.bonus || 0) + '"></label>' +
      '<label class="field"><span>' + esc(t('note')) + '</span><input class="input" type="text" name="note" maxlength="500" placeholder="' + esc(t('notePlaceholder')) + '" value="' + esc(s.note || '') + '"></label>' +
      '<div class="preview num" id="preview"></div>' +
      '<div class="warn" id="overlap" hidden>' + esc(t('overlapWarn')) + '</div>' +
      '<div class="error" id="form-error" role="alert"></div>' +
      '<div class="form-actions' + (existing ? ' three' : '') + '">' +
      (existing ? '<button type="button" class="btn btn-ghost-danger" data-delete>' + esc(t('delete')) + '</button>' : '') +
      '<button type="button" class="btn btn-secondary" data-close>' + esc(t('cancel')) + '</button>' +
      '<button type="submit" class="btn btn-primary">' + esc(t('save')) + '</button>' +
      '</div></form>';

    openSheet(html, (dlg) => {
      const form = $('#shift-form', dlg);
      dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeSheet));

      /** Read the form into a shift draft. End time earlier than start means the shift ended the next day. */
      function readForm() {
        const f = form.elements;
        if (!f.date.value || !f.start.value) return { error: t('errStart') };
        const start = new Date(f.date.value + 'T' + f.start.value).getTime();
        if (!Number.isFinite(start)) return { error: t('errStart') };
        let end = null;
        let nextDay = false;
        if (f.end.value) {
          const e = new Date(f.date.value + 'T' + f.end.value);
          if (e.getTime() <= start) { e.setDate(e.getDate() + 1); nextDay = true; } // setDate keeps local wall time across DST
          end = e.getTime();
        }
        return {
          draft: {
            id: existing ? existing.id : null,
            start, end,
            breakMin: Math.max(0, Math.round(parseNum(f.breakMin.value) || 0)),
            rate: Math.max(0, parseNum(f.rate.value) || 0),
            bonus: parseNum(f.bonus.value) || 0,
            note: f.note.value.trim(),
          },
          nextDay,
        };
      }

      function update() {
        const r = readForm();
        $('#next-day', dlg).textContent = r.nextDay ? '↪ ' + t('nextDay') : '';
        if (r.error) { $('#preview', dlg).textContent = '—'; return; }
        const p = calc.shiftPay(r.draft, state.settings, Date.now());
        $('#preview', dlg).textContent = t('preview', { hours: calc.formatDuration(p.minutes), pay: fmtMoney(p.total) });
        $('#overlap', dlg).hidden = !calc.findOverlaps(state.shifts, r.draft, Date.now()).length;
        $('#form-error', dlg).textContent = '';
      }
      form.addEventListener('input', update);
      update();

      const del = dlg.querySelector('[data-delete]');
      if (del) del.onclick = async () => {
        const range = fmtTime(existing.start) + ' – ' + (existing.end == null ? '…' : fmtTime(existing.end));
        const ok = await choose(t('confirmDeleteTitle'), t('confirmDeleteMsg', { date: fmtDay(existing.start), range }), [{ label: t('delete'), value: true, kind: 'danger' }]);
        if (ok) { closeSheet(); deleteShift(existing.id); }
      };

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = readForm();
        const errEl = $('#form-error', dlg);
        if (r.error) { errEl.textContent = r.error; return; }
        const d = r.draft;
        if (d.end == null) {
          const other = activeShift();
          if (other && other.id !== d.id) { errEl.textContent = t('errActiveExists'); return; }
          if (d.start > Date.now()) { errEl.textContent = t('errFuture'); return; }
        }
        const now = Date.now();
        if (existing) {
          Object.assign(existing, d, { id: existing.id, updatedAt: now });
        } else {
          state.shifts.push(Object.assign(d, { id: store.uid(), createdAt: now, updatedAt: now }));
        }
        state.shifts.sort((a, b) => a.start - b.start);
        ui.month = calc.monthKey(d.start);
        closeSheet();
        if (persist()) toast(t('saved'));
        requestPersistentStorage();
        render();
      });
    });
  }

  // ---------- export ----------
  function openExport() {
    const year = calc.parseMonthKey(ui.month).year;
    const html =
      '<div class="sheet-head"><h2>' + esc(t('exportTitle')) + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="' + esc(t('close')) + '">✕</button></div>' +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary btn-block" data-range="month">' + esc(t('exportMonth', { month: fmtMonth(ui.month) })) + '</button>' +
      '<button type="button" class="btn btn-secondary btn-block" data-range="year">' + esc(t('exportYear', { year })) + '</button>' +
      '<button type="button" class="btn btn-secondary btn-block" data-range="all">' + esc(t('exportAll')) + '</button>' +
      '</div>';
    openSheet(html, (dlg) => {
      dlg.querySelector('[data-close]').onclick = closeSheet;
      dlg.querySelectorAll('[data-range]').forEach((b) => {
        b.onclick = async () => {
          const range = b.dataset.range;
          const shifts = range === 'month' ? calc.shiftsInMonth(state.shifts, ui.month)
            : range === 'year' ? calc.shiftsInYear(state.shifts, year) : state.shifts;
          if (!shifts.length) return toast(t('exportEmpty'));
          const bytes = report.buildWorkbook({ shifts, settings: state.settings, now: Date.now() });
          const suffix = range === 'month' ? ui.month : range === 'year' ? String(year) : 'all';
          closeSheet();
          if (await saveFile(bytes, 'work-log-' + suffix + '.xlsx', xlsx.MIME)) toast(t('exported'));
        };
      });
    });
  }

  // ---------- backup / restore ----------
  async function exportBackup() {
    const json = JSON.stringify(store.serializeBackup(state), null, 2);
    const stamp = new Date();
    const name = 'work-log-backup-' + stamp.getFullYear() + '-' + pad(stamp.getMonth() + 1) + '-' + pad(stamp.getDate()) + '.json';
    const ok = await saveFile(json, name, 'application/json');
    if (ok) {
      state.meta.lastBackupAt = Date.now();
      persist();
      toast(t('backupSaved'));
      render();
    }
    return ok;
  }

  async function importBackupFile(file) {
    let parsed;
    try {
      parsed = store.parseBackup(await file.text(), state.settings.lang);
    } catch (e) {
      const key = e.code === 'newer' ? 'errNewer' : e.code === 'json' ? 'errJson' : 'errFormat';
      return toast(t(key));
    }
    let mode = 'replace';
    if (state.shifts.length) {
      mode = await choose(t('importHowTitle'), t('importHowMsg', { n: parsed.state.shifts.length, m: state.shifts.length }), [
        { label: t('importMerge'), value: 'merge', kind: 'primary' },
        { label: t('importReplace'), value: 'replace', kind: 'danger' },
      ]);
      if (!mode) return;
    }
    store.savePreImport(LS, state); // snapshot for "Undo restore"
    let msg;
    if (mode === 'merge') {
      const r = store.mergeStates(state, parsed.state);
      state = r.state;
      msg = t('importedMerge', { added: r.added, updated: r.updated });
    } else {
      state = parsed.state;
      msg = t('imported', { n: state.shifts.length });
    }
    state.meta.lastBackupAt = state.meta.lastBackupAt || Date.now(); // the file itself is a backup
    if (parsed.skipped) msg += ' · ' + t('importSkipped', { n: parsed.skipped });
    persist();
    closeSheet();
    ui.startupNotice = null;
    render();
    toast(msg, {
      label: t('importUndo'),
      run: () => {
        const prev = store.loadPreImport(LS);
        if (prev) { state = prev; persist(); render(); toast(t('importUndone')); }
      },
    });
  }

  async function deleteAll() {
    const ok = await choose(t('deleteAllTitle'), t('deleteAllMsg'), [{ label: t('deleteAllConfirm'), value: true, kind: 'danger' }]);
    if (!ok) return;
    if (state.shifts.length) {
      const saved = await exportBackup(); // safety net first
      if (!saved) return;
    }
    const keep = state.settings;
    state = store.emptyState(keep.lang);
    state.settings = keep; // keep preferences, wipe the data
    persist();
    closeSheet();
    render();
    toast(t('allDeleted'));
  }

  // ---------- settings ----------
  function openSettings() {
    const s = state.settings;
    const ot = s.overtime;
    const seg = (name, options, current) =>
      '<div class="segmented" data-seg="' + name + '">' +
      options.map(([v, label]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (v === current) + '">' + esc(label) + '</button>').join('') + '</div>';
    const lastBackup = state.meta.lastBackupAt ? t('lastBackup', { date: fmtDateShort(state.meta.lastBackupAt) }) : t('noBackupYet');
    const monthShiftCount = calc.shiftsInMonth(state.shifts, ui.month).length;

    const html =
      '<div class="sheet-head"><h2>' + esc(t('settings')) + '</h2>' +
      '<button type="button" class="btn btn-ghost" data-close>' + esc(t('done')) + '</button></div>' +

      '<div class="settings-section" style="border-top:0;padding-top:0"><h3>' + esc(t('salary')) + '</h3>' +
      '<div class="grid-2" style="margin-bottom:6px">' +
      '<label class="field"><span>' + esc(t('hourlyRate')) + '</span><input class="input" type="number" inputmode="decimal" min="0" step="0.01" id="set-rate" value="' + (s.hourlyRate || '') + '"></label>' +
      '<label class="field"><span>' + esc(t('currency')) + '</span><select class="input" id="set-currency">' +
      ['ILS', 'USD', 'EUR', 'GBP'].concat(['ILS', 'USD', 'EUR', 'GBP'].includes(s.currency) ? [] : [s.currency])
        .map((c) => '<option value="' + c + '"' + (c === s.currency ? ' selected' : '') + '>' + c + '</option>').join('') +
      '</select></label></div>' +
      '<div class="field"><span class="hint">' + esc(t('hourlyRateHint')) + '</span></div>' +
      (monthShiftCount ? '<button type="button" class="btn btn-secondary btn-block" id="apply-rate" style="margin-bottom:12px">' + esc(t('applyRateMonth', { month: fmtMonth(ui.month) })) + '</button>' : '') +
      '<label class="field"><span>' + esc(t('defaultBreak')) + '</span><input class="input" type="number" inputmode="numeric" min="0" step="5" id="set-break" value="' + (s.defaultBreakMin || 0) + '"><span class="hint">' + esc(t('defaultBreakHint')) + '</span></label>' +
      '</div>' +

      '<div class="settings-section"><h3>' + esc(t('overtime')) + '</h3>' +
      '<label class="switch"><span>' + esc(t('overtimeEnable')) + '</span><input type="checkbox" id="set-ot" ' + (ot.enabled ? 'checked' : '') + '></label>' +
      '<div id="ot-fields"' + (ot.enabled ? '' : ' hidden') + '>' +
      '<div class="tier"><span class="tier-label">' + esc(t('tier1')) + '</span>' +
      '<label class="field"><span>' + esc(t('otAfter')) + '</span><input class="input" type="number" inputmode="decimal" min="0" max="24" step="0.1" id="set-ot-a1" value="' + ot.after1 + '"></label>' +
      '<label class="field"><span>' + esc(t('otRate')) + '</span><input class="input" type="number" inputmode="numeric" min="100" step="5" id="set-ot-r1" value="' + Math.round(ot.rate1 * 100) + '"></label></div>' +
      '<div class="tier"><span class="tier-label">' + esc(t('tier2')) + '</span>' +
      '<label class="field"><span>' + esc(t('otAfter')) + '</span><input class="input" type="number" inputmode="decimal" min="0" max="24" step="0.1" id="set-ot-a2" value="' + ot.after2 + '"></label>' +
      '<label class="field"><span>' + esc(t('otRate')) + '</span><input class="input" type="number" inputmode="numeric" min="100" step="5" id="set-ot-r2" value="' + Math.round(ot.rate2 * 100) + '"></label></div>' +
      '<div class="field"><span class="hint">' + esc(t('overtimeHint')) + '</span></div>' +
      '</div></div>' +

      '<div class="settings-section"><h3>' + esc(t('appearance')) + '</h3>' +
      '<div class="field"><span>' + esc(t('language')) + '</span>' + seg('lang', [['he', 'עברית'], ['en', 'English']], s.lang) + '</div>' +
      '<div class="field"><span>' + esc(t('theme')) + '</span>' + seg('theme', [['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]], s.theme) + '</div>' +
      '</div>' +

      '<div class="settings-section"><h3>' + esc(t('data')) + '</h3>' +
      '<p class="hint muted" style="margin:0 0 10px;font-size:.88rem">' + esc(t('dataHint')) + '</p>' +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary btn-block" id="do-backup">' + esc(t('exportBackup')) + '</button>' +
      '<button type="button" class="btn btn-secondary btn-block" id="do-import">' + esc(t('importBackup')) + '</button>' +
      '</div><div class="footer-note">' + esc(lastBackup) + '</div></div>' +

      '<div class="settings-section"><h3>' + esc(t('dangerZone')) + '</h3>' +
      '<button type="button" class="btn btn-ghost-danger btn-block" id="do-delete-all">' + esc(t('deleteAll')) + '</button></div>' +
      '<div class="footer-note">' + esc(t('appName')) + ' · ' + esc(t('version', { v: APP_VERSION })) + '</div>';

    openSheet(html, (dlg) => {
      dlg.querySelector('[data-close]').onclick = () => { closeSheet(); render(); };

      const saveSettings = () => {
        state.settings = store.normalizeSettings(state.settings, state.settings.lang);
        persist();
        renderSummaryBar();
      };
      const bindNum = (id, apply) => {
        $(id, dlg).addEventListener('change', (e) => { const n = parseNum(e.target.value); apply(n == null ? 0 : n); saveSettings(); });
      };
      bindNum('#set-rate', (n) => { state.settings.hourlyRate = n; });
      bindNum('#set-break', (n) => { state.settings.defaultBreakMin = Math.round(n); });
      bindNum('#set-ot-a1', (n) => { state.settings.overtime.after1 = n; });
      bindNum('#set-ot-a2', (n) => { state.settings.overtime.after2 = n; });
      bindNum('#set-ot-r1', (n) => { state.settings.overtime.rate1 = n / 100; });
      bindNum('#set-ot-r2', (n) => { state.settings.overtime.rate2 = n / 100; });
      $('#set-currency', dlg).addEventListener('change', (e) => { state.settings.currency = e.target.value; saveSettings(); });
      $('#set-ot', dlg).addEventListener('change', (e) => {
        state.settings.overtime.enabled = e.target.checked;
        $('#ot-fields', dlg).hidden = !e.target.checked;
        saveSettings();
      });

      const applyRate = $('#apply-rate', dlg);
      if (applyRate) applyRate.onclick = () => {
        const n = parseNum($('#set-rate', dlg).value) || 0;
        state.settings.hourlyRate = n;
        const list = calc.shiftsInMonth(state.shifts, ui.month);
        const now = Date.now();
        list.forEach((s) => { s.rate = n; s.updatedAt = now; });
        saveSettings();
        toast(t('rateApplied', { n: list.length }));
      };

      dlg.querySelectorAll('[data-seg]').forEach((segEl) => {
        segEl.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-v]');
          if (!b) return;
          state.settings[segEl.dataset.seg] = b.dataset.v;
          saveSettings();
          render();
          openSettings(); // re-open so the sheet itself switches language / direction
        });
      });

      $('#do-backup', dlg).onclick = exportBackup;
      $('#do-import', dlg).onclick = () => $('#import-file').click();
      $('#do-delete-all', dlg).onclick = deleteAll;
    });
  }

  // ---------- global events ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'clock-in': return clockIn();
      case 'clock-out': return clockOut();
      case 'add': return openShiftEditor(null);
      case 'edit': return openShiftEditor(el.dataset.id);
      case 'export': return openExport();
      case 'settings': return openSettings();
      case 'backup': return exportBackup();
      case 'prev':
      case 'next': {
        const d = el.dataset.act === 'prev' ? -1 : 1;
        if (ui.tab === 'shifts') ui.month = calc.addMonths(ui.month, d);
        else ui.year += d;
        return render();
      }
      case 'open-month':
        ui.month = el.dataset.key;
        ui.tab = 'shifts';
        return render();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('#tabbar').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      ui.tab = tab.dataset.tab;
      if (ui.tab === 'summary') ui.year = calc.parseMonthKey(ui.month).year;
      render();
      window.scrollTo(0, 0);
    });
    $('#settings-btn').addEventListener('click', openSettings);
    $('#lang-btn').addEventListener('click', () => {
      state.settings.lang = state.settings.lang === 'he' ? 'en' : 'he';
      persist();
      render();
    });
    $('#import-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // allow choosing the same file again later
      if (file) importBackupFile(file);
    });
    render();
  });

  // Another tab changed the data -> reload it so the two tabs never overwrite each other.
  window.addEventListener('storage', (e) => {
    if (e.key !== store.KEY) return;
    state = store.load(LS, state.settings.lang).state;
    render();
  });

  // Coming back to the app (e.g. phone unlocked): refresh the live numbers.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  // Offline support. Service workers only run over http(s), not when opened as a local file.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
