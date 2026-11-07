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

## Contract-suite borrows migrate with the client change

The tier seam's contract suite (apps/server/test/contract.test.ts) borrows
the real web client modules and drives them over a real socket. When a
change makes one of those helpers module-internal or deletes it, the borrow
migrates in the same change: the type import moves to the wire module, and
the call sites move to a suite-local helper over the same `fetchJson`
client layer — so the suite keeps pinning client-shaped requests, and each
borrowed helper's contract keeps one home.

Why: making `translateChapter` module-internal
(.scratch/reading-page-state-machines/issues/02-translation-trigger.md)
broke the suite's seven borrow sites, and the break surfaced through the
implementer's own honesty rather than a gate — the file sat outside every
tsc project, because its web imports need Bundler resolution while the
server project is NodeNext. The probe
(apps/server/tsconfig.contract-test.json, wired into the root typecheck as
check:contract-types) now catches the import break mechanically. The layer
half stays a review judgement: a migrated borrow still drives `fetchJson`
over the real socket.

At review: when a diff un-exports, moves, or deletes an apps/web/src helper
the contract suite imports, name each borrow site's migration and check the
replacement drives the same real client layer. When a diff adds such a
borrow, check the probe still covers the file.

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

The raising and clearing of that notice is adjudicated, not hand-rolled: a
fresh failure raises the flag, a fresh success clears it, a stale round
writes nothing — writes that belong to the settle channel (useSettle,
GLOSSARY 落回裁决), not to a bare `useState` beside the retry loop. A new
async station adopts the channel rather than pairing its own flag with its
own ticket checks (`.scratch/settle-channel/`).

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

## Exact-name attribute assertions go through getAttribute

jsdom's selector engine matches attribute values case-insensitively —
`querySelector('[data-word="Woke"]')` resolves to the lowercase "woke" span
— while real browsers are case-sensitive, so a case-variant fixture turns a
selector query into a wrong-element result that never reproduces outside
jsdom. `apps/web/test/domQueries.ts` exports `dataWordEl(scope, name)` /
`dataWordEls(scope)`: selectors narrow the element set, `getAttribute`
compares the exact value.

Why: the popup-status-backedge page test asserted "Woke keeps its
affordance" through a selector, received the settled lowercase "woke" span,
and took three debug round-trips to localize — a DOM dump placed outside the
assertion loop showed clean elements and deepened the confusion.

At review: a test querying `[data-…]` with a literal value to assert on one
named element walks a shape that already failed once; the exact-name form is
the helper.

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

## A hook object whose identity follows a flag stays out of dep arrays

A hook's returned object that carries state — a settle channel's `failed`,
any object backed by `useState` — changes identity when that state flips.
Put the object whole into an effect's dependency array and the effect
re-runs on the flip: a failed read re-arms the read, a raised flag re-fires
the work that raised it. An effect calls methods, not the object, so
destructure the referentially stable ones (the hook freezes them in
`useCallback`) and depend on those.

Why: settle-channel 02's ext bulk read (apps/extension/src/reader/
ReaderPage.tsx) reached `run` through the channel object, and
`[book, chapterIndex, resolvedStore, tintSettle]` would have re-armed the
chapter's tint read on every failure→flag flip — a behavior drift no test
pins, caught by reasoning about `useMemo([failed, clear, run])` before any
run went red (settle-channel issues/02, Comments). The landed shape
destructures `runTintRead` and depends on it plus the stable owner.

At review: when a diff adds a hook-returned object to a dependency array,
name what flips its identity. If the answer is a flag, ask whether the flip
should re-run the effect — usually it should not — and check the stable
method was destructured instead.

## Cleanup flags revoke once; key comparison can revive

An effect-cleanup `cancelled` flag and a comparison-based staleness token (key
parts, a version counter, an owner ticket) are not interchangeable mechanisms:
the flag revokes that effect instance's responses permanently, while a token
goes stale only while the key differs — navigate A→B→A and the first pass's
ticket is valid again. Replacing one with the other is behavior-safe only
where the passes' responses cannot interleave into different final state
(same data every pass, or no re-entrant cycle), not wherever "the key covers
it" reads plausibly.

Why: the owner-token spec (decision 5) locked "the route-keyed token covers
it, cleanup becomes empty" for the reading page's load effect; the
implementation's per-site simpler-bar gate caught the revival — two passes
over route A with a server-side change between them could settle in the
wrong order, and the site kept its cleanup
(.scratch/owner-token/spec.md, 2026-10-27). The premise was locked wrong at
grilling time; the gate, not the review, is what held.

