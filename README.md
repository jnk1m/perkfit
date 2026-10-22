# PerkFit

PerkFit helps perk programs, such as new fintech cards and membership apps with little purchase history, choose which partner perks to offer inside a fixed budget. It ranks candidate perks by how well each fits the taste of an audience segment, using Qloo taste data, and then picks the best bundle with a transparent calculation. Built for the Qloo Agentic Hackathon.

Live demo: TODO (production URL)

## Problem

A new fintech card or membership app has a perk budget before it has purchase history. Someone on the partnerships team picks which restaurants, streaming titles, brands and books to subsidise, usually by what is popular or by what a partner offers first. With a few months of thin data there is no way to tell whether the audience actually cares about those perks.

A wrong pick is expensive in a quiet way: the money goes out every month to a perk that most members never redeem, and the slot it occupies is not available for one they would. PerkFit asks a different question about the audience as a group: given who these members are, which candidate perks fit their taste, and what is the best bundle inside the budget? It makes no claim about any single member.

## What Qloo does here

The audience segment is a short list of interests (for example a TV show, a musician and a brand) plus an age band. For each perk category the server sends one Qloo Insights request with those interests as signals and the fixed list of candidate perks in that category as the entities to score. A run with four categories (places, TV shows, brands, books) and 20 candidate perks makes four Qloo calls.

Qloo answers with a taste affinity for each candidate, its general popularity, and an explainability breakdown of how much each interest contributed. PerkFit keeps all three: affinity drives the ranking, popularity is shown next to it so the gap is visible, and the per-interest contributions appear in the evidence rows.

Popularity alone would rank the same way for every audience. Taste affinity moves with the segment: in the bundled examples, switching from one segment to the other changes two of the five perks, and choosing by popularity instead of taste changes four of them. That difference is the whole point of the tool.

## Architecture

1. Audience segment (interest chips and age band) enters the browser and goes to the server.
2. The server asks Qloo for taste affinity of the fixed candidate perks, one request per category.
3. Scores become within-category percentiles and three tiers: taste fit high, mid, low.
4. A budget calculation picks the best bundle under three usage scenarios. Usage shares are labelled assumptions.
5. An agent loop (Vercel AI SDK) calls tools and writes explanation sentences from templates. A validator checks every sentence against the evidence ledger and drops what it cannot support.

## Request-to-result (redacted)

Every value below is invented to show the shape of a run. Real Qloo responses are not reproduced here.

1. Input: segment "late 20s, likes show A, musician B, brand C", budget $75,000 per month, 10,000 members, 20 candidate perks with illustrative unit costs.
2. Qloo calls: four Insights requests, one per category, each carrying the three interest signals, the age band and that category's five candidates. Each answer lists the candidates Qloo could score with an affinity and a popularity value.
3. Ledger rows for one perk: `qloo.affinity` 0.61, `qloo.popularity` 0.93, `qloo.explain.<interest>` 0.30, `calc.percentile` 70% (rank 2 of 5 in its category), `calc.tier` high, `assumption.usage` 45%, `assumption.unit_cost` $4, `calc.monthly_cost` $18,000. Each row carries the ids it was derived from.
4. Bundle: a 0/1 knapsack over quantised monthly costs picks the perks with the highest taste-weighted value inside the budget, once per usage scenario (pessimistic, base, optimistic).
5. Headline: `Fund these 5 perks for $73,500 of $75,000/month. Picking by popularity would swap 4 of them and put about $4,000 into perks with low taste fit for this segment.` The three-line summary above it is filled by code from the same rows, and the AI sentence under each perk is a template that the validator checked against those rows.

## Provenance and limits

- Every number on screen carries a badge: QLOO, CALC, ASSUMPTION or SAMPLE.
- Estimates describe audience segments only. They say nothing about single users and are not a financial assessment.
- Taste fit is not a forecast of behaviour. Usage shares and unit costs are assumptions you can edit.
- Not validated: no field test of any perk, no usage or revenue data behind the cost figures, no discount terms or partner pricing. The holdout plan on screen is how a team would start validating; this project does not run it.

## Run locally

```bash
npm ci
cp .env.example .env.local   # optional; without keys the app starts in sample mode
npm run dev
```

Sample mode uses invented numbers and shows a banner saying so. Add `QLOO_API_KEY` to `.env.local` for live data.

## Operations

- `PERKFIT_MODE=sample` forces sample data. Remove it to return to live data. Redeploy after changing it.
- Daily limits per UTC day: 400 Qloo calls and 200 explanation runs in total, 10 live runs and 20 searches per client address. Counters live in Upstash Redis. Without it, only the example segments run.
- Example segments are served from a server-side cache and make no Qloo or LLM calls.

## Tests

```bash
npm test              # all tests, no network
npm run check         # lint, typecheck, tests, build, bundle and repository checks
```

Tests use a fake Qloo server and hand-written synthetic fixtures. No real Qloo response is stored in this repository.

## AI assistance

Draft, to be made identical to the Devpost entry before submission.

The idea, the product frame, the safety rules and every design decision are the author's. Claude (Anthropic) was used as a coding assistant throughout: it drafted the detailed design from the author's plan, wrote most of the implementation and tests under the author's review, and ran structured reviews of the result screen. The author reviewed and approved each stage, tested the application end to end, and is responsible for the submission. At run time the application calls Claude Opus 5.5 for the agent loop and the explanation templates; every sentence it writes is checked by code against the evidence ledger before it is shown.

## License

MIT, see [LICENSE](LICENSE).
