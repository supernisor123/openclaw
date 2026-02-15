#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/mac-gui.sh status
  ./scripts/mac-gui.sh open <path|url|app-name>
  ./scripts/mac-gui.sh activate <app-name>
  ./scripts/mac-gui.sh quit <app-name>
  ./scripts/mac-gui.sh approval [app-name]   # check "Yes/Allow/Approve" buttons
  ./scripts/mac-gui.sh approve [app-name]    # click first matching approval button
  ./scripts/mac-gui.sh notify <message>
  ./scripts/mac-gui.sh say <message>
  ./scripts/mac-gui.sh type <text>
  ./scripts/mac-gui.sh key <return|tab|esc|space|up|down|left|right|delete>
  ./scripts/mac-gui.sh hotkey <key> [command,option,control,shift]
  ./scripts/mac-gui.sh click <x> <y>            # requires cliclick
  ./scripts/mac-gui.sh move <x> <y>             # requires cliclick
  ./scripts/mac-gui.sh screenshot [absolute-path]
EOF
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing command: $name" >&2
    exit 1
  fi
}

status() {
  require_cmd osascript
  require_cmd open
  require_cmd screencapture

  local gui_status="unknown"
  if osascript -e 'tell application "System Events" to get name of first process' >/dev/null 2>&1; then
    gui_status="ok"
  else
    gui_status="needs-accessibility-permission"
  fi

  echo "osascript: ok"
  echo "open: ok"
  echo "screencapture: ok"
  if command -v cliclick >/dev/null 2>&1; then
    echo "cliclick: ok"
  else
    echo "cliclick: missing (optional, needed for click/move)"
  fi
  echo "gui-automation: $gui_status"
}

open_target() {
  local target="$1"
  # Normalize spotify search URIs: spaces in URI break parsing, so we URL-encode them.
  if [[ "${target}" == spotify:search:* ]]; then
    local prefix="spotify:search:"
    local query="${target#${prefix}}"
    query="$(printf '%s' "${query}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/[[:space:]]+/%20/g')"
    target="${prefix}${query}"
  fi
  # Support arbitrary URL schemes (https://, spotify:, etc).
  if [[ "$target" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*: ]]; then
    open "$target"
    echo "opened-url: $target"
    return 0
  fi

  if [[ -e "$target" ]]; then
    open "$target"
    echo "opened-path: $target"
    return 0
  fi

  open -a "$target"
  echo "opened-app: $target"
}

activate_app() {
  local app_name="$1"
  osascript - "$app_name" <<'APPLESCRIPT'
on run argv
  set appName to item 1 of argv
  tell application appName to activate
end run
APPLESCRIPT
  echo "activated-app: $app_name"
}

quit_app() {
  local app_name="$1"
  local result=""
  result="$(osascript - "$app_name" <<'APPLESCRIPT'
on run argv
  set appName to item 1 of argv
  try
    if application appName is running then
      tell application appName to quit
      return "quit"
    end if
    return "not-running"
  on error errMsg number errNum
    return "error:" & (errNum as text) & ":" & errMsg
  end try
end run
APPLESCRIPT
  )"
  echo "${result}"
  if [[ "${result}" == error:* ]]; then
    exit 2
  fi
  echo "quit-app: $app_name"
}

approval_status() {
  local app_name="${1:-}"
  local result=""
  result="$(osascript - "$app_name" <<'APPLESCRIPT'
on run argv
  set appName to ""
  if (count of argv) >= 1 then
    set appName to (item 1 of argv) as text
  end if

  set positiveButtons to {"Yes", "Allow", "Approve", "OK", "Run", "Continue", "允許", "確定"}

  try
    tell application "System Events"
      if appName is "" then
        set appName to name of first application process whose frontmost is true
      end if
      if not (exists process appName) then
        return "app-not-running"
      end if
      tell process appName
        repeat with w in windows
          repeat with b in buttons of w
            set bn to ""
            try
              set bn to (name of b) as text
            end try
            if bn is not "" then
              repeat with keyText in positiveButtons
                if bn contains (keyText as text) then
                  return "approval:" & bn
                end if
              end repeat
            end if
          end repeat
        end repeat
      end tell
    end tell
    return "approval:none"
  on error errMsg number errNum
    return "error:" & (errNum as text) & ":" & errMsg
  end try
end run
APPLESCRIPT
  )"
  echo "${result}"
  if [[ "${result}" == error:* ]]; then
    exit 2
  fi
}

