# PerkFit

PerkFit helps perk programs, such as new fintech cards and membership apps with little purchase history, choose which partner perks to offer inside a fixed budget. It ranks candidate perks by how well each fits the taste of an audience segment, using Qloo taste data, and then picks the best bundle with a transparent calculation. Built for the Qloo Agentic Hackathon.

Live demo: TODO (production URL)

## Problem

TODO: two short paragraphs. Perk programs with thin transaction history cannot learn which perks their audience likes, and a perk budget is spent on guesses. State who picks perks today and what a wrong pick costs. Keep claims about audience segments only.

## What Qloo does here

TODO: describe the Qloo calls in plain words (one insights request per category, with audience interests and age band as signals), what comes back (taste affinity per candidate), and why it replaces a popularity ranking. Counts to fill from a real run: TODO qloo calls per run, TODO categories, TODO candidates.

## Architecture

1. Audience segment (interest chips and age band) enters the browser and goes to the server.
2. The server asks Qloo for taste affinity of the fixed candidate perks, one request per category.
3. Scores become within-category percentiles and three tiers: taste fit high, mid, low.
4. A budget calculation picks the best bundle under three usage scenarios. Usage shares are labelled assumptions.
5. An agent loop (Vercel AI SDK) calls tools and writes explanation sentences from templates. A validator checks every sentence against the evidence ledger and drops what it cannot support.

## Request-to-result (redacted)

TODO: one run shown with invented values only: input, list of Qloo calls, ledger rows, headline. Do not quote real Qloo responses.

## Provenance and limits

- Every number on screen carries a badge: QLOO, CALC, ASSUMPTION or SAMPLE.
- Estimates describe audience segments only. They say nothing about single users and are not a financial assessment.
- Taste fit is not a forecast of behaviour. Usage shares and unit costs are assumptions you can edit.
- Not validated: TODO list (for example, no field test of the perks).

## Run locally

```bash
npm ci
cp .env.example .env.local   # optional; without keys the app starts in sample mode
npm run dev
```

Sample mode uses invented numbers and shows a banner saying so. Add `QLOO_API_KEY` to `.env.local` for live data.

## Operations

- `PERKFIT_MODE=sample` forces sample data. Remove it to return to live data. Redeploy after changing it.
- Daily limits per UTC day: TODO 400 Qloo calls, 200 explanation runs, 10 live runs and 20 searches per client address. Counters live in Upstash Redis. Without it, only the example segments run.
- Example segments are served from a server-side cache and make no Qloo or LLM calls.

## Tests

```bash
npm test              # all tests, no network
npm run check         # lint, typecheck, tests, build, bundle and repository checks
```

Tests use a fake Qloo server and hand-written synthetic fixtures. No real Qloo response is stored in this repository.

## AI assistance

TODO: final wording, identical to the Devpost entry.

## License

MIT, see [LICENSE](LICENSE).
