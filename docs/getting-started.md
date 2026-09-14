# Getting Started

[← Back to README](../README.md)

For the app's developer/deployer, done once. End users configure nothing — they sign in and pick or create their own spreadsheet.

## 1. Create the template Google Sheet

- Create a spreadsheet with the tabs in [Data Model](data-model.md).
- Pre-populate a little sample data so charts aren't empty on a first run.
- Share it as **Anyone with the link can view** — it must be link-viewable and contain no real personal data.

## 2. Create a Google Cloud project and credentials

1. Enable the **Sheets API**, **Drive API** and **Picker API**.
2. Create an **OAuth 2.0 Client ID** (Web application); add your origins (e.g. `https://<user>.github.io`, `http://localhost:8000`).
3. Create an **API key**, restricted to the Picker API and the same origins.

## 3. Configure the app

Edit `assets/script/config.js`:

```js
const CONFIG = {
  CLIENT_ID: '<your-client-id>.apps.googleusercontent.com',
  TEMPLATE_SPREADSHEET_ID: '<your-template-spreadsheet-id>',
  PICKER_API_KEY: '<your-picker-api-key>',
  SHEETS: {
    TRANSACTIONS: 'Transactions',
    REPORT: 'Statement',
    BALANCE: 'Accounts',
    ACCOUNTS: 'Accounts',
    INSIGHT: 'Insight',
    TIMESHEET: 'eTimeSheet',
    NUTRITION: 'Nutrition',
    CONTACTS: 'Contacts',
    SETTINGS: 'Settings',
    TRAVEL: 'Travel',
    APPLICATIONS: 'Applications',
  },
};
```

- None of these are secrets — see [Security & Privacy](security.md).
- `drive.file` is an unverified-app-friendly scope, so no sensitive-scope OAuth review is needed.

## 4. Run locally

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. No build step.

---

