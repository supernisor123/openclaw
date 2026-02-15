---
name: dannysoul-peekaboo
description: Cross-platform GUI automation agent via Peekaboo CLI
metadata:
  {
    "openclaw":
      {
        "emoji": "👀",
        "requires": { "bins": ["peekaboo"] },
        "install":
          [
            {
              "id": "peekaboo",
              "kind": "npm",
              "package": "peekaboo-cli",
              "bins": ["peekaboo"],
              "label": "Install Peekaboo CLI",
            },
          ],
      },
  }
---

# Peekaboo GUI Automation

Cross-platform GUI automation using the Peekaboo CLI agent.

## Available Actions

### Agent Mode
Run a natural language instruction as a GUI automation task:

```bash
peekaboo agent --max-steps 12 "Open Chrome and navigate to github.com"
```

### Permissions Check
```bash
peekaboo permissions status --json
```

### Bridge Status
```bash
peekaboo bridge status
```

## Configuration

- `PEEKABOO_STEP_TIMEOUT_SECONDS` — Timeout per step (default: 180)
- Peekaboo uses `OPENAI_API_KEY` from environment for its own LLM calls

## Safety

- All peekaboo agent runs require gate approval (classified as "dangerous")
- Max steps limited by `GUI_MAX_STEPS` config
- Full audit trail in dannysoul-audit-log
