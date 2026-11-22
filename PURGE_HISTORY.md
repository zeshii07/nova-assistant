# C3 — Purge leaked customer PII from git history

> ⚠️ **This document is for the repo owner.** I (the agent) cannot safely
> rewrite remote git history or force-push — those actions are destructive,
> irreversible, and must be performed by someone with push rights who can
> coordinate the force-push with all collaborators. This file describes the
> exact steps; do not skip any.

## What leaked

Commit `2aa8281` ("v35.1: Kiosk UX fixes + PWA + Catalog management + Voice
Cloning Studio") added runtime data files to the repo. They have since been
untracked from the index and added to `.gitignore` (see
`scripts/untrack-runtime-data.js`), **but the files still exist in git
history** and therefore in every clone, fork, and the GitHub web UI.

The leaked content:

| File | Records | What it contains |
|---|---|---|
| `.nova-notifications/cleaning-demo.json` | 19 | **Customer PII** — names (e.g. "Ahmed Khan", "Sara Ali"), phone numbers (e.g. `+971501234567`), lead IDs, lead-capture previews |
| `.nova-feedback/cleaning-demo.json` | 287 | Customer chat message text + selected intents (conversation content) |
| `.nova-feedback/default.json` | 38 | Customer chat message text + selected intents |
| `.nova-feedback/byt-cleaners-dubai.json` | 2 | Customer chat message text + selected intents |

The `.nova-data/` directory was already in `.gitignore` and was **never**
tracked in history — no action needed for it.

## Why this matters

Even after the untrack commit, anyone with read access can `git log` the old
commits and recover the phone numbers. **Untracking is not enough; the history
must be rewritten and the old commits garbage-collected.** Treat all phone
numbers in `.nova-notifications/cleaning-demo.json` as compromised and follow
your local breach-notification rules (e.g. UAE PDPL, GDPR if EU residents).

## Steps to purge history

### 1. Back up the repo first

```bash
git clone --mirror <remote-url> nova-backup.git
# Keep nova-backup.git somewhere safe in case the rewrite goes wrong.
```

### 2. Install git-filter-repo (one-time)

```bash
pip install git-filter-repo
# or, on macOS: brew install git-filter-repo
```

### 3. Rewrite history — remove the four leaked files from ALL commits

```bash
cd nova-assistant
git filter-repo \
  --path .nova-notifications/cleaning-demo.json \
  --path .nova-feedback/cleaning-demo.json \
  --path .nova-feedback/default.json \
  --path .nova-feedback/byt-cleaners-dubai.json \
  --invert-paths
```

`--invert-paths` means "remove these paths, keep everything else." This
rewrites every commit that touched those files. Commit SHAs after the first
affected commit (`2aa8281`) will all change.

### 4. Verify the PII is gone from history

```bash
# Should print nothing:
git log --all -p -- .nova-notifications/cleaning-demo.json | grep -E '97150|Ahmed Khan|Sara Ali' || echo "PII gone from history"
# Should print nothing:
git log --all --oneline -- .nova-notifications .nova-feedback | head
```

### 5. Force-push the rewritten history

```bash
git remote add origin <remote-url>   # if filter-repo removed it
git push --force --all
git push --force --tags
```

### 6. Tell collaborators and prune their clones

Every existing clone still contains the old history. Collaborators must:

```bash
git fetch --all
git reset --hard origin/<branch>
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 7. Drop GitHub's cached views (if hosted on GitHub)

- Contact GitHub Support (or use the secret-scanning removal path) to purge
  cached diffs/Pull Requests that reference the old commits. GitHub keeps
  references in PRs and the web UI even after a force-push.

### 8. Rotate secrets and notify affected customers

- Treat every phone number in the leaked file as compromised. If they are real
  customers, follow your local data-breach notification rules.
- Rotate any API keys / tokens that lived in `.nova-data/` (none found in
  this audit, but verify if the snapshot ever contained credentials).

## Preventing recurrence

- `.gitignore` now lists `.nova-data/`, `.nova-feedback/`, `.nova-notifications/`.
- `scripts/pre-commit-guard.js` (installed by `scripts/install-hooks.js`)
  blocks any commit that stages a file under those dirs.
- `tests/sprintC3.runtime-data-untracked.regression.test.js` fails the build
  if any of those dirs become tracked again.
