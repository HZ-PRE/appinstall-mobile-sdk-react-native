# Development

Use Node >= 22, npm >= 10 and the lockfile. Run `npm ci --ignore-scripts --legacy-peer-deps`,
`npm run build`, and `npm test`. Use `node scripts/verify.mjs` for the full isolated
Go/PostgreSQL/Redis and Android native validation documented in README.md.

Preserve the current v2 protocol, scoped persisted instance IDs, source-state
reporting and immutable-final semantics. Do not add client-side matching or keys.
Never log credentials, raw clipboard, transport bodies or host configuration.
Add regression tests for lifecycle races and persistence failures when changing
the installation controller. Keep native source licenses intact.

This fork is distributed locally. Publishing is a separate explicit action.