The adjudication mechanism itself is not re-derived per station: replacing
a counter or a cleanup flag with tokens goes through the owner token and
the settle channel (useSettle) — the ext reader's reopenSeq counter became
a per-click invalidate and its bulk-read cancelled flag a teardown
invalidate (settle-channel 02, `.scratch/settle-channel/`). Invalidate's
permanent revocation is what keeps an A→A re-click from reviving the first
click's answer — the revival this entry names, which a key comparison
cannot prevent.

At review: when a diff deletes an effect cleanup flag or swaps it for a
comparison-based guard, trace the guard through a re-entrant key cycle
(A→B→A; a popup word visited, left, revisited): when the earlier pass's
response lands after the later pass's, who wins, and can the two passes'
data differ? "The key covers it" is the claim to check, not the proof.

## Smoke assertions pin the claimed property

A test or smoke validating a rendering or platform claim — positioning,
computed style, visual layering, a granted capability — must assert the
claimed property itself (geometry against an anchor, computed style values,
a static reconciliation against the declaration), never mere existence or
clickability. An element that exists but renders unstyled passes an
existence check while failing the claim entirely.

Why: the PDF in-place overlay (extension-reader ticket 06) shipped with its
styles never migrated from the spike — `.pdf-word` had no positioning, so
nothing actually overlaid — while the smoke stayed green on word counts and
click-throughs; the real-Edge acceptance caught it as user-visible
brokenness, and the same round shipped missing manifest permissions because
the smoke's chrome stub answered what the manifest never granted
(`.scratch/extension-reader/issues/07-*.md`).

At review: when a diff claims visual or platform behavior and the
validating assertions check existence or interaction only, that is the
finding — name the claimed property and ask why the assertion does not read
it. Platform facts a stub or fixture answers (chrome.*, network, baked
assets) additionally need a static check against their declaration, because
no stub can prove a grant.

## No-change claims test against a lit state; reviewers probe with a mutation

A test asserting that a behavior does NOT change something — a flag stays
down, a list stays put, a notice stays quiet — must first put that something
into the distinguishing state, then run the behavior, then assert the
no-change. From the resting state the assertion is vacuous: the mutant that
breaks the claim (clear the flag on a stale success, raise it on a stale
failure) passes the same green. The asserted elements must distinguish the
after-state too: the error phase keeps the picker and the recents rendered,
so "the picker is still there" survives the mutant "a failure shows the
error page" — assert the failure surface's absence, read after the
rejection has landed inside `act`. The reviewer-side probe runs the same idea
backwards — for a diff (or ticket) claiming "tests pin behavior X", flip X
in the head and name the test that goes red; if none does, the evidence gap
is the finding. Promise-chain state writes also flush inside `act` before
the flag is read — an unflushed read passes vacuously on the stale value.

Why: settle-channel 01's Codex review mutation-verified three mutants
(verdict before landed; clear after fresh; stale success clears the flag)
surviving all ten kernel tests and the twelve suite scenarios — the suite's
stale-success case landed from a dark flag in every host
(.scratch/settle-channel/issues/01-channel-and-simple-sites.md, review
threadId 01a19c79). The fix (b7ba61c) re-armed every no-change scenario from
a raised flag, added the suite's applied() observation, and proved the catch
by injecting the mutant: four reds, including the pre-existing bookmarks
stale-delete pin. The distinguishing-elements half recurred at station level
in settle-channel 02 (review threadId 01a19e90): the silent-reopen pin
asserted the picker and recents — both of which the error phase renders —
so "failure routes to the error page" passed green until the fix asserted
the failure surfaces' absence after an act-gated rejection.

At review: when a diff adds or touches a "stays / does not / nothing" test,
check the state it starts from distinguishes pass from fail, and check the
asserted elements distinguish the after-state — if every asserted element
renders in the failure state too, the claim is decorative; when a ticket
or wrap-up claims test evidence for a behavior, run the mutation in the head
before trusting the green.

## Lookup tables keyed by external strings probe with hasOwn

A plain object used as a lookup table (`ns -> rules`, `code -> label`) is
probed with `Object.hasOwn(table, key)`, never the `in` operator: `in`
walks the prototype chain, so an externally-sourced key like "constructor"
or "valueOf" matches an inherited member and hands back a function where
the code expects table data — the failure lands far from the lookup, as a
TypeError or a silently-wrong branch.

