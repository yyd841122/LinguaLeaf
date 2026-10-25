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

The shared fetch layer is contract-tested against the real server: the web
client modules run real requests through `apps/server/test/contract.test.ts`
(real Express app, real sockets, real multipart, real error families). When a
diff adds a caller of a shared fetch helper or a new endpoint shape, extend
that suite in the same change instead of trusting a hand-built mock.

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

## Per-entity async UI state keys by entity

Async UI state tracking work on a list of entities — in-flight markers,
spinners, optimistic rows — keys by entity id (a Set or Map), never a
single "current" slot: with a slot, one work item settling erases
another's marker, re-enabling a row whose work is still running.

Why: ticket 03's export button used one `exportingId`; the Standards axis
passed it under the lifecycle rule while the Spec axis caught that
finishing book A re-enabled book B mid-download
(`.scratch/annotated-book-export/issues/03-export-bookshelf-button.md`).

At review: for each piece of async UI state in a diff, ask "can two of
these run at once?" A yes with single-slot state is the bug, even when
today's UI only disables the clicked row.

## One table, one column list

Reader queries of the same table share one column list (one constant both
SELECTs interpolate), never hand-maintained copies: a column added to one copy
but not the other typechecks through the row's `as` cast and fails only when
the code reads the missing field at runtime.

Why: ticket 03 (pdf-import) added `books.page_count` and had to edit the shelf
SELECT and `findBook` in lockstep; the Standards review flagged the pair as a
drift trap the `as BookRow` cast hides from both tsc and the tests. The fix
extracted one `BOOK_COLUMNS` constant, and the book-store refactor made it
structural: every SQL statement over the four book tables (books, chapters,
blocks, reading_progress) lives in apps/server/src/book-store.ts, so a column
list has exactly one possible home.

The gate enforces the locality:
apps/server/scripts/check-sql-locality.mjs (wired into `verify` and the
pre-commit hook) holds a table→owner map — the four book tables →
book-store.ts, word_states → vocab-store.ts (vocabulary-states ticket 01)
— and fails the build on tracked-table SQL outside the row's owner;
schema.ts's DDL and in-place migrations and test fixture or
fault-injection SQL are the deliberate exceptions. A new table with SQL
in more than one file joins this map with exactly one owner.

At review: for the tracked tables the gate owns locality, so the
reviewer's job here is the column-list discipline for every other table.
When a diff adds a column to a table, check every SELECT and INSERT of that
table, and ask whether a row-level `as` cast could hide a missed copy.

## Reviews pin unreachable behavior instead of changing it

When a review flags behavior nothing can reach — a guard wider than any
caller requires, a path no flow exercises — the refactor pins it with a
characterization test instead of tightening it in the same change. The test
states the behavior is pinned, not endorsed, and names itself as the one
that flips when the behavior is deliberately changed. A refactor that also
changes behavior is two changes in one: the unchanged test envelope is what
proves the refactor safe, and a guard change inside it destroys that proof.

