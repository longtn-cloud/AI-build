# One-Command Local Dev Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `npm run dev` command at the repo root that starts both the backend and frontend dev servers together.

**Architecture:** A new root `package.json` uses `concurrently` to run two commands side by side: a small Node launcher script that spawns the backend venv's Python directly (cross-platform, since a venv can't be "activated" from a spawned process), and the frontend's existing `npm run dev` unchanged.

**Tech Stack:** `concurrently` (new dev dependency, root-level only), Node's built-in `child_process`.

## Global Constraints

- This only starts servers — it does not install dependencies, create the venv, or run migrations. The one-time setup in the README ("Configuration", "Running locally" sections) is a prerequisite, not something this script does for you.
- The existing two-terminal instructions in the README's "Running locally" section stay unchanged — this adds a quick-start alternative alongside them, not a replacement.
- No automated test for this task — it's a developer-experience script that starts long-lived servers, not application code with a CI-run test suite. Verification is manual, per the spec's Testing Strategy.

---

### Task 1: Root dev script

**Files:**
- Create: `package.json` (repo root)
- Create: `scripts/dev-backend.js`
- Modify: `README.md`

**Interfaces:**
- Produces: `npm run dev` (from repo root) — starts backend + frontend together. No other task depends on this; it's a standalone dev-tooling addition.

- [ ] **Step 1: Create the cross-platform backend launcher**

Create `scripts/dev-backend.js`:

```js
const { spawn } = require('node:child_process')

const pythonPath = process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python'

const child = spawn(pythonPath, ['-m', 'uvicorn', 'app.main:app', '--reload'], {
  cwd: 'backend',
  stdio: 'inherit',
})

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      `Could not find ${pythonPath} in backend/. Have you created the venv and installed dependencies?\n` +
        'See README.md "Running locally" for the one-time setup steps.',
    )
  } else {
    console.error(`Failed to start backend: ${err.message}`)
  }
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
```

- [ ] **Step 2: Create the root package.json**

Create `package.json` at the repo root (`D:\Code\ai-build\package.json`):

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

- [ ] **Step 3: Install the new dependency**

Run: `npm install` (from the repo root)
Expected: installs `concurrently` into a new root `node_modules/`, creates/updates `package-lock.json`.

- [ ] **Step 4: Add the quick-start note to the README**

Modify `README.md`: insert this immediately after the `## Running locally` heading (line 67), before the existing `Backend:` subsection:

```markdown
Once the one-time setup above is done, start both servers together from the repo root:

```bash
npm install   # one-time: installs concurrently
npm run dev
```

This runs the backend (`uvicorn --reload`) and frontend (`vite`) together in one terminal, labeled and color-coded, and stops both on Ctrl+C. Or run them separately in two terminals:

```

The existing `Backend:` / `Frontend (separate terminal):` subsections and their code blocks stay exactly as they are, directly below this new paragraph.

- [ ] **Step 5: Manual verification**

Run: `npm run dev` (from the repo root, with the backend venv and frontend `node_modules` already set up per the README's existing setup steps)
Expected: both `backend` and `frontend` labeled, color-coded log streams appear in one terminal; the backend log shows uvicorn's normal startup output, the frontend log shows Vite's normal startup output (including its local dev URL).

Press Ctrl+C.
Expected: both processes stop — no orphaned `uvicorn` or `node`/`vite` process left running (check with your OS's process list if unsure).

Temporarily rename `backend/venv` (e.g. to `backend/venv-tmp`) and run `npm run dev` again.
Expected: the backend log shows the clear "Could not find .../venv/Scripts/python.exe..." message (not a raw stack trace), and the process exits — rename `backend/venv-tmp` back to `backend/venv` afterward.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/dev-backend.js README.md
git commit -m "chore: add npm run dev to start backend and frontend together"
```
