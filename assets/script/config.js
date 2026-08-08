const CONFIG = {
  CLIENT_ID: '595319886726-ru931qdehli1ki94lrqshdi3o9art3qo.apps.googleusercontent.com',
  // Master template every new user's personal copy is cloned from (Drive
  // file ID). Shared as "Anyone with the link can view" — not a secret.
  TEMPLATE_SPREADSHEET_ID: '1PW5VxnnyXekvudOam9bXv7onFhThC273',
  // Google Cloud "API key" credential (Cloud Console > Credentials), needed
  // to initialize the Picker API. Not the same as CLIENT_ID. Not a secret —
  // restrict it to the Picker API and your origins in the Cloud Console.
  PICKER_API_KEY: 'AIzaSyAS2ru2zPxVdr-dfM-5c5YkyYeMLsioA1c',
  SHEETS: {
    TRANSACTIONS: 'Transactions',
    REPORT: 'Monthly Summary',
    BALANCE: 'Accounts',
    ACCOUNTS: 'Accounts',
    INSIGHT: 'Insight',
    TIMESHEET: 'eTimeSheet',
    PHYSIQUE: 'Physique',
    ACTIVITIES: 'Activities',
    NUTRITION: 'Nutrition Facts',
    CONTACTS: 'Contacts',
    SETTINGS: 'Settings',
    TRAVEL: 'Travel',
    APPLICATIONS: 'Applications',
  },
};
