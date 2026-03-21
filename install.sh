#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="iPixelGalaxy"
REPO_NAME="spotify-plus"
ASSET_NAME="spotify-plus.js"

RED="$(printf '\033[31m')"
YELLOW="$(printf '\033[33m')"
GREEN="$(printf '\033[32m')"
CYAN="$(printf '\033[36m')"
GRAY="$(printf '\033[90m')"
BOLD="$(printf '\033[1m')"
RESET="$(printf '\033[0m')"

print_section() {
  printf "\n%s%s%s\n" "$BOLD$CYAN" "$1" "$RESET"
}

print_step() {
  printf "%s%s%s\n" "$GREEN" "$1" "$RESET"
}

print_warn() {
  printf "%s%s%s\n" "$BOLD$RED" "$1" "$RESET"
}

print_note() {
  printf "%s%s%s\n" "$YELLOW" "$1" "$RESET"
}

print_muted() {
  printf "%s%s%s\n" "$GRAY" "$1" "$RESET"
}

confirm_install() {
  local answer
  printf "\nContinue installing Spotify Plus? [y/N] "
  if [ -r /dev/tty ]; then
    read -r answer </dev/tty || true
  else
    read -r answer || true
  fi
  case "${answer:-}" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

show_warning() {
  print_note "To fully clear Spotify Plus client state later, fully close Spotify and run:"
  printf "\n"
  print_warn "WARNING: running the reset commands below can also clear Spotify client preferences and session/UI state."
  printf "\n"

  case "$(uname -s)" in
    Darwin)
      print_muted "python3 - <<'PY'"
      print_muted "from pathlib import Path"
      print_muted "prefs = Path.home() / 'Library/Application Support/Spotify/prefs'"
      print_muted "text = prefs.read_text() if prefs.exists() else ''"
      print_muted "import re"
      print_muted "text = re.sub(r'(?m)^app\\.enable-developer-mode=.*$', 'app.enable-developer-mode=false', text)"
      print_muted "prefs.parent.mkdir(parents=True, exist_ok=True)"
      print_muted "prefs.write_text(text if text.endswith('\\n') or not text else text + '\\n')"
      print_muted "PY"
      print_muted "rm -rf \"$HOME/Library/Application Support/Spotify/PersistentCache/Session Storage\""
      print_muted "rm -rf \"$HOME/Library/Application Support/Spotify/PersistentCache/Sessions\""
      ;;
    *)
      print_muted "python3 - <<'PY'"
      print_muted "from pathlib import Path"
      print_muted "prefs = Path.home() / '.config/spotify/prefs'"
      print_muted "text = prefs.read_text() if prefs.exists() else ''"
      print_muted "import re"
      print_muted "text = re.sub(r'(?m)^app\\.enable-developer-mode=.*$', 'app.enable-developer-mode=false', text)"
      print_muted "prefs.parent.mkdir(parents=True, exist_ok=True)"
      print_muted "prefs.write_text(text if text.endswith('\\n') or not text else text + '\\n')"
      print_muted "PY"
      print_muted "rm -rf \"$HOME/.config/spotify/Session Storage\""
      print_muted "rm -rf \"$HOME/.config/spotify/Sessions\""
      ;;
  esac

  printf "\n"
  print_warn "WARNING: uninstalling Spotify Plus alone will not automatically undo these persistent client changes:"
  printf " - Spotify developer tools staying enabled\n"
  printf " - F5 reload behavior remaining available\n"
  printf " - remembered last-view route/session state across Spotify restarts\n"
}

get_spicetify() {
  if command -v spicetify >/dev/null 2>&1; then
    command -v spicetify
    return 0
  fi

  local candidates=(
    "$HOME/.spicetify/spicetify"
    "$HOME/spicetify-cli/spicetify"
    "$HOME/.local/bin/spicetify"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -x "$candidate" ]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done

  return 1
}

SPICETIFY_WAS_PRESENT=0

ensure_spicetify() {
  if get_spicetify >/dev/null 2>&1; then
    SPICETIFY_WAS_PRESENT=1
    get_spicetify
    return 0
  fi

  print_step "Spicetify was not found. Installing Spicetify CLI..."
  curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | bash

  if ! get_spicetify >/dev/null 2>&1; then
    printf "%s\n" "Spicetify installed, but the binary could not be located afterwards." >&2
    exit 1
  fi

  get_spicetify
}

