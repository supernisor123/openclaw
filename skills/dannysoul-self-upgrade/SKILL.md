---
name: dannysoul-self-upgrade
description: Self-upgrade DannySoul via git pull + service restart
metadata:
  {
    "openclaw":
      {
        "emoji": "⬆️",
        "requires": { "bins": ["git"] },
      },
  }
---

# Self-Upgrade

Upgrade DannySoul to the latest version from the remote repository.

## Upgrade Process

1. `git fetch origin` — Fetch latest changes
2. `git pull --ff-only` — Fast-forward merge (safe, no conflicts)
3. Restart the service

## Safety

- Only fast-forward merges are allowed (no force merges)
- Requires explicit `/approve` before restart
- Full audit trail of upgrade events
- Rollback: `git reset --hard HEAD~1` (manual)

## Trigger

Via Telegram: `/upgrade`

## Requirements

- `ENABLE_SELF_UPGRADE=true`
- Git remote configured
- Service restart mechanism (systemd, pm2, etc.)
