#!/usr/bin/env bash
# cc-switch-cli 安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/OWNER/cc-switch-cli/main/install.sh | bash
set -euo pipefail

REPO="OpenCils/cc-switch-cli"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="cc"

# ---------------------- 检测平台 ----------------------
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  OS_NAME="linux" ;;
  darwin) OS_NAME="darwin" ;;
  *)
    echo "❌ 不支持的系统: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_NAME="x64" ;;
  aarch64|arm64) ARCH_NAME="arm64" ;;
  *)
    echo "❌ 不支持的架构: $ARCH"
    exit 1
    ;;
esac

ASSET="${BINARY_NAME}-${OS_NAME}-${ARCH_NAME}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

echo "⬇️  下载 ${ASSET} ..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

# ---------------------- 配置 PATH ----------------------
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
  echo "✅ 已将 ${INSTALL_DIR} 添加到 PATH"
fi

echo ""
echo "✅ cc-switch-cli 安装成功！"
echo "   运行 'cc' 启动（新终端窗口生效，或执行 source ~/.bashrc）"
