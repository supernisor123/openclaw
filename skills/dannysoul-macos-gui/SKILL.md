---
name: dannysoul-macos-gui
description: macOS GUI automation via AppleScript and CLI tools
metadata:
  {
    "openclaw":
      {
        "emoji": "🖥️",
        "requires": { "bins": ["osascript"] },
      },
  }
---

# macOS GUI Automation

Control macOS applications via AppleScript, cliclick, and screencapture.

## Available Actions

### Safe Actions (auto-approved)
- `open <app>` — Open an application
- `activate <app>` — Bring application to foreground
- `notify <title> <message>` — Send macOS notification
- `screenshot` — Capture screen
- `wait <seconds>` — Wait for N seconds

### Dangerous Actions (require approval)
- `type <text>` — Type text into focused application
- `key <key>` — Press a keyboard key
- `hotkey <combo>` — Press keyboard shortcut (e.g., "cmd+s")
- `click <x> <y>` — Click at screen coordinates
- `move <x> <y>` — Move mouse to coordinates
- `quit <app>` — Quit an application

## Usage

```bash
# Open Safari
mac-gui.sh open Safari

# Take a screenshot
mac-gui.sh screenshot

# Type text (requires approval in dangerous mode)
mac-gui.sh type "Hello world"

# Press keyboard shortcut
mac-gui.sh hotkey "cmd+s"

# Check permissions and capabilities
mac-gui.sh status
```

## Requirements

- macOS (tested on 14.x+)
- `osascript` (built-in)
- `cliclick` (optional, for precise mouse control): `brew install cliclick`
- `screencapture` (built-in)
- Accessibility permission for the terminal app

## Environment Variables

- `MAC_GUI_TYPE_MODE` — "osascript" (default) or "cliclick"
- `MAC_GUI_RESTORE_CLIPBOARD` — "true" to restore clipboard after type (default: true)

## Status Command

```bash
mac-gui.sh status
```

Returns JSON with:
- `permissions`: accessibility, screen_recording, automation status
- `capabilities`: osascript, open, screencapture, cliclick availability