Why: the manifest gate's operation table looked its method up with
`method in table`; the code-review probe `chrome.tabs.constructor` made the
inherited Object.prototype member satisfy the check and crashed the gate
with a bare TypeError instead of failing loudly. Fixed with Object.hasOwn
plus a regression test
(apps/extension/test/checkManifestPermissions.test.ts, "does not trip on
Object.prototype names used as operations", 2026-10-30).

At review: when a diff probes a plain-object table with a key from outside
the module (wire tokens, API names, user input), check the probe is
hasOwn-guarded — and ask whether a Map is the better table: string keys
from external sources are its home turf.

## Accessible-name assertions follow the accname computation

Testing Library computes a role's accessible name through the accname
algorithm, which trims whitespace at element boundaries: a separator (or
any glue text) living inside a child element vanishes from the computed
name while the visible text keeps it, so the visual string and the
computed name diverge. Write the expected name as the computed name, and
render text that must reach assistive tech — separators, punctuation,
joiners — in a parent-level text node, not inside a boundary element.

Why: reading-bookmarks 03's panel entry rendered the chapter title, then a
prefix span opening with `" · "`; the button's computed name came out
「Two· The first line stand…」 while the screen showed
「Two · The first line stand…」, and one DOM-dump debug round went to
finding it (ReadingPage.tsx, 2026-10-31 session). The dump looked clean
because the DOM was clean — the gap was in the name computation, not the
markup.

At review: when a diff or its tests assert a role's name over composite
children (title + prefix, label + count), check the expected string
against the accname computation — element boundaries trim, so glue text
rides a parent-level text node — rather than against how the row looks.

## Test stubs answer every method the flow sends; the fall-through throws

A named stub for a multi-verb endpoint carries a branch per method the
flow under test sends, and an unmatched request throws naming the method
and URL. A fall-through that answers instead — a canned 404, an empty
200 — turns a stub-coverage gap into a fake domain failure: the test goes
red in the shape of the feature's failure path, and the debugging starts
from the feature instead of the stub.

Why: reading-bookmarks 03's bookmark stub handled GET and POST but not
DELETE; the catch-all 404 made `removeBookmark` raise its failure flag and
the delete test failed as "row not removed" — a timing-shaped
misdiagnosis before the missing branch surfaced (apps/web/test/
reading.test.tsx, 2026-10-31 session). The export suite's stubs already
throw `unexpected fetch: …`. A diff follows this rule for the stubs it
adds or touches; older fall-through stubs in a file convert when a diff
reaches them — not retroactively in the change that writes the rule.

At review: for each new fetch stub in a diff, list the methods the flow
can send at the tested moment and find each one's branch; a fall-through
that resolves a response instead of throwing is the finding. (The stub's
answered shapes still follow "Client calls match real response shapes" —
this rule is about the gap, not the shapes.)

## Structural twins of an available named type sweep in a batch, not per diff

When a diff brings a named type into scope at a file that still re-declares
the same shape inline — a `useState<{ word: string; point: { x: number;
y: number } } | null>` beside an imported `WordClick` — the reviewer notes
the site for the batch sweep (`.scratch/types-alignment/`) and moves on;
the adoption is a dedicated semantics-preserving pass, not a fix inside a
ticket that never asked for it. A diff adopts the alias in-flight only when
the twin declaration sits inside the diff or the ticket requests the type;
otherwise the pull is scope creep dressed as cleanup.

Why: two consecutive reviews flagged the same shape and recorded 不修 both
times — the annotated-blocks-kernel review's 「toAnnotatedBlock 可提具名」
(2026-11-02) and pdf-word-keyboard's `useState<{word; point}>` twin of the
already-imported `WordClick` (.scratch/pdf-word-keyboard/spec.md Comments,
2026-11-03). Same verdict re-paid each time; the rule makes it the default
and gives the sites somewhere to accumulate.

At review: when a diff makes a named type available at a file with an
inline twin, name the site for the batch sweep and go on; flag it as a
per-diff finding only when the ticket asked for the adoption and the diff
skipped it.

## ReaderPage hosts wiring; new reading-face features land in dedicated

## modules

`apps/extension/src/reader/ReaderPage.tsx` is at its split point: it
carries the reader state machine, EPUB host wiring, PDF host wiring, the
word-lookup seam, and the shelf seam, and three consecutive Standards
reviews independently flagged the accretion (pdf-notes, ext-note-types,
pdf-shelf — 2026-11-06/07; the last added ~185 lines across four
stations). A new reading-face feature therefore lands in its own module
with a narrow seam, the way `PdfReader.tsx` and `PdfShelf.tsx` do, and
ReaderPage gains only the wiring — props down, callbacks up. Adding
another station inline (a new phase, a new host body, a new data seam)
is a split ticket's job, not a line item.

Why: the accretion is the slow kind — each ticket's addition looks
local, and only the reviews' shared verdict across three tickets makes
the trend visible. The rule converts the recorded observation into a
default so the split happens by ticket, not by crisis.

At review: for a diff that grows ReaderPage, name which station absorbs
the lines. Wiring (props/callbacks/rendering an existing module) passes;
a new station or a growing host body is a finding — either move the body
into a dedicated module in this diff or record the split ticket.
