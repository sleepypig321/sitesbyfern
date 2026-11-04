# Sites by Fern

Custom websites by Fern. Thoughtful design, flexible service options, and an easy project inquiry process.

Custom Cloudflare Workers website. Warm tan, sage and gold; responsive landing page, pricing and project inquiry slip. Business inbox: sitesbyfern@outlook.com.

## Current state

The source is prepared, not deployed. No inquiries or emails have been sent. The form deliberately returns an unavailable message until the database and email service are connected. No payment links are configured, and approval does not charge anyone. Final scope and terms must precede payment.

## Deploy in your new Cloudflare account

1. Create an empty GitHub repository named `sites-by-fern` on your existing account. Upload the contents of this folder, with `package.json` at the repository root.
2. Install dependencies with `npm install` and sign in to the correct Cloudflare account with `npx wrangler login`.
3. Run `npx wrangler d1 create sites-by-fern`. Copy its database ID into `wrangler.jsonc`, replacing the placeholder.
4. Run `npx wrangler d1 execute sites-by-fern --remote --file=schema.sql`.
5. Connect transactional email delivery. This implementation uses Brevo's API. Create/activate transactional sending and verify an allowed sender address. Set `SENDER_EMAIL` to the sender Brevo accepts; keep `OWNER_EMAIL` as your Outlook address. Public-provider sender rules and deliverability may require another provider or sender setup; do not assume domain-free sending is approved until tested.
6. Store the Brevo key using `npx wrangler secret put BREVO_API_KEY`. Never put the key in GitHub or browser code.
7. Run `npm test` and `npm run deploy`. The command returns the actual workers.dev URL.
8. In Cloudflare Workers & Pages, connect the GitHub repository for subsequent deployments using `npm run deploy` (no framework build required).

No domain purchase is needed for the workers.dev URL. A custom domain can be connected later.

## Review flow

Inquiries are stored in D1, then emailed to the owner. If delivery fails, the uncompleted inquiry is removed and the visitor sees an error. Owner emails include private, random approval/decline links, expiring in 30 days. Opening a link does not make a decision: a confirmation POST prevents mail scanners from approving requests. A decision sends the applicant an acceptance or decline email. Failed client emails can be retried from the same link. This is practical at small volume; delivery is not an exactly-once queue, and repeated simultaneous confirmations can produce duplicate emails. Do not share review links.

## Launch checks still required

- Confirm live mobile/desktop layout and all form validation.
- Test an actual inquiry, approval, decline, expired link, and email failure.
- Confirm sender delivery to both Outlook and a separate applicant address.
- Connect your own payment collection process before sending payment instructions. Nothing automatically charges or calculates the revenue share yet.
- Agree on written build scope, revision limits, maintenance boundaries, sales reporting, payment timing, cancellation, and handover terms with clients. Monthly maintenance is the greater of $30 or 7% of website sales, excluding sales tax and refunded orders; one hour of small updates included. Domains and payment processors are client-owned. Other costs are not silently included.
- Before promoting widely, add a verified spam challenge/rate limiter and an admin process for inquiry retention/deletion. Current protection includes a honeypot, same-origin submission, length limits, and a per-email cooldown; it is not strong abuse protection.

## Local commands

`npm run dev` starts Wrangler. Apply the schema locally with `npx wrangler d1 execute sites-by-fern --local --file=schema.sql`. Store local-only keys in `.dev.vars` (ignored by git).

## API references

- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.brevo.com/reference/send-transac-email