approval_click() {
  local app_name="${1:-}"
  local result=""
  result="$(osascript - "$app_name" <<'APPLESCRIPT'
on run argv
  set appName to ""
  if (count of argv) >= 1 then
    set appName to (item 1 of argv) as text
  end if

  set positiveButtons to {"Yes", "Allow", "Approve", "OK", "Run", "Continue", "允許", "確定"}

  try
    tell application "System Events"
      if appName is "" then
        set appName to name of first application process whose frontmost is true
      end if
      if not (exists process appName) then
        return "app-not-running"
      end if
      tell process appName
        repeat with w in windows
          repeat with b in buttons of w
            set bn to ""
            try
              set bn to (name of b) as text
            end try
            if bn is not "" then
              repeat with keyText in positiveButtons
                if bn contains (keyText as text) then
                  click b
                  return "approved:" & bn
                end if
              end repeat
            end if
          end repeat
        end repeat
      end tell
    end tell
    return "approval:none"
  on error errMsg number errNum
    return "error:" & (errNum as text) & ":" & errMsg
  end try
end run
APPLESCRIPT
  )"
  echo "${result}"
  if [[ "${result}" == error:* ]]; then
    exit 2
  fi
}

notify_msg() {
  local msg="$1"
  osascript - "$msg" <<'APPLESCRIPT'
on run argv
  set msgText to item 1 of argv
  display notification msgText with title "DannySoul Bot"
end run
APPLESCRIPT
  echo "notified"
}

say_msg() {
  local msg="$1"
  say "$msg"
  echo "spoken"
}

type_text() {
  local text="$1"
  local mode="${MAC_GUI_TYPE_MODE:-auto}" # auto|keystroke|paste
  local restore_clipboard="${MAC_GUI_RESTORE_CLIPBOARD:-false}" # true|false
  local restore_delay_ms="${MAC_GUI_RESTORE_DELAY_MS:-200}" # delay before restoring clipboard (ms)

  contains_non_ascii() {
    # Byte-level detection: any char outside printable ASCII range.
    # This catches CJK, emoji, and also newlines/tabs.
    LC_ALL=C printf '%s' "$1" | grep -q '[^ -~]'
  }

  bool_true() {
    # macOS ships bash 3.2 by default; avoid bash4-only ${var,,} expansion.
    local v="${1:-}"
    v="$(printf '%s' "${v}" | tr '[:upper:]' '[:lower:]')"
    case "${v}" in
      1|true|yes|on) return 0 ;;
      *) return 1 ;;
    esac
  }

  sleep_ms() {
    local ms="${1:-0}"
    if ! [[ "${ms}" =~ ^[0-9]+$ ]]; then
      return 0
    fi
    if [[ "${ms}" -le 0 ]]; then
      return 0
    fi
    local sec_int=$((ms / 1000))
    local ms_rem=$((ms % 1000))
    local sleep_val=""
    if [[ "${sec_int}" -eq 0 ]]; then
      sleep_val="0.$(printf '%03d' "${ms_rem}")"
    else
      sleep_val="${sec_int}.$(printf '%03d' "${ms_rem}")"
    fi
    sleep "${sleep_val}"
  }

  if [[ "${mode}" == "paste" ]] || { [[ "${mode}" == "auto" ]] && contains_non_ascii "${text}"; }; then
    require_cmd pbcopy
    local clip_tmp=""
    if bool_true "${restore_clipboard}"; then
      require_cmd pbpaste
      clip_tmp="/tmp/mac-gui-clipboard-$$.txt"
      pbpaste >"${clip_tmp}" 2>/dev/null || true
    fi

    # Use clipboard paste for better IME/unicode reliability.
    printf '%s' "${text}" | pbcopy
    osascript <<'APPLESCRIPT'
tell application "System Events"
  delay 0.05
  keystroke "v" using {command down}
