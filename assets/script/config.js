const CONFIG = {
  CLIENT_ID: '595319886726-ru931qdehli1ki94lrqshdi3o9art3qo.apps.googleusercontent.com',
  // Master template every new user's personal copy is cloned from (Drive
  // file ID). Shared as "Anyone with the link can view" — not a secret.
  TEMPLATE_SPREADSHEET_ID: '1PW5VxnnyXekvudOam9bXv7onFhThC273',
  // Google Cloud "API key" credential (Cloud Console > Credentials), needed
  // to initialize the Picker API. Not the same as CLIENT_ID. Not a secret —
  // restrict it to the Picker API and your origins in the Cloud Console.
  PICKER_API_KEY: 'AIzaSyAS2ru2zPxVdr-dfM-5c5YkyYeMLsioA1c',
  // EVERY sheet tab name the app reads or writes, and the only place any of them
  // is spelled out — every range in every module is built from these, so renaming
  // a tab in the spreadsheet is a one-line change here and nothing else.
  // (User-facing labels that have to agree with a tab name, like the breakdown
  // table's "came from your own table" source, are read off these too.)
  SHEETS: {
    TRANSACTIONS: 'Transaction',
    REPORT: 'Statement',
    BALANCE: 'Account',
    ACCOUNTS: 'Account',
    INSIGHT: 'Breakdown',
    TIMESHEET: 'eTimeSheet',
    PHYSIQUE: 'Physique',
    ACTIVITIES: 'Activity',
    NUTRITION: 'Nutrition',
    CONTACTS: 'Contact',
    SETTINGS: 'Setting',
    TRAVEL: 'Travel',
    APPLICATIONS: 'Application',
  },
};
