# finance-report — דוח פיננסי אישי

A local tool that collects your balances, holdings and transactions from Israeli banks, credit cards, brokers and pension funds into one place, and builds:

- **`data/report.html`** — a self-contained Hebrew report showing net worth, asset allocation, net-worth trend, monthly cash flow, spending by category, largest expenses, accounts and holdings. It works offline and in light or dark mode.
- **`data/finance-data.xlsx`** — all the numbers and transactions, ready for your own analysis.
- **`data/calculator-profile.xlsx`** — a profile you can import into **מחשבון העתיד הפיננסי** (`../index.html` → עוד ▾ → ייבוא). It is imported as a separate profile named "מהדוח הפיננסי".

Everything runs **on your own computer**. Passwords are stored encrypted (AES-256-GCM, key derived from your master password with scrypt) and nothing is sent anywhere except to the banks and brokers themselves (plus the Bank of Israel exchange-rate API).

## Supported sources

| `type` | What | How |
|---|---|---|
| `israeli-bank` | Banks: hapoalim, leumi, discount, mizrahi, mercantile, otsarHahayal, beinleumi, massad, yahav, union, oneZero, pagi · Cards: max, visaCal, isracard, amex, behatsdaa, beyahadBishvilha | Logs in with your credentials via the open-source [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers), using a headless Chrome |
| `ibkr-flex` | Interactive Brokers | Official Flex Web Service (read-only token) |
| `holdings-file` | IBI, Meitav, Excellence, Altshuler, bank trading accounts, any broker | Import a portfolio export (.csv / .xlsx). Columns are detected automatically (שם נייר / כמות / שער / שווי, or Name / Quantity / Price / Value) |
| `pension-file` | Pension, gemel, hishtalmut, managers' insurance | Import a Pension Clearinghouse (מסלקה פנסיונית) file: Excel/CSV, or the XML "ממשק אחיד" file |
| `manual` | Apartment, car, mortgage, loans | Values you set in the config |

## Setup

Requires Node.js 22 or newer.

```bash
cd finance-report
npm install                       # also downloads Chromium for the bank logins
node bin/finreport.js demo        # sample data → data-demo/report.html (try this first)
node bin/finreport.js init        # creates config.json
```

Edit `config.json`. Keep only the sources you use (see `config.example.json`). Then save credentials for each bank or card. You'll choose a master password the first time:

```bash
node bin/finreport.js creds set hapoalim
node bin/finreport.js creds set max
```

The fields requested are the ones the bank's own website uses (e.g. Hapoalim: `userCode`, `password`; Isracard: `id`, `card6Digits`, `password`; Discount: `id`, `password`, `num`).

### Interactive Brokers (one-time setup)

1. In the IBKR Client Portal, go to **Performance & Reports → Flex Queries**. Create an **Activity Flex Query** with the sections **Open Positions**, **Cash Report** and **Account Information**. Set the format to **XML** and the period to **Last Business Day**. Note its **Query ID**.
2. On the same page, under **Flex Web Service Configuration**, enable it and generate a **token**.
3. Put the Query ID in `config.json` (`"queryId"`), then run `node bin/finreport.js creds set ibkr` and paste the token.

### Israeli brokers & pension

- **Brokers:** in the broker's website, export your portfolio (תיק / אחזקות) to Excel or CSV, then run:
  `node bin/finreport.js import meitav ~/Downloads/portfolio.xlsx`
  If your broker quotes TASE prices in agorot and the file has no value (שווי) column, set `"priceInAgorot": true` for that source.
- **Pension:** download your report from the Pension Clearinghouse (המסלקה הפנסיונית), then run:
  `node bin/finreport.js import mislaka ~/Downloads/mislaka.xml`
  The Excel/CSV route is the most tolerant. The XML parser reads each account's `TOTAL-CHISACHON-MTZTBR` and **hasn't been tested against a real Clearinghouse file yet**. If it finds nothing, use the Excel export, or open an issue with an anonymized sample.
- Old `.xls` files: open them and save as `.xlsx` or `.csv` first.

## Monthly use

```bash
node bin/finreport.js fetch            # all banks/cards/IBKR → updates report
node bin/finreport.js fetch max        # just one source
node bin/finreport.js fetch --show-browser   # watch the login (useful when a bank asks for 2FA)
node bin/finreport.js report           # rebuild the report without fetching
```

Run `fetch` regularly, ideally at least monthly. Each run stores a dated snapshot, so the net-worth trend builds up over time. For bank accounts, earlier months are estimated backwards from the transaction history, so you get a trend on day one. Those points show as a dashed line.

Set `FINREPORT_PASSWORD` to avoid typing the master password, e.g. for a scheduled job. Only do this on a machine you trust.

## How the numbers are computed

- **Currencies:** everything is converted to ₪ using Bank of Israel representative rates, with `fxRates` in the config as a fallback.
- **Credit cards:** each purchase counts as an expense in the month it's charged. Installments are split across months. Purchases not yet charged appear as a liability (חיובים עתידיים).
- **No double counting:** the bank's monthly lump payment to a card company (ישראכרט, מקס, כאל…), transfers between your own accounts, and deposits to investments are excluded from expenses. The card lump is excluded only when that card is connected; otherwise it counts as an expense category "כרטיס אשראי (לא מפורט)".
- **Categories:** keyword rules for common Israeli merchants (`src/categorize.js`). Add your own under `"categories"` in the config; they're checked first.
- **Calculator export:** assets are grouped by asset type, using the calculator's default expected returns. Income and expenses are the 3-month averages. Loan payments are subtracted from expenses because the calculator adds them automatically.

## Privacy & security

- `config.json`, `data/` and `*.enc` are in `.gitignore`. **Never commit them**, and remember that this repo is published to GitHub Pages.
- Credentials are only decrypted in memory during `fetch`. Data files are written with owner-only permissions.
- Bank scraping logs in as you. Prefer a read-only or "view only" user where your bank offers one, and expect an occasional SMS/2FA prompt (`--show-browser`).
- The report is not investment advice.

## Development

```bash
npm test        # node:test, no network needed
```

Layout: `src/connectors` (bank scraper, IBKR), `src/importers` (CSV/XLSX/XML), `src/store.js` (local JSON store), `src/analyze.js` (all calculations), `src/report.js` (HTML), `src/export.js` (Excel), `bin/finreport.js` (CLI).
