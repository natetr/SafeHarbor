#!/bin/bash

# SafeHarbor - Update kiwix-tools to fix large ZIM file crashes
# This script updates kiwix-serve to version 3.7.0-2 with libzim 9.2.0+
# which fixes the MMapException crash with large ZIM files (>2GB)

set -e

echo "========================================="
echo "SafeHarbor - kiwix-tools Update"
echo "========================================="
echo ""
echo "This will update kiwix-tools to version 3.7.0-2"
echo "with libzim 9.2.0+ to fix crashes with large ZIM files"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

# Detect architecture
ARCH=$(uname -m)
echo "Detected architecture: $ARCH"

if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  KIWIX_ARCH="aarch64"
elif [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "armhf" ]; then
  KIWIX_ARCH="armhf"
elif [ "$ARCH" = "x86_64" ]; then
  KIWIX_ARCH="x86_64"
else
  echo "Error: Unsupported architecture: $ARCH"
  echo "Supported: aarch64, armhf, x86_64"
  exit 1
fi

KIWIX_VERSION="3.7.0-2"

# Check current version
echo ""
echo "Current kiwix-serve version:"
if command -v kiwix-serve &> /dev/null; then
  kiwix-serve --version | grep -E "kiwix-tools|libzim" || true
else
  echo "kiwix-serve not found"
fi

echo ""
read -p "Continue with update? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Update cancelled"
  exit 0
fi

# Download kiwix-tools
KIWIX_URL="https://download.kiwix.org/release/kiwix-tools/kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}.tar.gz"

echo ""
echo "Downloading kiwix-tools from:"
echo "$KIWIX_URL"
echo ""

cd /tmp
curl -L -o kiwix-tools.tar.gz "$KIWIX_URL"

if [ $? -ne 0 ]; then
  echo "Error: Failed to download kiwix-tools"
  exit 1
fi

# Extract
echo "Extracting..."
tar -xzf kiwix-tools.tar.gz

# Find extracted directory
KIWIX_DIR=$(find /tmp -maxdepth 1 -type d -name "kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}" | head -n 1)

if [ ! -d "$KIWIX_DIR" ]; then
  echo "Error: Could not find extracted directory"
  exit 1
fi

# Backup old binaries if they exist
if [ -f "/usr/local/bin/kiwix-serve" ]; then
  echo "Backing up old kiwix-serve to /usr/local/bin/kiwix-serve.old"
  cp /usr/local/bin/kiwix-serve /usr/local/bin/kiwix-serve.old
fi

# Install new binaries
echo "Installing kiwix-tools to /usr/local/bin..."
mkdir -p /usr/local/bin
cp "$KIWIX_DIR"/kiwix-* /usr/local/bin/
chmod +x /usr/local/bin/kiwix-*

# Cleanup
rm -f /tmp/kiwix-tools.tar.gz
rm -rf "$KIWIX_DIR"

# Verify installation
echo ""
echo "========================================="
echo "Update Complete!"
echo "========================================="
echo ""
echo "New kiwix-serve version:"
/usr/local/bin/kiwix-serve --version | grep -E "kiwix-tools|libzim"

echo ""
echo "IMPORTANT: Restart SafeHarbor for changes to take effect:"
echo "  sudo systemctl restart safeharbor"
echo ""
echo "Or if running in development mode, restart the server manually."
echo ""
