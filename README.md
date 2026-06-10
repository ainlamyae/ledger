# ledger

A lightweight, serverless personal accounting application built with GitHub Pages and Google Sheets.

Track income, expenses, account balances, and financial trends while keeping all data in your own Google account.

## Features

### Transaction Management

* Record income and expenses
* Edit existing transactions
* Delete transactions
* Categorize transactions
* Search and filter transaction history

### Account Management

* Multiple bank accounts
* Credit cards
* Cash accounts
* Investment accounts
* Automatic balance calculations

### Dashboard

* Net worth overview
* Current account balances
* Monthly income
* Monthly expenses
* Savings rate

### Reports & Analytics

* Income vs expense trends
* Expense breakdown by category
* Monthly summaries
* Account balance history

### Security

* Google OAuth authentication
* Data stored in Google Sheets
* No password storage
* No custom backend server

---

## Architecture

```text
+---------------------+
|    GitHub Pages     |
|   Static Website    |
+----------+----------+
           |
           | Google APIs
           |
+----------v----------+
|    Google Sheets    |
|      Database       |
+----------+----------+
           |
           |
+----------v----------+
|   Google Account    |
| Authentication/OAuth|
+---------------------+
```

---

## Technology Stack

### Frontend

* HTML5
* CSS3
* JavaScript (ES6+)

### Storage

* Google Sheets

### Authentication

* Google OAuth 2.0

### Hosting

* GitHub Pages

### Visualization

* Chart.js

---

## Project Structure

```text
personal-accounting/
│
├── index.html
├── styles.css
├── app.js
├── auth.js
├── sheets.js
├── charts.js
├── config.js
├── assets/
│   └── icons/
└── README.md
```

---

## Deployment

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Select:

   * Source: Deploy from a branch
   * Branch: `main`
   * Folder: `/ (root)`
4. Save.

Your site will be available at:

```text
https://yourusername.github.io/personal-accounting
```

---

## Roadmap

### MVP

* [ ] Google OAuth login
* [ ] Add income
* [ ] Add expense
* [ ] Transaction list
* [ ] Google Sheets integration

### Version 1.0

* [ ] Dashboard
* [ ] Account management
* [ ] Charts and reports
* [ ] Monthly summaries

### Version 2.0

* [ ] Budget tracking
* [ ] Recurring transactions
* [ ] CSV import/export

### Version 3.0

* [ ] Investment tracking
* [ ] Asset management
* [ ] AI-generated insights
* [ ] Financial forecasting

---

## License

No license

MIT License
