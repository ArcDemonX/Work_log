/*
 * xlsx.js — tiny dependency-free .xlsx writer.
 *
 * An .xlsx file is a ZIP archive of XML files (the Office Open XML format). This module writes
 * the minimum set of parts Excel / Google Sheets / LibreOffice / Numbers need, and packs them
 * with a minimal "stored" (uncompressed) ZIP writer. No external library means it works offline
 * and there is nothing to update or break later.
 *
 * Sheet spec:
 *   { name, rtl, cols: [widthInChars...], rows: [[cell, ...], ...], freezeHeader }
 * Cell: null | string | number | { v, s }  where s is a style name from STYLES below.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.WL = root.WL || {}).xlsx = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Index = position in <cellXfs> inside styles.xml.
  const STYLES = { default: 0, header: 1, hours: 2, money: 3, boldHours: 4, boldMoney: 5, bold: 6, date: 7, time: 8, boldInt: 9 };

  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="#,##0.00"/>' +
    '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>' +
    '<numFmt numFmtId="166" formatCode="hh:mm"/>' +
    '</numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE0E7FF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /** Escape XML text and strip control characters that are illegal in XML 1.0. */
  function escXml(str) {
    return String(str)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 0 -> A, 25 -> Z, 26 -> AA */
  function colName(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** Excel sheet names: max 31 chars, none of []:*?/\ */
  function safeSheetName(name, idx) {
    const n = String(name || 'Sheet' + (idx + 1)).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31);
    return n || 'Sheet' + (idx + 1);
  }

  /** Local calendar date -> Excel serial number (days since 1899-12-30). */
  function dateSerial(ts) {
    const d = new Date(ts);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  }

  /** Local time of day -> Excel fraction of a day. */
  function timeSerial(ts) {
    const d = new Date(ts);
    return (d.getHours() * 60 + d.getMinutes()) / 1440;
  }

  function cellXml(cell, ref) {
    if (cell == null || cell === '') return '';
    const c = typeof cell === 'object' ? cell : { v: cell };
    if (c.v == null || c.v === '') return '';
    const s = c.s && STYLES[c.s] ? ' s="' + STYLES[c.s] + '"' : '';
    if (typeof c.v === 'number' && Number.isFinite(c.v)) {
      return '<c r="' + ref + '"' + s + '><v>' + c.v + '</v></c>';
    }
    // inlineStr keeps the writer simple (no shared-strings table needed).
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escXml(c.v) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    const views =
      '<sheetViews><sheetView workbookViewId="0"' + (sheet.rtl ? ' rightToLeft="1"' : '') + '>' +
      (sheet.freezeHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') +
      '</sheetView></sheetViews>';
    const cols = (sheet.cols || []).length
      ? '<cols>' + sheet.cols.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>'
      : '';
    const rows = (sheet.rows || [])
      .map((row, r) => '<row r="' + (r + 1) + '">' + row.map((cell, c) => cellXml(cell, colName(c) + (r + 1))).join('') + '</row>')
      .join('');
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      views + cols + '<sheetData>' + rows + '</sheetData></worksheet>'
    );
  }

  function workbookParts(sheets) {
    const names = sheets.map((s, i) => safeSheetName(s.name, i));
    const files = {};
    files['[Content_Types].xml'] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '</Types>';
    files['_rels/.rels'] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    files['xl/workbook.xml'] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + names.map((n, i) => '<sheet name="' + escXml(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' +
      '</workbook>';
    files['xl/_rels/workbook.xml.rels'] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    files['xl/styles.xml'] = STYLES_XML;
    sheets.forEach((s, i) => {
      files['xl/worksheets/sheet' + (i + 1) + '.xml'] = sheetXml(s);
    });
    return files;
  }

  // ---------- Minimal ZIP writer (method 0 = stored) ----------

  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const [name, content] of Object.entries(files)) {
      const nameBytes = enc.encode(name);
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header signature
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // flag: UTF-8 names
      local.setUint16(8, 0, true); // method: stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); // central directory signature
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // end of central directory
    const count = Object.keys(files).length;
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
    let p = 0;
    for (const c of all) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }

  /** Build an .xlsx file. Returns Uint8Array. */
  function write(sheets) {
    return zip(workbookParts(sheets));
  }

  return { write, zip, crc32, colName, safeSheetName, dateSerial, timeSerial, escXml, STYLES, MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
});
