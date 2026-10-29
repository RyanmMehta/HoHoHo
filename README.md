# HoHoHo

A Christmas site with an animated present, reindeer menu, November/December 2026 availability, and a host-only dashboard.

- Website: https://hohoho-ryan.rm6886.workers.dev
- Host dashboard: https://hohoho-ryan.rm6886.workers.dev/admin
- Hosting: Cloudflare Workers + Static Assets
- Database: Cloudflare D1 (`hohoho-responses`)

## Development

Requires Node.js 22 or newer.

```sh
npm ci
node scripts/set-local-password.mjs
npm run db:local
npm run dev
```

Local development uses a separate local database. Public static output contains only `index.html`, `admin.html`, and `admin.js`. Never serve the repository root with a static server: it contains server configuration and ignored local secrets.

## Deploy

```sh
npm run build
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

The configured Cloudflare account and database are HoHoHo's production target. Existing deployed secrets are retained. To change the admin password, run the local password setup script, then `npx wrangler deploy --secrets-file .dev.vars`. The ignored file stores a salted PBKDF2 hash, never the plaintext password. Existing sessions expire after eight hours; explicitly revoke them in the sessions table if a credential is compromised.

## Privacy and access

- Guest names and dates are saved only when Submit availability succeeds. Local drafts remain on the visitor's device.
- A random HttpOnly guest cookie allows updates from the same browser; names do not authenticate anyone. Shared browsers share one response, and a different browser may create a duplicate.
- The response-reading API requires an unexpired server session. Login is separate from the guest name field.
- Admin password hashes stay in Cloudflare secrets, not in public files or Git.
- Sessions use HttpOnly, Secure (HTTPS), SameSite=Strict cookies. Logout revokes the server session.
- Writes require same-origin JSON requests, bounded bodies, parameterized SQL, and validated dates.
- Login is limited to five attempts per IP per hour and fifteen total per hour. This can temporarily lock out the host during abuse; a longer password remains strongly recommended.
- Responses are not emailed. Open the dashboard and refresh to see new responses and date rankings.

## Verification

`npm test` uses an isolated Workers runtime and D1 database to test validation, unauthorized access, forged sessions, response isolation, cross-origin rejection, login/logout, rate limiting, and oversized bodies. No tests use production guest records.
