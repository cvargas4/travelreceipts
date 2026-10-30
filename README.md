# Trip Receipts

A small web app for collecting conference travel receipts on your phone or computer, then exporting everything your finance office needs in one step:

- An Excel spreadsheet with your Speedtype(s), the conference link, and one row per purchase: date, category, vendor and location, amount, currency, exchange rate, USD amount, and PDF page numbers, plus totals by category.
- One PDF with every receipt in date order, one image per page, numbered to match the spreadsheet rows.

The app runs entirely in your browser. Receipts, photos, and amounts are stored only on the device where you enter them. Nothing is uploaded to GitHub or to any other server.

---

## Contents

1. [Install on an iPhone](#1-install-on-an-iphone)
2. [Install on an Android phone](#2-install-on-an-android-phone)
3. [Use on a Mac or PC](#3-use-on-a-mac-or-pc)
4. [Basic use](#4-basic-use)
5. [Move a trip between devices](#5-move-a-trip-between-devices)
6. [Where your data is stored](#6-where-your-data-is-stored)
7. [App updates](#7-app-updates)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Install on an iPhone

1. Open the app's web address (the link you were given) in **Safari**.
2. Tap the **Share** button. In newer versions of iOS, you may need to tap the **...** button first, then **Share**.
3. Scroll down and tap **Add to Home Screen**. If you see an **Open as Web App** switch, leave it on.
4. Tap **Add**.

From now on, always open the app from its Home Screen icon. On iPhone, the Home Screen app keeps its own storage, separate from Safari tabs, and it is protected from Safari's automatic cleanup of website data. Entries made in a Safari tab will not appear in the Home Screen app, and the reverse.

---

## 2. Install on an Android phone

1. Open the app's web address (the link you were given) in **Chrome**.
2. Install it using either of these:
   - Tap **Install** on the banner at the top of the app's main screen, if it appears.
   - Or open Chrome's **three-dot menu** and tap **Add to home screen**, then **Install**.
3. The app appears on your home screen and in your app drawer, and opens in its own window without the browser address bar.

Samsung Internet and Firefox can also install the app from their menus.

On Android, the installed app and the same address opened in Chrome share the same data, so it does not matter which one you open.

---

## 3. Use on a Mac or PC

Open the app's web address in any current browser. To give it its own window and Dock or taskbar icon:

- **Safari on a Mac:** File menu, then **Add to Dock**.
- **Chrome or Edge:** click the install icon at the right end of the address bar, or use the browser menu and look for **Install page as app** (Chrome) or **Install this site as an app** (Edge).

A computer is the most comfortable place to review a trip and export the final files.

---

## 4. Basic use

After the first visit, the app works without an internet connection, so you can add receipts on a plane or abroad. Only the exchange-rate lookup needs a connection.

### Create a trip

Tap **New trip** and enter:

- The conference or trip name.
- The conference website. Finance offices usually ask for it, and it goes at the top of the spreadsheet.
- **Speedtype(s):** the 10-digit numbers for the grants to charge. If the trip is split across grants, type them all in this one field, separated by commas (for example `1234567890, 2345678901`). This is optional; if you leave it blank, the app asks again when you export.
- The first and last day, and the city.
- The usual currency for the trip. New receipts start in this currency, and you can change it on any receipt.

### Add a receipt

Open the trip and tap **Add receipt**.

1. Tap **Add photo or PDF** to take a photo, choose one from your photo library, or pick a PDF invoice from your files. You can add more than one image if a receipt is long.
2. Choose a category: Food, Hotel, Airfare, Transportation, Registration, or Other.
3. Enter the date, the vendor and location, and the amount.
4. Optionally add a card statement screenshot and notes.
5. Tap **Save**.

Photos and PDFs both show a preview. Tap one to view it full screen; a PDF opens with all of its pages, and you can save a copy from there.

Purchases missing a receipt image, an amount, or an exchange rate are flagged in the list so you can fix them before exporting.

### Scan a receipt

When you take or choose a receipt photo, the scanner opens:

1. **Crop:** the app outlines the receipt. Drag any corner to adjust it; a magnifier shows what is under your finger. **Find edges** tries again, **Whole photo** resets to the full image, and **Use photo as is** skips scanning.
2. **Preview:** the receipt is flattened as if photographed straight on. Choose **Clean** (removes shadows and makes the paper white), **Grayscale**, or **Original**, and rotate if needed.
3. Tap **Use scan** to attach it.

To keep a copy outside the app:

- **iPhone:** tap **Save to Photos**, then choose **Save Image** in the share sheet.
- **Android:** tap **Save image**. It is saved to your Downloads folder and appears in your gallery app.

Photos already attached to a receipt have an **Adjust** button for scanning them again. To stop the scanner from opening automatically, turn it off in **Settings** (the gear icon on the main screen).

Tips for better photos: photograph long receipts in two or three overlapping sections, and hold the phone higher using 2x zoom so your hand and the phone do not cast a shadow on the paper. A light receipt on a darker surface is outlined most reliably.

### Foreign currency

When a receipt is not in USD, the app looks up the exchange rate for that date automatically (from frankfurter.dev, which publishes European Central Bank reference rates). Receipts entered offline get their rate the next time you open the trip while online.

If you enter the **USD charged on your card**, the spreadsheet uses that amount instead of the exchange rate. Attaching the card statement screenshot places it in the PDF right after that receipt.

### Hotel stays

Choose the **Hotel** category and enter the check-in and check-out dates. The stay is listed on the **check-out date**, and the spreadsheet shows the dates and number of nights.

### Extra pages

From the trip's **...** menu, choose **Extra pages at the end of the PDF** to add documents that are not tied to a single purchase, such as a card statement covering several charges, a registration confirmation, or a travel approval.

### Export for reimbursement

1. Open the trip and tap **Export**.
2. If the trip has no Speedtype yet, enter it here (10-digit numbers, separated by commas). It is saved to the trip. You can also leave it blank; the Speedtype(s) line in the spreadsheet then stays empty.
3. Tap **Create spreadsheet and PDF**, then download or share each file.

Nothing is locked after exporting. If you find another receipt later, add it and export again; the new purchase lands in the right date position in both files.

### Edit or delete

Tap any purchase to change it, replace its image, or delete it. Trip details, including Speedtypes, can be edited from the trip's **...** menu with **Edit trip details**.

---

## 5. Move a trip between devices

There is no automatic syncing. Instead, you move a backup file between devices and merge it.

1. On the device with the latest changes, open the trip, tap **...**, then **Back up this trip**. To back up everything, use **Back up all trips** in Settings.
2. Send the file to the other device:
   - iPhone to Mac: tap **Share or AirDrop**, then choose AirDrop.
   - Android: tap **Download** to save it to your Downloads folder, then send it by email, Google Drive, or a USB cable.
3. On the other device, tap **Merge a backup** on the main screen (or in the trip's **...** menu) and choose the file.

Merging combines both sides. New purchases are added, the more recent edit wins if the same purchase was changed on both devices, and deletions carry over. Merging the same file twice is harmless, so you can move back and forth as often as you like.

---

## 6. Where your data is stored

- Data is stored in the browser's built-in database on each device. It is not uploaded anywhere.
- Each device, and each browser on a device, has its own separate copy.
- On iPhone, the Home Screen app and Safari tabs have separate storage.
- Clearing the browser's website data, or deleting the installed app, deletes your trips. There is no way to recover them without a backup file.
- Keep a backup of any trip you have not been reimbursed for yet.

The only outside request the app makes is the exchange-rate lookup, which sends a currency code and a date.

---

## 7. App updates

When a new version of the app is available, a banner appears at the top of the app saying "A new version of the app is ready." Tap **Update** to switch to it. Your trips and receipts are not affected. If you have not seen the banner in a while, close the app completely and reopen it. The current version is shown at the bottom of **Settings**.

---

## 8. Troubleshooting

**No exchange rate was found.** Enter the rate yourself, or enter the USD amount from your card statement.

**A Speedtype was not accepted.** Each Speedtype must be exactly 10 digits. Separate more than one with commas, not spaces.

**The scanner outlined the wrong area.** Drag the corners into place, or tap **Whole photo** and adjust from there.

**I can't see where I am typing on my phone.** Tap the field again; the form scrolls so the field sits above the keyboard.

**My trips disappeared.** The browser's website data was probably cleared, or you opened the app in a different browser or (on iPhone) in a Safari tab instead of the Home Screen app. Restore from a backup with **Merge a backup**.

---

Third-party libraries bundled with the app: [ExcelJS](https://github.com/exceljs/exceljs) (MIT license), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT license), and [PDF.js](https://github.com/mozilla/pdf.js) (Apache License 2.0). Their license files are in the `vendor` folder.
