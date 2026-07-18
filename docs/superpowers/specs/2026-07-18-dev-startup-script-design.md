# One-Command Local Dev Startup — Design

Adds a single root-level command that starts both the backend and frontend dev servers together, replacing the current two-terminal workflow for day-to-day development.

## Scope

Starts both servers only — does not install dependencies, create the venv, or run migrations. Assumes the one-time setup already documented in the README (`python -m venv venv` + `pip install -r requirements.txt` in `backend/`, `npm install` in `frontend/`) has already been done. The existing two-terminal instructions in the README stay as-is (still useful for running/watching either side independently); this adds a quick-start alternative alongside them.

## Decisions

**Root `package.json`** (new — this repo has none today) with one script:
```json
{
  "name": "document-knowledge-assistant",
  "private": true,
  "scripts": {
    "dev": "concurrently -n backend,frontend -c blue,green \"node scripts/dev-backend.js\" \"npm run dev --prefix frontend\""
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```
`concurrently` runs both processes in one terminal with labeled, color-coded output, and forwards Ctrl+C to stop both — the standard, well-tested tool for exactly this.

**Cross-platform backend startup:** a venv can't be "activated" portably from an npm script (Windows and Unix activation differs, and activation itself is a shell builtin, not something `spawn` can invoke directly). `scripts/dev-backend.js` sidesteps this by spawning the venv's Python interpreter directly — `backend/venv/Scripts/python.exe` on Windows, `backend/venv/bin/python` elsewhere, chosen via `process.platform` — running `-m uvicorn app.main:app --reload` with `cwd: 'backend'`. If the venv doesn't exist (spawn `ENOENT`), it prints a clear message pointing at the README's setup steps instead of a raw stack trace.

**Frontend startup:** `npm run dev --prefix frontend` — reuses the existing `frontend/package.json` `dev` script unchanged, no duplicated Vite invocation.

**Process nesting kept minimal:** `concurrently` invokes `node scripts/dev-backend.js` directly (not through an intermediate npm script) specifically to keep the process chain to `concurrently → node → python`, rather than adding a fourth layer — fewer layers mean more reliable signal (Ctrl+C) propagation to the actual uvicorn process, which matters more on Windows than Unix.

## Error Handling & Edge Cases

- Missing venv (one-time setup never run): `scripts/dev-backend.js`'s spawned-process `error` event catches `ENOENT` and prints a message pointing at the README's "Running locally" section, then exits non-zero — `concurrently` reports the failed process and stops the other one rather than leaving a half-started dev environment.
- Missing `frontend/node_modules`: surfaces as whatever error `npm run dev --prefix frontend` itself already produces today — unchanged, out of scope to improve here.
- Ctrl+C: `concurrently`'s default behavior stops all processes when one exits or on interrupt — both servers shut down together, not just one.

## Testing Strategy

This is a local developer-experience script, not application code — there is no automated test suite entry for it (no CI runs `npm run dev`, which starts long-lived servers by design). Verification is manual: run `npm run dev` from the repo root, confirm both servers start and are reachable (backend on its configured port, frontend on Vite's dev port), confirm Ctrl+C stops both, and confirm the missing-venv error path (temporarily rename `backend/venv` and re-run) prints a self-explanatory message rather than a raw stack trace.
