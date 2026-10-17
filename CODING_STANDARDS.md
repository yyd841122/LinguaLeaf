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
