# PerkFit

Next.js (App Router, TypeScript, Tailwind) app that ranks partner perks by taste fit using the Qloo API and picks a bundle under a budget. Uses the Vercel AI SDK with Anthropic models for explanation sentences. Node 24, npm.

## Commands

```bash
npm run dev                    # sample mode if no keys are set
npm test                       # all tests; single file: npx vitest run tests/<area>/<file>.test.ts
npm run lint && npm run typecheck
npm run build && npm run check:bundle
npm run check:repo             # repository hygiene (also run by hooks and CI)
npm run check                  # everything above
```

## Layout

- `src/lib/qloo`, `src/lib/engine`, `src/lib/ledger`, `src/lib/ops` hold the server logic. `src/app` holds pages and route handlers.
- `tests/` mirrors the areas. Fixtures live in `tests/fixtures/synthetic/` and must be invented.

## Security rules

- Keys are read from the environment on the server only. Never print, log, commit or ship them to the browser. No `NEXT_PUBLIC_` variables.
- Server modules start with `import 'server-only'`.
- Never store real Qloo responses or entity ids in the repository. Synthetic fixtures use ids that start with `00000000-0000-4000-8000-` and carry `"_synthetic": true` at the top level.
- Do not add files under `probe-raw/`, `.private/`, `secrets/` or any precache data file.
- Errors returned to clients carry a code and a short message, never stack traces or upstream response bodies.
- Estimates are about audience segments only. Do not write copy that predicts behaviour or judges finances.
- Hooks in `.githooks` run a secret scan and `check-repo`. Do not bypass them.

## Conventions

- English only in code, comments and UI text.
- Prefer integration-style tests over mocks. The Qloo client is tested against a fake HTTP server.