enable_developer_mode() {
  local prefs_path
  case "$(uname -s)" in
    Darwin) prefs_path="$HOME/Library/Application Support/Spotify/prefs" ;;
    *) prefs_path="$HOME/.config/spotify/prefs" ;;
  esac

  mkdir -p "$(dirname "$prefs_path")"
  if [ ! -f "$prefs_path" ]; then
    printf "app.enable-developer-mode=true\n" > "$prefs_path"
    return
  fi

  python3 - "$prefs_path" <<'PY'
from pathlib import Path
import re
import sys

prefs = Path(sys.argv[1])
text = prefs.read_text()
if re.search(r'(?m)^app\.enable-developer-mode=', text):
    text = re.sub(r'(?m)^app\.enable-developer-mode=.*$', 'app.enable-developer-mode=true', text)
else:
    if text and not text.endswith('\n'):
        text += '\n'
    text += 'app.enable-developer-mode=true\n'
prefs.write_text(text)
PY
}

get_latest_release_info() {
  python3 <<PY
import json
import urllib.request

req = urllib.request.Request(
    "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest",
    headers={"User-Agent": "spotify-plus-installer"},
)
with urllib.request.urlopen(req) as response:
    release = json.load(response)

for asset in release.get("assets", []):
    if asset.get("name") == "$ASSET_NAME":
        print((release.get("tag_name") or "").lstrip("v"))
        print(asset["browser_download_url"])
        break
else:
    raise SystemExit("Latest release does not contain asset '$ASSET_NAME'.")
PY
}

show_warning
if ! confirm_install; then
  print_note "Install cancelled."
  exit 0
fi

SPICETIFY_EXE="$(ensure_spicetify)"
CONFIG_FILE="$("$SPICETIFY_EXE" -c 2>/dev/null || true)"
CONFIG_ROOT=""
if [ -n "$CONFIG_FILE" ]; then
  CONFIG_ROOT="$(dirname "$CONFIG_FILE")"
fi
if [ -n "$CONFIG_ROOT" ]; then
  EXTENSIONS_ROOT="$CONFIG_ROOT/Extensions"
else
  EXTENSIONS_ROOT="$("$SPICETIFY_EXE" path -e root)"
fi

if [ -z "$EXTENSIONS_ROOT" ]; then
  printf "%s\n" "Could not resolve the Spicetify extensions directory." >&2
  exit 1
fi

mkdir -p "$EXTENSIONS_ROOT"

print_section "Download"
RELEASE_VERSION=""
ASSET_URL=""
release_info_index=0
while IFS= read -r line; do
  if [ "$release_info_index" -eq 0 ]; then
    RELEASE_VERSION="$line"
  elif [ "$release_info_index" -eq 1 ]; then
    ASSET_URL="$line"
  fi
  release_info_index=$((release_info_index + 1))
done <<EOF
$(get_latest_release_info)
EOF

if [ -z "$RELEASE_VERSION" ] || [ -z "$ASSET_URL" ]; then
  printf "%s\n" "Failed to resolve latest Spotify Plus release metadata." >&2
  exit 1
fi

DESTINATION="$EXTENSIONS_ROOT/$ASSET_NAME"
print_step "Installing Spotify Plus v$RELEASE_VERSION"
print_step "Downloading $ASSET_NAME from the latest release..."
curl -fsSL "$ASSET_URL" -o "$DESTINATION"

print_section "Install"
print_step "Registering extension in Spicetify config..."
"$SPICETIFY_EXE" config extensions "$ASSET_NAME-" extensions "$ASSET_NAME" >/dev/null

print_step "Enabling Spotify developer tools..."
"$SPICETIFY_EXE" enable-devtools >/dev/null || true
enable_developer_mode

print_step "Applying Spicetify changes..."
if [ "$SPICETIFY_WAS_PRESENT" -eq 1 ]; then
  "$SPICETIFY_EXE" update >/dev/null 2>&1 || true
else
  if ! "$SPICETIFY_EXE" backup; then
    print_note "Continuing with existing Spicetify backup state..."
  fi
fi
"$SPICETIFY_EXE" apply
"$SPICETIFY_EXE" restart >/dev/null 2>&1 || true

print_section "Done"
print_step "Spotify Plus v$RELEASE_VERSION installed successfully."
print_muted "Extension path: $DESTINATION"
print_muted "Uninstall later with:"
print_muted "curl -fsSL https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAME/master/uninstall.sh | bash"
