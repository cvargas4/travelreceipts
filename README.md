# Trip Receipts

A small web app for collecting conference travel receipts on your iPhone or Mac and exporting:

- **an Excel spreadsheet** (date, category, vendor/location, amount, currency, exchange rate, USD amount, PDF page numbers, totals by category, and the conference link at the top), and
- **one PDF** with every receipt in date order, one page per image. PDF invoices keep their original quality. Hotel stays are listed on the check-out date.

Everything you enter stays in the browser on your device. Nothing is uploaded anywhere. The only internet request the app makes is the exchange-rate lookup (frankfurter.dev, which uses European Central Bank reference rates).

---

## 1. Put it on GitHub Pages (one time, about 5 minutes)

GitHub only serves the app's code. Your receipts never go to GitHub.

1. Unzip the download. You should see `index.html`, `app.js`, `app.css`, `sw.js`, `manifest.webmanifest`, and the `icons` and `vendor` folders.
2. On github.com, click **New repository**.
   - Name: `trip-receipts` (or anything you like)
   - Visibility: **Public**. GitHub Pages is free for public repositories. The code is public, your data is not; it never leaves your devices.
   - Click **Create repository**.
3. On the new repository page, click **uploading an existing file**. Drag **everything inside** the unzipped folder (all files *and* the `icons` and `vendor` folders) into the upload area. Click **Commit changes**.
4. Go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main** and **/ (root)**, then **Save**.
5. After a minute or two, the page shows your address, for example `https://yourname.github.io/trip-receipts/`.

**Keeping it low-profile:** the app page includes a `noindex` tag, so search engines won't list it. The repository page on github.com can't carry that tag, so give the repository a forgettable name, leave its description blank, and don't pin it to your profile.

## 2. Install it

**iPhone:** Open the address in **Safari** → tap **Share** → **Add to Home Screen**. From now on, always open it from the Home Screen icon. The Home Screen app has its own storage, separate from Safari tabs, and it's protected from Safari's automatic cleanup of website data.

**Mac:** Open the address in Safari → **File → Add to Dock**. (Or just bookmark it. Chrome works too.)

After the first visit, the app works with no internet connection.

## 3. Using it

- **New trip:** name, conference website, dates, city, and the usual currency for the trip.
- **Add receipt:** take a photo or pick a photo/PDF, choose a category, enter the date, vendor and location, and amount.
  - **Hotel:** enter check-in and check-out. It's listed on the check-out date.
  - **Foreign currency:** the exchange rate for that date is looked up automatically. If you enter the **USD charged on your card**, that's used instead. You can attach a **card statement screenshot**; it goes in the PDF right after that receipt.
- **Edit anything, any time.** Tap a receipt to change it or delete it.
- **Extra pages** (trip menu `•••`): pages that go at the end of the PDF, such as a statement covering several charges or a registration confirmation.
- **Export:** creates the spreadsheet and PDF. Receipt numbers and PDF page numbers match the spreadsheet rows. Remembered a receipt later? Add it and export again.

## 4. Moving a trip between iPhone and Mac

1. On the device with the latest changes: trip menu `•••` → **Back up this trip** → **Share or AirDrop** (or **Download**).
2. On the other device: **Merge a backup** → pick the file.

Merging combines both sides. New receipts are added, the newer edit wins if a receipt changed on both devices, and deletions carry over. Merging the same file twice is harmless, so you can go back and forth as often as you like.

**Back up all trips** is in Settings (gear icon). Because data lives only in the browser, clearing Safari's website data or deleting the Home Screen app deletes it, so keep a backup of any trip you still need.

## 5. Updating the app later

If you (or Claude) change any file:

1. Upload the changed files to the repository (same "Add file → Upload files" flow; GitHub replaces files with the same name).
2. In `sw.js`, change the version in `const CACHE = 'trip-receipts-v1.0.1';` (e.g. to `v1.0.2`) and upload it too.

Your devices will show "A new version of the app is ready" with an **Update** button. Your data isn't affected by updates.

---

Third-party libraries in `vendor/` (bundled so the app works offline): [ExcelJS](https://github.com/exceljs/exceljs) (MIT) and [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT). Licenses are included in that folder.
