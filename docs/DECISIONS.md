# Design decisions

Short record of the choices that shape PerkFit. Numbers marked TODO are filled from real runs before submission.

## Scoring

1. Scores use only interest entities and an age band as Qloo signals. A location signal was tested and dropped because it silently removes candidates from results.
2. Each candidate gets a within-category percentile, cut at one third and two thirds into taste fit low, mid and high. Raw affinity is never compared across segments or categories.
3. The bundle is chosen by a 0/1 knapsack on a ten dollar grid, once per usage scenario (optimistic, base, pessimistic).
4. The headline counts low-fit candidates left out of the best bundle. It does not depend on any popularity ranking.
5. The popularity comparison is labelled "Same assumptions, popularity order". It is not presented as a no-Qloo baseline.

## Language model

6. The model never writes numbers or names. It fills sentence templates with slot ids, and a validator checks each sentence against the evidence ledger. Sentences that fail are dropped and the drop rate is shown.
7. The agent loop (Vercel AI SDK, step limit 16) lets the model choose among retrying an unresolved candidate, asking the user to disambiguate a chip, and choosing which facts to cite. Budget, percentile and knapsack code are tools, not model output. If the loop fails, a deterministic orchestrator runs the same tools.

## Data and operations

8. A run uses one data source: live, cache or sample. Sources are never mixed inside a run.
9. Example segments are precomputed and served from a server-side cache, so they need no Qloo or LLM call.
10. Daily limits are counted in Upstash Redis. Without it, custom live runs and search are disabled and examples still work.
11. Qloo entity ids are not stored in this repository. The server attaches them from private configuration, and the browser only sees names and opaque tokens.

## Repository safety

12. Secrets live in `.env.local` and the hosting provider only. Server modules import `server-only`, and a build check fails if secret names or hosts reach the client bundle.
13. Hooks and CI run a secret scan and a repository check for stray Qloo-shaped data, blocked paths and commit message trailers. The word list used by that check is kept outside the repository.

## AI assistance

TODO: who did what (design, implementation, tests, review), written to match the Devpost entry exactly.
