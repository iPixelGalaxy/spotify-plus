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

print_muted() {
  printf "%s%s%s\n" "$GRAY" "$1" "$RESET"
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

  printf "%s\n" "Spicetify could not be found." >&2
  exit 1
}

confirm_clear_user_settings() {
  printf "\n"
  print_warn "⚠️ Clear All User Settings?"
  print_muted "This resets Spotify developer mode, sessions, and cached XPUI state."
  print_muted "Default: No"
  printf "Clear all user settings too? [y/N] "
  local answer
  read -r answer || true
  case "${answer:-}" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

disable_developer_mode() {
  local prefs_path
  case "$(uname -s)" in
    Darwin) prefs_path="$HOME/Library/Application Support/Spotify/prefs" ;;
    *) prefs_path="$HOME/.config/spotify/prefs" ;;
  esac

  if [ ! -f "$prefs_path" ]; then
    return
  fi

  python3 - "$prefs_path" <<'PY'
from pathlib import Path
import re
import sys

prefs = Path(sys.argv[1])
text = prefs.read_text()
text = re.sub(r'(?m)^app\.enable-developer-mode=.*$', 'app.enable-developer-mode=false', text)
prefs.write_text(text)
PY
}

clear_spotify_client_state() {
  disable_developer_mode

  case "$(uname -s)" in
    Darwin)
      rm -rf "$HOME/Library/Application Support/Spotify/PersistentCache/Session Storage"
      rm -rf "$HOME/Library/Application Support/Spotify/PersistentCache/Sessions"
      ;;
    *)
      rm -rf "$HOME/.config/spotify/Session Storage"
      rm -rf "$HOME/.config/spotify/Sessions"
      ;;
  esac
}

SPICETIFY_EXE="$(get_spicetify)"
EXTENSIONS_ROOT="$("$SPICETIFY_EXE" path -e root)"
DESTINATION="$EXTENSIONS_ROOT/$ASSET_NAME"

print_section "Uninstall"
print_step "Removing Spotify Plus from Spicetify config..."
"$SPICETIFY_EXE" config extensions "$ASSET_NAME-" >/dev/null

if [ -f "$DESTINATION" ]; then
  print_step "Removing installed extension file..."
  rm -f "$DESTINATION"
fi

if confirm_clear_user_settings; then
  print_section "Reset"
  print_step "Clearing Spotify client state..."
  clear_spotify_client_state
fi

print_section "Apply"
print_step "Applying Spicetify changes..."
"$SPICETIFY_EXE" backup apply
"$SPICETIFY_EXE" apply

print_section "Done"
print_step "Spotify Plus uninstalled."
print_muted "Install again later with:"
print_muted "curl -fsSL https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAME/master/install.sh | bash"
