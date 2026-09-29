# Personal Finance app

Personal Finance app is a responsive personal and family finance dashboard. This first frontend foundation uses React, TypeScript, Vite, Tailwind CSS, React Router, Lucide icons, and the official Cloudflare Vite plugin. Data is currently local mock data; there is no authentication, database, or API yet.

The original Figma exports remain in `code (12).txt` and `code (13).txt` as visual references.

## Development

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The dashboard is at `/` and the responsive transaction history is at `/transactions`.

## Build

```bash
npm run check
npm run build
```

## Cloudflare Workers

`wrangler.jsonc` configures Workers Static Assets with SPA fallback, so client-side routes such as `/transactions` continue to work when opened or refreshed directly.

When you are ready to deploy and have authenticated Wrangler:

```bash
npm run deploy
```

This runs the production build and `wrangler deploy`. You can also deploy the existing build directly with `npx wrangler deploy`. No D1 binding or secrets are configured.
