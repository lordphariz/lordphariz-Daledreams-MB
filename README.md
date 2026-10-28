# Daledreams Record Book

A mobile-friendly customer measurement and bookkeeping app. It runs locally on your computer with a SQLite database stored in this project folder.

## Run it

1. Install [Node.js 22.13 or newer](https://nodejs.org/) if it is not already installed.
2. Open this project in VS Code.
3. Open **Terminal > New Terminal** and run:

   ```sh
   npm start
   ```

4. Open **http://localhost:3000** in your browser.

The first start automatically creates `data/daledreams.sqlite` and its tables. Keep the terminal running while you use the app. Stop the server with `Ctrl+C`; run `npm start` again to continue later. Your data stays in the SQLite file in this project and survives restarts.

## Database

The database is local to this computer and is not uploaded or synchronized. The SQLite schema is in [`database/schema.sql`](./database/schema.sql); the app creates the database and applies the schema automatically when the server starts. Database files are excluded from Git so private customer details are not committed.

## Scanning and backups

When adding or editing a customer, use **Scan paper** to read a clear photo of printed measurement notes. OCR runs in your browser and the photo is not uploaded. The English recognition model is downloaded the first time you scan, so an internet connection is needed for that first scan. Handwriting may not be recognized accurately; review all filled-in measurements before saving.

Use **Download backup** on the dashboard to save a JSON copy of customer and transaction records. Keep backup files in a private location; they contain customer information.

## Check the app

```sh
npm test
```
