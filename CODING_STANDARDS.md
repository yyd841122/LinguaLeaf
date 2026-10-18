# Coding Standards

Read by the review stage (`/code-review`, Standards axis). This file holds
the judgement calls tooling cannot substitute for — prettier, eslint, and
tsc already enforce the mechanical rules, so they are not listed here.

## Fixtures mirror real-data shapes

Test fixtures must model the messy shapes the real data actually contains —
thin entries, pointer entries, duplicates, case variants — not just clean
cases. A fixture that only holds clean rows lets the code under test take a
path real data exercises every day, and no test notices.

Why: ticket 03's dictionary fixture omitted ECDICT's own thin entries for
inflected forms, so the lookup's lemma contract passed every test while
missing on real data until the review stage caught it
(`.scratch/lingualeaf-v1/issues/03-ecdict-ipa-line.md`).

## Client calls match real response shapes

When a caller (or a test stub) meets an HTTP endpoint, model what the server
actually returns for that method — status family and body presence, not just
the happy 200-JSON. A bodyless 2xx (204) through a JSON parser, or a 404 read
as "empty data", fails on real data while every test stays green.

Why: ticket 05's bookshelf delete showed 删除失败 for a successful delete —
`fetchJson` parsed the 204's empty body and threw. The API seam (supertest)
never runs the front-end fetch layer, so only human acceptance caught it
(`.scratch/lingualeaf-v1/issues/05-reading-experience.md`). At review: when a
diff adds a caller of a shared fetch helper, check the helper's parsing
contract against that endpoint's real status/body shape.
