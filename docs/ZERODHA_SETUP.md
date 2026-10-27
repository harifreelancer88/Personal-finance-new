# Zerodha holdings sync

This feature is disabled until configured. It only reads the Zerodha portfolio endpoint; it does not submit trades or create cash transactions. Authentication uses the existing owner recovery key, held only in the panel's React state. Locking or leaving the page clears that key.

## Deployment order

1. Apply `migrations/0014_zerodha_sync.sql` to D1 **before deploying** the branch. In the D1 web console execute each complete CREATE TABLE or CREATE TRIGGER statement separately; do not split trigger bodies at their inner semicolons. This adds operational tables/triggers only, without modifying existing holdings.
2. Create a **Personal (free)** app at https://developers.kite.trade/. Set the redirect URL to `https://personal-finance-new.haribhaskarann.workers.dev/api/zerodha/callback` (or your actual production origin with the same path).
3. Set Cloudflare Worker secrets:
   - `KITE_API_KEY`: the developer app's API key.
   - `KITE_API_SECRET`: its API secret.
   - `KITE_CLIENT_ID`: the exact Zerodha user/client ID allowed to connect.
   - `KITE_TOKEN_ENCRYPTION_KEY`: base64 encoding of 32 random bytes, generated locally with `openssl rand -base64 32`. Keep this key separate from the API secret and recovery key.
   - Keep the existing `RECOVERY_TOKEN` configured.
4. Deploy the app. Never put secrets in repository files or Vite/frontend environment variables.
5. Investments → Zerodha portfolio sync → enter owner recovery key → Unlock → Connect. Sign in only on Zerodha's official page. After the callback confirms connection, return to Investments and unlock again.
6. Review latest holdings → map each security to an existing equity holding, create a new one, or skip → Apply selected holdings. Subsequent previews preselect linked holdings but still require Apply.

## Behavior and limits

- Standard sessions expire at 6 AM IST the next day; no password/TOTP automation or permanent background connection. Reconnect as needed. Disconnect clears local broker credentials and pending reviews; it does not log out other Kite sessions.
- Each preview lasts ten minutes and is applied atomically once. A later review invalidates the earlier review. A changed holding, duplicate mapping, foreign workspace, or outstanding investment payment blocks the update.
- Missing holdings are never deleted. Zero, unsettled, sold, pledged, MTF, duplicate-ISIN and broker-discrepancy holdings need manual statement reconciliation.
- Free API market-price availability must be verified with the live account. Missing/zero prices are explicitly blocked; existing values are not set to zero. Portfolio price timestamps are not supplied, so the review and snapshot identify the fetch time, not a guaranteed exchange valuation time. The valuation date is the IST observation date.
- Broker average cost is labelled `recorded`, not verified actual lifetime cost or a tax calculation. Complete transaction histories still require statements.
- New connections are owner-authorized, with a short-lived HttpOnly browser state cookie and one-use server nonce. Tokens are AES-GCM encrypted at rest; no token is returned to the frontend.
- Operational tables `kite_sessions`, `kite_auth`, `kite_previews` are deliberately excluded from backup exports. Financial snapshots and mapping markers in investment notes use existing backed-up tables. Restore invalidates connections/previews; reconnect after restoring. Existing v12/v13 backups remain supported.
- No AI requests or new npm dependencies are used.

## Validation

`bash scripts/test-zerodha.sh`, `npm run test:workflows`, `npm run build`.
Tests use synthetic broker responses and SQLite, including the successful login/callback/preview path. Live broker authentication, free-plan price fields and rendered browser interaction require a configured deployment and have not been verified in this development environment.
