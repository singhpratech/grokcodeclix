#!/usr/bin/env bash
# Grok Code CLI — one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/singhpratech/grokcodeclix/main/install.sh | bash
#
# What it does:
#   1. Verifies Node.js >= 18 and git are installed.
#   2. Clones (or updates) the repo into ~/.grok-code/grokcodeclix.
#   3. Installs deps and runs the TypeScript build.
#   4. Symlinks the `grok` binary into ~/.local/bin (or /usr/local/bin if writable).
#   5. Prints the next-step prompt to run `grok auth`.

set -euo pipefail

REPO_URL="${GROK_CODE_REPO_URL:-https://github.com/singhpratech/grokcodeclix.git}"
INSTALL_ROOT="${GROK_CODE_HOME:-$HOME/.grok-code}"
INSTALL_DIR="$INSTALL_ROOT/grokcodeclix"
BIN_NAME="grokclix"
BRANCH="${GROK_CODE_BRANCH:-main}"

c_red()   { printf '\033[31m%s\033[0m' "$*"; }
c_green() { printf '\033[32m%s\033[0m' "$*"; }
c_cyan()  { printf '\033[36m%s\033[0m' "$*"; }
c_dim()   { printf '\033[2m%s\033[0m'  "$*"; }
c_bold()  { printf '\033[1m%s\033[0m'  "$*"; }
c_saffron() { printf '\033[38;2;255;153;51m%s\033[0m' "$*"; }
c_indiagreen() { printf '\033[38;2;19;136;8m%s\033[0m'  "$*"; }

banner() {
  echo
  echo "  $(c_saffron '████████  ██████   ██████  ██   ██')"
  echo "  $(c_saffron '   ██     ██  ██   ██  ██  ██ ██ ')"
  printf '  '; c_saffron '   ██     '; printf '%s' '██████   ██  ██  '; c_indiagreen ' ███  '; echo
  echo "  $(c_indiagreen '   ██     ██  ██   ██  ██  ██ ██ ')"
  echo "  $(c_indiagreen '   ██     ██████   ██████   ██   ██')"
  echo
  echo "  $(c_bold 'Grok Code CLI installer')"
  echo "  $(c_dim 'Claude Code, but for xAI Grok models')"
  echo
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$(c_red '✗')  Missing required dependency: $(c_bold "$1")"
    echo "    $2"
    exit 1
  fi
}

check_node_version() {
  local v
  v=$(node --version 2>/dev/null | sed 's/^v//' || true)
  if [ -z "$v" ]; then
    echo "$(c_red '✗')  Node.js is not installed."
    echo "    Install Node.js >= 18 from https://nodejs.org or via your package manager."
    exit 1
  fi
  local major="${v%%.*}"
  if [ "$major" -lt 18 ]; then
    echo "$(c_red '✗')  Node.js $v is too old. Need >= 18."
    exit 1
  fi
  echo "  $(c_green '✓') Node $v"
}

clone_or_update() {
  mkdir -p "$INSTALL_ROOT"
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  $(c_cyan '↻') Updating existing checkout in $INSTALL_DIR"
    (cd "$INSTALL_DIR" && git fetch --quiet origin "$BRANCH" && git checkout --quiet "$BRANCH" && git reset --hard --quiet "origin/$BRANCH")
  else
    echo "  $(c_cyan '↓') Cloning $REPO_URL into $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
    git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
}

install_and_build() {
  echo "  $(c_cyan '⚙') Installing npm dependencies"
  (cd "$INSTALL_DIR" && npm install --silent --no-audit --no-fund)
  echo "  $(c_cyan '⚙') Building TypeScript"
  (cd "$INSTALL_DIR" && npm run build --silent)
  chmod +x "$INSTALL_DIR/dist/cli.js"
}

choose_bin_dir() {
  # Prefer ~/.local/bin; fall back to /usr/local/bin if it exists and is writable.
  local d
  for d in "$HOME/.local/bin" "/usr/local/bin"; do
    if [ -d "$d" ] && [ -w "$d" ]; then
      echo "$d"
      return
    fi
  done
  mkdir -p "$HOME/.local/bin"
  echo "$HOME/.local/bin"
}

link_binary() {
  local bin_dir
  bin_dir="$(choose_bin_dir)"
  local target="$bin_dir/$BIN_NAME"
  ln -sf "$INSTALL_DIR/dist/cli.js" "$target"
  echo "  $(c_green '✓') Linked $(c_bold "$target") → $INSTALL_DIR/dist/cli.js"
  if ! command -v "$BIN_NAME" >/dev/null 2>&1; then
    echo
    echo "  $(c_dim "Note: $bin_dir is not on your PATH.")"
    echo "  $(c_dim "Add this to your shell profile (~/.bashrc or ~/.zshrc):")"
    echo
    echo "    export PATH=\"$bin_dir:\$PATH\""
    echo
  fi
}

main() {
  banner

  echo "  $(c_bold 'Pre-flight checks')"
  require git "Install git from https://git-scm.com or your package manager."
  require node "Install Node.js >= 18 from https://nodejs.org"
  require npm  "npm ships with Node.js — reinstall Node if it is missing."
  check_node_version
  echo

  echo "  $(c_bold 'Fetching source')"
  clone_or_update
  echo

  echo "  $(c_bold 'Building')"
  install_and_build
  echo

  echo "  $(c_bold 'Linking')"
  link_binary
  echo

  echo "  $(c_indiagreen '✓ Installed!')"
  echo
  echo "  Next:"
  echo "    $(c_bold "$BIN_NAME auth")        $(c_dim '# sign in (xAI / OpenRouter / paste key)')"
  echo "    $(c_bold "$BIN_NAME")             $(c_dim '# start an interactive session')"
  echo "    $(c_bold "$BIN_NAME chat \"hi\"")    $(c_dim '# one-shot prompt')"
  echo
}

main "$@"
