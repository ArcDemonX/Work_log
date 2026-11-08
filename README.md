# Work Log · יומן משמרות

**A mobile-first shift tracker.** Clock in and out with one tap, see your hours and earnings per month, export to Excel, and keep full backups. Hebrew and English. Works offline and installs on your phone like a regular app.

[עברית למטה ⬇](#עברית)

---

## Features

| | |
|---|---|
| ⏱ **Clock in / out** | One big button. A live timer and live earnings show while you work. |
| ✍️ **Manual shifts** | Add or edit any past shift. An end time earlier than the start time is treated as the next day (overnight shifts). |
| 💰 **Pay calculation** | Hourly rate, unpaid break, bonus/tips per shift, and optional **overtime tiers** (e.g. 125% after 8h, 150% after 10h). |
| 📊 **Totals bar** | A sticky bar always shows the selected month's hours, earnings and shift count. |
| 🗓 **By month** | Navigate month by month. The Summary tab shows a yearly bar chart, effective hourly rate and all-time totals. |
| 📗 **Excel export** | A real `.xlsx` file for the month, the year, or everything. It has a shifts sheet and a monthly summary sheet, real date/time cells, and right-to-left layout in Hebrew. |
| 📥 **Excel import** | Import an `.xlsx` file: one exported from the app and edited, or your own sheet with *Date / In / Out* columns (Hebrew or English headers, any order). Rows are **added**, and duplicates are skipped, so re-importing the same file is safe. |
| 🛟 **Backup & restore** | One-file JSON backup of *everything*. Restore by **merging** or **replacing**. Every import has an **Undo** button. |
| 🌐 **Hebrew / English** | Full RTL/LTR support. Switch any time from the top bar. |
| 🌙 **Dark mode** | Follows your phone, or set it manually. |
| 📴 **Offline** | Installable PWA. No internet needed after the first load. |

## ⚠️ Your data: read this once

Your data is stored **only on your device**, in the browser's storage for the app's web address. There is no server and no account. That's great for privacy, but it means:

- **Changing the app's address loses access to the data.** That includes a new domain, a renamed repository, or moving from GitHub Pages to Netlify: a different address is a different storage box. **Always save a backup before moving**, then restore it at the new address.
- Clearing the browser's site data, uninstalling the browser, or switching phones also leaves the data behind.
- iOS Safari may delete storage for websites you haven't opened in a few weeks. **Installing to the home screen** prevents this.

Protections built into the app:

- **Delete-all safety.** "Delete all data" downloads a backup file *first*.
- **Undo import.** Every import (backup or Excel) snapshots your current data so you can undo it.
- **Corrupt data is preserved.** If stored data is ever unreadable, it's copied aside, never overwritten.
- **Persistent storage.** The app asks the browser not to evict its storage (supported on Android/Chrome).
- **Versioned backups.** Backup files carry a schema version, so future versions of the app can still read old backups.

**Good habit:** Import / Export → *Save backup file* → keep it in Google Drive / email / WhatsApp to yourself.

## Using it on your phone

1. Open the app's URL in **Chrome (Android)** or **Safari (iPhone)**.
2. Install it:
   - Android: menu ⋮ → *Install app* / *Add to Home screen*
   - iPhone: Share button → *Add to Home Screen*
3. Open it from the home-screen icon. It runs full-screen and works offline.

## Hosting (GitHub Pages)

The app is plain static files (HTML/CSS/JS) with **no build step and no dependencies**.

**One-time setup** (the repository must be **public**; Pages is free for public repos):

1. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**
2. *Actions* tab → **Deploy to GitHub Pages** → *Run workflow* (after this, every push to `main` deploys automatically)
3. The app is live at `https://<your-username>.github.io/Work_log/`

> Making the repo public publishes the **code only**. Your shifts and salary never leave your phone. `.gitignore` also blocks backup and export files from being committed by accident.

Alternatives: **Netlify** or **Cloudflare Pages** (free, no build command, publish directory `/`; `netlify.toml` is included).

**Pick one address and stick with it.** See the data section above.

## Running locally

```bash
python3 -m http.server 8080   # or: npm start
# open http://localhost:8080
```

You can also open `index.html` directly. Everything works except offline caching, because service workers need http(s).

## Tests

```bash
npm test   # Node 18+, no npm install needed
```

Unit tests cover the pay/overtime math, overnight shifts, backup validation/merge/round-trip, corrupted-storage recovery, the Excel writer (ZIP structure + CRC checks), and Excel import (round-trip, files re-saved by other spreadsheet programs, custom column layouts). CI runs them on every push.

## Project structure

```
index.html              App shell
css/styles.css          Mobile-first styles; logical CSS properties so RTL/LTR share one stylesheet
js/calc.js              Pure math: hours, overtime, pay, month grouping, overlaps
js/storage.js           Data model, validation, migration, load/save, backup parse/merge
js/report.js            Shifts ⇄ spreadsheet rows (export and import)
js/xlsx.js              Tiny dependency-free .xlsx writer and reader (OOXML + ZIP)
js/i18n.js              Hebrew / English strings
js/app.js               UI: rendering, dialogs, events
sw.js                   Service worker (offline cache)
manifest.webmanifest    PWA install metadata
tests/                  node:test unit tests (+ fixtures/ sample .xlsx files)
```

### Design decisions

- **No framework, no dependencies.** Nothing to install, nothing to go out of date, and the app keeps working years from now as-is.
- **Each shift stores its own hourly rate.** Changing your salary affects new shifts only, so past months don't silently change. (Settings has a button to apply a new rate to the current month if you got a raise mid-month.)
- **Times are stored as UTC timestamps.** Durations are timestamp differences, so overnight shifts and daylight-saving changes are always correct.
- **A shift belongs to the month it started in.**
- **Overtime is calculated per shift.**

### Backup file format

```json
{
  "app": "work-log",
  "version": 1,
  "exportedAt": "2026-11-08T10:00:00.000Z",
  "settings": { "lang": "he", "currency": "ILS", "hourlyRate": 45, "defaultBreakMin": 0, "theme": "auto",
                "overtime": { "enabled": false, "after1": 8, "rate1": 1.25, "after2": 10, "rate2": 1.5 } },
  "shifts": [
    { "id": "…", "start": 1762149600000, "end": 1762180200000, "breakMin": 30,
      "rate": 45, "bonus": 0, "note": "", "createdAt": 1762149600000, "updatedAt": 1762180200000 }
  ],
  "meta": { "createdAt": 1762000000000, "lastBackupAt": 1762596000000 }
}
```

`start`/`end` are epoch milliseconds. ISO date strings are also accepted on import. `end: null` is a running shift. When **merging**, shifts are matched by `id`, and the copy with the newer `updatedAt` wins.

When releasing a change, bump `APP_VERSION` in `js/app.js` and `CACHE` in `sw.js` so phones pick up the new files.

---

<div dir="rtl">

## עברית

**אפליקציה לניהול משמרות, בנויה קודם כול לנייד.** מתחילים ומסיימים משמרת בלחיצה, רואים שעות והכנסה לכל חודש, מייצאים לאקסל ושומרים גיבוי מלא. עובדת גם בלי אינטרנט ומותקנת בטלפון כמו אפליקציה רגילה.

### מה יש בה

- **התחלת משמרת / סיום משמרת**: כפתור אחד גדול, עם טיימר והכנסה שמתעדכנים בזמן אמת.
- **הוספה ועריכה ידנית** של כל משמרת. אם שעת היציאה מוקדמת משעת הכניסה, המשמרת נחשבת כמסתיימת למחרת (משמרות לילה).
- **חישוב שכר**: שכר לשעה, הפסקה, תוספות וטיפים, ו**שעות נוספות** במדרגות (למשל 125% אחרי 8 שעות ו-150% אחרי 10).
- **בר סיכום קבוע** בראש המסך: שעות, הכנסה ומספר משמרות של החודש.
- **חלוקה לחודשים**, ומסך סיכום שנתי עם גרף לפי חודשים.
- **ייצוא לאקסל** (קובץ ‎.xlsx אמיתי, מימין לשמאל) של חודש, שנה או הכול.
- **ייבוא מאקסל**: קובץ שיוצא מהאפליקציה ונערך, או גיליון שלכם עם עמודות תאריך / כניסה / יציאה. משמרות מתווספות, וכפילויות מדולגות.
- **גיבוי ושחזור** של כל המידע בקובץ אחד: מיזוג או החלפה, עם אפשרות לבטל כל ייבוא.
- עברית ואנגלית, מצב כהה, ועבודה בלי אינטרנט.

### ⚠️ חשוב: איפה המידע נשמר

המידע נשמר **רק במכשיר**, תחת הכתובת שממנה פותחים את האפליקציה. אין שרת ואין חשבון. לכן:

- **החלפת כתובת = המידע לא עובר.** למשל שינוי שם ל-repository, מעבר בין GitHub Pages ל-Netlify, או דומיין חדש. **תמיד שומרים גיבוי לפני מעבר**, ומשחזרים אותו בכתובת החדשה.
- מחיקת נתוני הדפדפן או החלפת טלפון: אותו דבר.
- באייפון, **התקנה למסך הבית** מונעת מספארי למחוק את המידע אחרי תקופה בלי שימוש.

**הרגל מומלץ:** ייבוא / ייצוא ← *שמירת קובץ גיבוי* ← לשמור בדרייב, במייל או בוואטסאפ לעצמכם.

### התקנה בטלפון

1. פותחים את הקישור ב-Chrome (אנדרואיד) או ב-Safari (אייפון).
2. אנדרואיד: תפריט ⋮ ← *התקנת אפליקציה*. אייפון: כפתור השיתוף ← *הוספה למסך הבית*.
3. פותחים מהאייקון. האפליקציה עובדת במסך מלא וגם בלי אינטרנט.

### אחסון (Hosting)

האפליקציה מתארחת ב-**GitHub Pages** בחינם (הריפו צריך להיות **ציבורי**):
1. ‏Settings ← Pages ← Source: **GitHub Actions**
2. לשונית Actions ← **Deploy to GitHub Pages** ← Run workflow. מכאן והלאה כל עדכון ל-main עולה אוטומטית.
3. הכתובת: `https://<שם-המשתמש>.github.io/Work_log/`

ריפו ציבורי חושף רק את **הקוד**. המשמרות והשכר שלכם נשארים בטלפון בלבד.

</div>
