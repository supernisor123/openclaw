---
name: dannysoul-git-ops
description: Git operations with safety guardrails (deny-list, patch validation)
metadata:
  {
    "openclaw":
      {
        "emoji": "🔀",
        "requires": { "bins": ["git"] },
      },
  }
---

# Git Operations

Safe git operations with deny-list enforcement and patch validation.

## Available Operations

### Read-only (auto-approved)
- `git status` — Working tree status
- `git diff --stat` — Diff statistics
- `git log --oneline -10` — Recent commits
- File listing (with deny-list filtering)

### Write Operations (require approval)
- `git add -A` — Stage all changes
- `git commit -m "message"` — Create commit
- `git push origin <branch>` — Push to remote
- Patch apply — Apply validated diff

## Patch Validation

All patches are validated before application:
1. Not empty
2. Size < 250KB
3. Contains valid `diff --git` headers
4. No denied paths (see deny-list)

## Deny-List

The following paths are **never** allowed in patches or file operations:

### Prefix Deny
- `.git/` — Git internals
- `.venv/`, `venv/`, `env/` — Virtual environments
- `bot/state/` — Runtime state
- `bot/runtime/` — Runtime files
- `__pycache__/` — Python cache

### File Deny
- `.env` — Environment secrets
- `bot/.env` — Bot secrets
- Any `.env*` files

### Path Deny
- `..` — Parent directory traversal
- Absolute paths (starting with `/`)

## Safety Rules

1. Deny-list is enforced on ALL file operations (read, write, patch)
2. `git push` always requires explicit approval
3. Automatic commit requires `ENABLE_GIT_AUTO_COMMIT=true`
4. Automatic push requires `ENABLE_GIT_AUTO_PUSH=true`
