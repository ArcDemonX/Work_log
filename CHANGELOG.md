# Changelog

## 1.1.0 — 2026-11-08

- **Excel import**: import `.xlsx` files (the app's own export, or any sheet with Date / In / Out
  columns in Hebrew or English). Rows are added, duplicates skipped, with undo.
- New **Import / Export** screen on the main page; import is also offered on the empty screen
- Removed the backup reminder banner
- GitHub Pages now deploys automatically on every push to `main`

## 1.0.0 — 2026-11-08

First release.

- Clock in / clock out with a live timer and live earnings
- Manual add / edit / delete of shifts (overnight supported), with undo for delete
- Pay: hourly rate (stored per shift), break, bonus/tips, optional two-tier overtime
- Sticky monthly totals bar; month navigation; yearly summary with per-month bars
- Excel (.xlsx) export: month / year / all, with a monthly summary sheet, RTL in Hebrew
- Full JSON backup & restore (merge or replace, with undo), automatic backup before
  "delete all", corrupted-data preservation
- Hebrew & English (RTL/LTR), light/dark theme
- Installable offline PWA