end tell
APPLESCRIPT

    if [[ -n "${clip_tmp}" && -f "${clip_tmp}" ]]; then
      # Give the target app time to consume the pasteboard before restoring.
      # Without this, some apps may paste the "restored" clipboard contents.
      sleep_ms "${restore_delay_ms}"
      cat "${clip_tmp}" | pbcopy
      rm -f "${clip_tmp}"
    fi

    echo "typed"
    return 0
  fi

  osascript - "$text" <<'APPLESCRIPT'
on run argv
  set textValue to item 1 of argv
  tell application "System Events"
    keystroke textValue
  end tell
end run
APPLESCRIPT
  echo "typed"
}

key_press() {
  local key_name="$1"
  local key_code=""

  case "$key_name" in
    return|enter) key_code="36" ;;
    tab) key_code="48" ;;
    esc|escape) key_code="53" ;;
    space) key_code="49" ;;
    delete|backspace) key_code="51" ;;
    up) key_code="126" ;;
    down) key_code="125" ;;
    left) key_code="123" ;;
    right) key_code="124" ;;
    *)
      echo "Unsupported key: $key_name" >&2
      exit 1
      ;;
  esac

  osascript - "$key_code" <<'APPLESCRIPT'
on run argv
  set codeValue to (item 1 of argv) as integer
  tell application "System Events"
    key code codeValue
  end tell
end run
APPLESCRIPT
  echo "pressed-key: $key_name"
}

hotkey_press() {
  local key="$1"
  local modifiers_csv="${2:-command}"

  osascript - "$key" "$modifiers_csv" <<'APPLESCRIPT'
on run argv
  set keyValue to item 1 of argv
  set modifiersCsv to item 2 of argv
  set AppleScript's text item delimiters to ","
  set modifierItems to text items of modifiersCsv
  set usingList to {}

  repeat with m in modifierItems
    set modifierName to (m as text)
    if modifierName is "command" then
      copy command down to end of usingList
    else if modifierName is "option" then
      copy option down to end of usingList
    else if modifierName is "control" then
      copy control down to end of usingList
    else if modifierName is "shift" then
      copy shift down to end of usingList
    end if
  end repeat

  tell application "System Events"
    if (count of usingList) > 0 then
      keystroke keyValue using usingList
    else
      keystroke keyValue
    end if
  end tell
end run
APPLESCRIPT

  echo "pressed-hotkey: $key ($modifiers_csv)"
}

take_screenshot() {
  local path="${1:-/tmp/mac-gui-$(date +%Y%m%d-%H%M%S).png}"
  screencapture -x "$path"
  echo "screenshot: $path"
}

mouse_click() {
  require_cmd cliclick
  local x="$1"
  local y="$2"
  cliclick "c:${x},${y}"
  echo "clicked: ${x},${y}"
}

mouse_move() {
  require_cmd cliclick
  local x="$1"
  local y="$2"
  cliclick "m:${x},${y}"
  echo "moved: ${x},${y}"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local cmd="$1"
  shift

  case "$cmd" in
    status) status ;;
    open)
      [[ $# -ge 1 ]] || { usage; exit 1; }
      open_target "$*"
      ;;
    activate)
      [[ $# -ge 1 ]] || { usage; exit 1; }
      activate_app "$*"
      ;;
    quit)
      [[ $# -ge 1 ]] || { usage; exit 1; }
      quit_app "$*"
      ;;
    approval)
      approval_status "$*"
      ;;
    approve)
      approval_click "$*"
      ;;
    notify)
      [[ $# -ge 1 ]] || { usage; exit 1; }
      notify_msg "$*"
      ;;
    say)
      [[ $# -ge 1 ]] || { usage; exit 1; }
      say_msg "$*"
      ;;
    type)
      [[ $# -ge 1 ]] || { usage; exit 1; }
      type_text "$*"
      ;;
    key)
      [[ $# -eq 1 ]] || { usage; exit 1; }
      key_press "$1"
      ;;
    hotkey)
      [[ $# -ge 1 ]] || { usage; exit 1; }
      hotkey_press "$1" "${2:-command}"
      ;;
    screenshot)
      take_screenshot "${1:-}"
      ;;
    click)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      mouse_click "$1" "$2"
      ;;
    move)
      [[ $# -eq 2 ]] || { usage; exit 1; }
      mouse_move "$1" "$2"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
