# Trip Receipts

A small web app for collecting conference travel receipts on your iPhone or Mac and exporting:

- **an Excel spreadsheet** (date, category, vendor/location, amount, currency, exchange rate, USD amount, PDF page numbers, totals by category, and the conference link at the top), and
- **one PDF** with every receipt in date order, one page per image. PDF invoices keep their original quality. Hotel stays are listed on the check-out date.

Everything you enter stays in the browser on your device. Nothing is uploaded anywhere. The only internet request the app makes is the exchange-rate lookup (frankfurter.dev, which uses European Central Bank reference rates).

---

## 1. 'Install' it

**iPhone:** Open the address in **Safari** → tap **Share** → **Add to Home Screen**. From now on, always open it from the Home Screen icon. The Home Screen app has its own storage, separate from Safari tabs, and it's protected from Safari's automatic cleanup of website data.

**Mac:** Open the address in Safari → **File → Add to Dock**. (Or just bookmark it. Chrome works too.)

After the first visit, the app works with no internet connection.

## 2. Using it

- **New trip:** name, conference website, dates, city, and the usual currency for the trip.
- **Add receipt:** take a photo or pick a photo/PDF, choose a category, enter the date, vendor and location, and amount.
  - **Hotel:** enter check-in and check-out. It's listed on the check-out date.
  - **Foreign currency:** the exchange rate for that date is looked up automatically. If you enter the **USD charged on your card**, that's used instead. You can attach a **card statement screenshot**; it goes in the PDF right after that receipt.
- **Edit anything, any time.** Tap a receipt to change it or delete it.
- **Extra pages** (trip menu `•••`): pages that go at the end of the PDF, such as a statement covering several charges or a registration confirmation.
- **Export:** creates the spreadsheet and PDF. Receipt numbers and PDF page numbers match the spreadsheet rows. Remembered a receipt later? Add it and export again.

## 3. Moving a trip between iPhone and Mac (should work on other devices too, but not tested)

1. On the device with the latest changes: trip menu `•••` → **Back up this trip** → **Share or AirDrop** (or **Download**).
2. On the other device: **Merge a backup** → pick the file.

Merging combines both sides. New receipts are added, the newer edit wins if a receipt changed on both devices, and deletions carry over. Merging the same file twice is harmless, so you can go back and forth as often as you like.

**Back up all trips** is in Settings (gear icon). Because data lives only in the browser, clearing Safari's website data or deleting the Home Screen app deletes it, so keep a backup of any trip you still need.



Third-party libraries in `vendor/` (bundled so the app works offline): [ExcelJS](https://github.com/exceljs/exceljs) (MIT) and [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT). Licenses are included in that folder.
