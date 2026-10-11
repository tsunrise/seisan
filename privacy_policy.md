# Seisan Privacy Policy

**Last updated:** October 7, 2026

Seisan is a small open-source service for splitting shared expenses. It is run by one person, operating as tsunrise, in the United States. This page explains what information Seisan handles, why, and who can see it.

Questions or requests: [me@tomshen.io](mailto:me@tomshen.io).

## 1. At a glance

- **The calculator stays in your browser.** What you type into the calculator on the home page is saved only in your browser and is never sent to Seisan's servers.
- **Shared projects are stored online.** Project names, members, payment instructions, and expense records are stored on Cloudflare so everyone in the project can see them.
- **Public project links are not private.** Anyone with the link to a public project can see its records, member names, and the owner's email. Signed-in visitors can also see member emails and payment instructions.
- **No ads, no analytics, no selling data.** Seisan does not sell personal information, show ads, or use analytics trackers. Cloudflare hosts and protects the service.

## 2. What Seisan collects

**Calculator.** Names, amounts, and split settings you enter in the public calculator are kept in your browser's local storage until you clear them. Seisan does not receive them.

**Account.** Your email address, used to send login codes and to identify you. Seisan stores hashed login codes, session information, and, if you create API keys, each key's label, dates, and a hash of the key. The full API key is shown only once.

**Projects.** Whatever you and other members put into a shared project: project and member names, linked emails, allowed emails, payment instructions, how many people a member represents, and expense, transfer, and promise records with their amounts and descriptions. Please don't put sensitive information, such as bank logins or ID numbers, into free-text fields.

**Category suggestions.** When a signed-in user types an expense name in the Seisan website, it is sent to Cloudflare Workers AI to suggest a category. Suggestions are only available in a browser that has passed Cloudflare's bot checks, not through the API. The suggestion can always be changed, and only the category you post is saved.

**Technical data.** Like any website, Seisan and Cloudflare process IP addresses, browser details, and request logs to run the service, stop abuse, and fix errors. To limit how often category suggestions can be requested, Seisan counts requests per account and per hashed IP address.

**Bot detection.** On every page, Cloudflare runs a bot-detection script that looks at how the page is used, such as pointer movement, scrolling, focus, how long the page is visible, and the timing of keystrokes, to tell people apart from automated traffic. It records keystroke timing, not which keys you press, and Seisan does not receive these signals. The login page also uses Cloudflare Turnstile to check for bots, and login emails are checked by looking up the email's domain with Cloudflare DNS.

## 3. How information is used

Seisan uses this information only to run the features you use: signing in, sharing projects, calculating balances and settlement plans, suggesting categories, and keeping the service secure and working. Where EU or UK law applies, the legal basis is providing the service you asked for and Seisan's legitimate interest in running it securely.

## 4. Who can see your information

**Public projects:** anyone with the link can see the project name, owner email, member names, records, amounts, and balances. Signed-in visitors can also see member emails and member details such as payment instructions. Treat a public project link as public.

**Restricted projects:** only the owner, linked members, and emails the owner allows.

**Other people in a project** can copy or share what they see. Seisan cannot control those copies.

**Service providers:** Cloudflare hosts, stores, and protects Seisan, sends login emails, and runs bot detection, Turnstile, and Workers AI. See [Cloudflare's Privacy Policy](https://www.cloudflare.com/privacypolicy/) and the [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/). Your email provider receives your login codes.

**The operator** may look at account and project data when needed to run, secure, or debug the service, or to answer your request. Seisan will also disclose information if required by law.

## 5. Cookies and browser storage

- A sign-in cookie (`__Host-seisan_session`) keeps you logged in for up to 30 days.
- Cloudflare sets a `cf_clearance` security cookie that records whether your browser session has passed its bot checks. Cloudflare Turnstile may also use security cookies on the login page.
- The calculator saves its draft in `localStorage`; the project timeline briefly saves your scroll position in `sessionStorage`.

There are no advertising or analytics cookies.

## 6. How long information is kept

- Login codes expire after 10 minutes. Sign-in sessions last up to 30 days.
- API keys stop working when they expire or are revoked.
- Rate-limit counters used to stop abuse reset within a minute.
- Project data has no automatic expiry, so the shared history stays complete. Deleting a record removes its content and balance effect but keeps a placeholder in the history.
- Calculator drafts stay in your browser until you clear them.

## 7. Your choices and requests

You can edit or delete records in projects you belong to, leave a project, and clear calculator data at any time. To ask for a copy of your information, a correction, or deletion, email [me@tomshen.io](mailto:me@tomshen.io). Seisan is a one-person project, so responses may take some time, and information that other members rely on, such as shared expense history, may not always be removable. If you are in the EU or UK, you can also complain to your local data-protection authority.

## 8. Security and data location

Seisan uses reasonable safeguards such as hashed codes and keys, secure cookies, access checks, and rate limits, but no service is perfectly secure. Seisan is provided as-is. Cloudflare runs a global network, so your information may be processed outside your country, including in the United States.

## 9. Children

Seisan is not meant for children under 13 and does not knowingly collect their information. If you think a child has used Seisan, email [me@tomshen.io](mailto:me@tomshen.io).

## 10. Changes

If this policy changes, the new version will be posted here with a new "Last updated" date.
