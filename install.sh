#!/usr/bin/env bash
# cc-switch-cli installer for WSL / Linux / macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.sh | bash
set -euo pipefail

REPO="OpenCils/cc-switch-cli"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="cc"

# ---------------------- Detect platform ----------------------
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  OS_NAME="linux" ;;
  darwin) OS_NAME="darwin" ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_NAME="x64" ;;
  aarch64|arm64) ARCH_NAME="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET="${BINARY_NAME}-${OS_NAME}-${ARCH_NAME}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

echo "Downloading ${ASSET} ..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

# ---------------------- Configure PATH ----------------------
add_to_path() {
  local rc_file="$1"
  if [ -f "$rc_file" ] && ! grep -q "${INSTALL_DIR}" "$rc_file" 2>/dev/null; then
    echo "" >> "$rc_file"
    echo "# cc-switch-cli" >> "$rc_file"
    echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$rc_file"
  fi
}

if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  add_to_path "${HOME}/.bashrc"
  add_to_path "${HOME}/.zshrc"
  add_to_path "${HOME}/.profile"
  export PATH="${INSTALL_DIR}:$PATH"
  echo "Added ${INSTALL_DIR} to PATH"
fi

echo ""
echo "cc-switch-cli installed successfully!"
echo "Reopen your terminal and type 'cc' to launch  (or run: source ~/.bashrc)"
