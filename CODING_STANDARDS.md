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

## Retry loops escalate persistent failure

A client loop that retries through failure — polling, refresh, reconnect —
shows the user a visible notice once failures persist, and clears it when a
try succeeds. Transient misses may stay quiet; a loop's last rendered state
must never outlive its credibility, or a crash renders as a frozen
「导入中 0%」.

Why: ticket 08's bookshelf poll swallowed every failed tick, so a crashed
server left the shelf showing a stuck importing row with no hint — the human
reported 「页面上没有任何提示」 and both review axes missed it
(`.scratch/lingualeaf-v1/issues/08-import-progress-tolerance.md`).

At review: for every catch in a retry loop, name what the user sees after N
consecutive failures. "Nothing — the next tick retries" is the bug.

## Derived UI states span the whole lifecycle

A state derived from async work — a disabled button, a spinner, a status
label — is cleared by the work's lifecycle ending, never by a request's
response arriving: a 202 answers in milliseconds while the background work
runs on for minutes.

Why: ticket 08's import button re-enabled the moment the POST returned and
stayed clickable through the whole translation, so re-submits were possible
mid-import; user-reported at acceptance
(`.scratch/lingualeaf-v1/issues/08-import-progress-tolerance.md`).

At review: for each disabled or derived state in a diff, name the event that
clears it. "The response arrived" is not a lifecycle event for background
work.

## Component tests drive the timer and form boundaries

Web component tests cross three jsdom boundaries with the working shapes
from `apps/web/test/bookshelf.test.tsx`: under fake timers, advance time
with `advanceTimersByTimeAsync` inside `act` — RTL's findBy/waitFor polls on
real timers and stalls; a required-file form never submits via a button
click because constraint validation blocks it — plant the files array with
`defineProperty` and dispatch `fireEvent.submit`; and name the fetch mock so
a test can inject failure and recovery mid-flight.

Why: ticket 08's bookshelf tests went red three times on these boundaries
before the working shapes settled, each red a debug round the convention
skips.

At review: a component test mixing waitFor with fake timers, or clicking
submit on a required form, walks a path that already failed once.
