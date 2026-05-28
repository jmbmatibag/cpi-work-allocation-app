# Monorepo migration runbook

This is the step-by-step to collapse the three sibling folders into a single
npm-workspaces monorepo under `cpi-work-allocation-app/`, with one git repo.

End state:

```
C:\Users\Jun Mark\Documents\CPI Work Allocation\
└── cpi-work-allocation-app\           # one git repo
    ├── package.json                   # workspaces declaration
    ├── .gitignore
    ├── cpi-work-allocation-shared\
    ├── cpi-work-allocation-api\
    └── cpi-work-allocation-frontend\
```

## Pre-flight checklist

Before starting, commit and push **everything** in each subproject:

```pwsh
cd "C:\Users\Jun Mark\Documents\CPI Work Allocation\cpi-work-allocation-api"
git status        # must be clean
git push          # if a remote exists

cd "..\cpi-work-allocation-frontend"
git status        # must be clean
git push
```

The shared package has no git history of its own yet, which is fine — it
becomes part of the new monorepo's first commit.

If you're keeping the inner `.git` folders (option to preserve history), use
`git subtree` or `git filter-repo` — that's a more advanced flow not covered
here. The simple path below **collapses both inner repos into one new repo**.

## Step 1 — Create the container and move folders

Run in PowerShell from `C:\Users\Jun Mark\Documents\CPI Work Allocation\`:

```pwsh
# Close VS Code / Claude Code first so no process is holding the folders open.
New-Item -ItemType Directory cpi-work-allocation-app
Move-Item cpi-work-allocation-shared    cpi-work-allocation-app\
Move-Item cpi-work-allocation-api       cpi-work-allocation-app\
Move-Item cpi-work-allocation-frontend  cpi-work-allocation-app\
```

## Step 2 — Collapse the inner git repos

```pwsh
cd cpi-work-allocation-app
# Wipe the existing inner repos — make sure step 1's `git push` actually pushed.
Remove-Item -Recurse -Force cpi-work-allocation-api\.git
Remove-Item -Recurse -Force cpi-work-allocation-frontend\.git
# Initialize the new root repo.
git init
```

If a stray parent-level `.git` exists at `CPI Work Allocation\.git` (the
"No commits yet on master" one from earlier), leave it alone — it's not in
our way.

## Step 3 — Root `package.json` with workspaces

Create `cpi-work-allocation-app\package.json`:

```json
{
  "name": "cpi-work-allocation-app",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "cpi-work-allocation-shared",
    "cpi-work-allocation-api",
    "cpi-work-allocation-frontend"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "build:shared": "npm run build --workspace cpi-work-allocation-shared",
    "build:api": "npm run build --workspace cpi-work-allocation-api",
    "build:frontend": "npm run build --workspace cpi-work-allocation-frontend",
    "dev:api": "npm run dev --workspace cpi-work-allocation-api",
    "dev:frontend": "npm run dev --workspace cpi-work-allocation-frontend",
    "test": "npm run test --workspaces --if-present"
  }
}
```

## Step 4 — Convert `file:` deps to workspace deps

In `cpi-work-allocation-api\package.json` AND `cpi-work-allocation-frontend\package.json`,
replace:

```json
"cpi-work-allocation-shared": "file:../cpi-work-allocation-shared"
```

with:

```json
"cpi-work-allocation-shared": "*"
```

npm workspaces resolves `"*"` to the in-workspace package automatically.

## Step 5 — Single install from the root

```pwsh
# From cpi-work-allocation-app\
# Wipe the per-project node_modules / lockfiles to avoid stale resolution.
Remove-Item -Recurse -Force cpi-work-allocation-shared\node_modules,cpi-work-allocation-shared\package-lock.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force cpi-work-allocation-api\node_modules,cpi-work-allocation-api\package-lock.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force cpi-work-allocation-frontend\node_modules,cpi-work-allocation-frontend\package-lock.json -ErrorAction SilentlyContinue

npm install
```

After this, `cpi-work-allocation-app\node_modules\cpi-work-allocation-shared\`
will be a symlink (or junction on Windows) into the workspace folder. Edits
to `cpi-work-allocation-shared\src` are picked up on the next `npm run build`
in the shared package — and consumers see them after their own rebuild.

## Step 6 — `.gitignore` at the new root

Create `cpi-work-allocation-app\.gitignore`:

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
.vscode/
.idea/
# Subproject build output kept above; add anything else per-project here.
```

Each subproject's existing `.gitignore` still applies for the files in that
subtree.

## Step 7 — First commit

```pwsh
git add .
git commit -m "Initial monorepo: shared schemas + api + frontend"
```

## Step 8 — Restart Claude Code at the new path

Point Claude Code (or your editor's terminal) at:

```
C:\Users\Jun Mark\Documents\CPI Work Allocation\cpi-work-allocation-app
```

…and resume work from there.

## Verification after the move

```pwsh
cd cpi-work-allocation-app
npm run build:shared
npm run build:api
npm run build:frontend
```

All three should succeed without any "module not found" errors. The api's
`tsc` and the frontend's `vite build` both resolve `cpi-work-allocation-shared`
through the workspace symlink.

## Rollback

If something goes sideways before step 7's commit, you can recover by:

1. Pull each subproject fresh from its remote into its old sibling location.
2. Re-run the install in each (their `package.json` files still reference
   `file:../cpi-work-allocation-shared`, which works in either layout).

The Phase 3.5 code changes themselves are independent of the folder layout —
they survive any move.