Why: the book-store review (Standards + Spec axes, 2026-10-22) found
persistBook's guard was existence-only — a settled book could still take
content, unreachable in the single-task import flow. The fix pinned it
(apps/server/test/book-store.test.ts, "persistBook's guard is
existence-only") instead of adding `AND status = 'importing'` mid-refactor;
the guard can still tighten later, as its own deliberate commit.

At review: when a diff both refactors and changes a guard or edge behavior,
ask for the split. When a diff pins behavior, check the test says "pinned,
not endorsed" and names its own flip condition — an unlabeled pin is just a
test blessing whatever happens to exist.

## Error bodies are a code plus copy; clients branch on the code

A machine-read error body pairs a stable code (wire.ts's ImportErrorCode)
with rewordable prose, and client branches key on the code — never on the
message text. Display copy may be reworded on either side of the wire; a
branch keyed on prose breaks the day someone fixes a typo. New wire enum
members land in the shared union first (apps/server/src/wire.ts); the
Record-typed label maps make a missing label or copy a compile error on
the consuming side.

Why: the shelf told encrypted PDFs from other 400s by comparing the
body's Chinese message (`error.body?.error === "加密 PDF 暂不支持"`), so a
server copy edit would have silently degraded every encrypted-PDF upload
to the generic corrupt-file copy. The wire vocabulary module made the
codes and unions one shared source
(`.scratch/wire-vocabulary/issues/01-wire-contract-module.md`).

At review: when a diff adds a client branch on a response field, the
field must be a stable machine token (code/enum), not display text; when
a diff adds or renames a wire enum member, both tiers must compile
against the shared union and the contract suite must pin it in the same
change.

## User-facing copy speaks the glossary

Display copy — buttons, notices, labels, empty states — uses the canonical
term in GLOSSARY.md, and never a word its _Avoid_ list retires. When a
ticket touches the glossary, the discipline doubles: the term just written
down is the term the UI renders.

Why: the vocabulary-states ticket added 已忽略 (Ignored) to GLOSSARY.md and,
in the same change, shipped the popup button as 忽略 — the drift sat one
screen above the entry that forbids it, until the Standards axis caught it
(.scratch/vocabulary-states/issues/01-vocabulary-states.md). Display copy
is where the glossary meets the reader; a synonym here forks the domain
language in its most visible spot.

At review: for every new user-facing string in the diff, name the glossary
term it renders (or state that none applies), and check the Avoid lists —
the drift to hunt is the near-synonym (忽略 for 已忽略, 查词 for
点词查详情), not the unrelated word.

## Contract pins carry machine facts, not server copy

A seam contract test asserts what the wire guarantees the client — the
status family, body presence and key shape, stable codes, fixture-derived
literals — and never pins the server's rewordable prose. A copy edit that
breaks no client should break no contract test; a suite that repeats
server copy turns every rewording into a seam failure.

Why: the tier-seam-reading review (Standards + Spec axes, 2026-10-23)
found the 500 hiccup pin and the chapter-404 pin asserting "internal
server error" and "chapter not found" verbatim — envelope and route copy
with no client branch on the text. The pins relaxed to status plus body
presence; the value-level pins stay in api.test.ts
(`.scratch/tier-seam-reading/issues/02-409-family-and-500-hiccup.md`).

At review: when a diff adds a contract-suite assertion on an error body,
check it carries the status and a machine token (or presence/shape), not
display text. Fixture literals (titles, positions, IPA lines from a
committed fixture book) are anchors, not copy — pinning them is fine
where the fixture is the shared input.

## Committed generated artifacts pin freshness with a check gate

A build artifact committed to the source tree — an inlined script, a
generated module — is never hand-edited, and its freshness against the
source that generates it is a test-owned gate: the generator carries a
--check mode (rebuild in memory, compare bytes, exit 1 naming the
regenerating command), a test runs it, and the artifact sits in the
prettier and eslint ignore lists because byte-identity is the contract.

Why: the annotated book file's script became real TypeScript compiled
into a committed generated module
(apps/server/src/export/file-script.generated.ts, reading-model ticket
02). Two drift shapes appeared on day one: esbuild's source-path
comments depend on the invocation cwd, so the build pinned
absWorkingDir — without it the gate flaps with the call style; and a
comment-only source edit does not trip the gate, which is correct — the
freshness contract is over compiled output, not source text.

At review: when a diff adds or touches a committed generated file, check
the generator's check mode is wired into a test, the artifact is in the
ignore lists, and any source edit that changes the artifact ran the
generator in the same change — a stale artifact still passing typecheck
is exactly the silent failure this rule exists for.

## Pairings between two collections are held by references, not recounted

When one collection must line up with another — sentences to translations,
rows to results — hold one collection of references (or key both by the
same id) and write through it; never filter and count the same sequence in
two places. A second traversal that re-derives the pairing drifts silently
the day either side's filter changes, and the type system cannot see the
pairing at all — the misalignment ships as wrong data next to right code.

Why: the import task collected sentence texts with one filter over the
blocks, then re-filtered and hand-counted a sentenceIndex to write
translations back — two independent traversals whose lockstep nothing
enforced, testable only through HTTP (.scratch/translation-join/). The fix
holds the sentence-block references once and mutates them in place, so the
join is object identity, and a direct runImportTask test pins translations
landing on the sentence blocks of an interleaved chapter.

At review: when a diff pairs two sequences by index, find where each
side's shape is derived. If the shapes come from two independent
traversals, the pairing is a latent misalignment — collapse to one held
reference set (or a shared key) and pin the pairing with a test that
would catch the drift.

## An Express error handler is four arguments, or it is middleware

Express dispatches on function arity: a handler with (err, req, res, next) is
an error handler; the same function minus one argument is ordinary middleware
whose first parameter is the request. Dropping an unused trailing next to
satisfy a linter silently converts the error handler into a catch-all
middleware that answers 500 for everything routed below it.

Why: the audit round's JSON error envelope shipped as three arguments after a
lint fix, and every request past the API 404 — the whole frontend — answered
500 with the request object logged as the error
(.cc-suite/audits/audit-20261023-140500-findings.md, review round).

At review: when a diff adds or edits an error-handling middleware, count the
parameters; three is a bug, not a style choice. Keep the unused trailing next
even when the handler always responds itself.

## State keyed by a route or prop follows the key

State whose read key derives from a route param or a prop — a per-book
preference, an entity-scoped value — re-reads when that key changes under a
mounted component: the `useState` initializer runs once per mount, and React
Router keeps the route element mounted across param changes, so the page
silently renders the previous entity's values. The working shapes are the
render-time adjust (hold the previous key, re-read on mismatch) and the
`key={id}` remount; "the initializer runs again" is the bug itself.

Why: the per-book prefs (ticket 01, per-book-toggles) put every display
setting on `book:<id>:<pref>`, and shelf → another-book navigation mounts no
new component — the first hook design kept book A's sizes on book B until
the render-time adjust went into apps/web/src/prefs.ts and the book-switch
test ("follows the book when the book id changes under a mounted hook")
pinned it.

At review: for every `useState` reading through a param or prop, name the
event that re-reads it when that value changes. "It remounts" is a claim to
check against the route table, not an assumption.
