# Local E2E: node-driver verification against a running server

For what the contract suite cannot reach — restart sweeps, real process
lifecycles, anything needing a genuinely restarted server — drive the real
build over HTTP from a throwaway driver script. (Real-browser flows are
`docs/agents/browser-e2e.md`'s lane.)

## Setup

- **Server entry**: the built `.output/server/main.js` — `app.js` only
  exports `createApp`, and node on it exits 0 with no output.
- **Isolated runtime**: always `DATABASE_PATH=/tmp/<name>.sqlite PORT=<free
port>` with `node --env-file-if-exists=.env .output/server/main.js`. Never
  the user's `.data` or port 3000 — a user-run instance often holds both.
- **Mock translator**: `node scripts/local-e2e/mock-deepseek.mjs [port]`,
  server spawned with `DEEPSEEK_BASE_URL=http://127.0.0.1:<port>
DEEPSEEK_API_KEY=x`. Shell env shadows `.env` (the env-guard shadow warning
  is the confirmation, not a fault); the base is loopback, so zero external
  calls, and percents visibly step.

## Driver invariants

1. **Free the port first** (`fuser -k <port>/tcp; sleep 1`). The orphan from
   a crashed earlier run silently holds it: the new spawn dies EADDRINUSE
   while the orphan answers the probes, so the whole run tests nothing while
   looking alive. This bit on-demand-translation 04's E2E end to end.
2. **One try/finally around everything.** A driver that dies mid-run without
   cleanup manufactures the orphan above for its own next run.
3. **Probe child-exit beside readiness.** Poll `child.exitCode === null` AND
   the HTTP health route; a port held by a foreign listener must read as
   failure, not readiness.
4. **Loopback curl needs `--noproxy '*'`** (quote the star) or `export
NO_PROXY="127.0.0.1,localhost"` — the WSL system proxy otherwise answers
   fake 5xx. Node `fetch` sidesteps this (undici ignores proxy env), which is
   why the drivers here are node scripts, and why curl-green does not imply
   fetch-green on the same route.
