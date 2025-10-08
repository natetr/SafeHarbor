#!/bin/bash

# SafeHarbor Kiwix-Tools Installer for Raspberry Pi
# Automatically detects architecture and installs the correct kiwix-serve binary

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"
KIWIX_VERSION="3.7.0-2"

echo -e "${BLUE}SafeHarbor Kiwix-Tools Installer${NC}"
echo "===================================="
echo ""

# Detect architecture
echo "Detecting system architecture..."
ARCH=$(uname -m)
echo "System architecture: $ARCH"

# Map architecture to kiwix-tools package name
# Note: kiwix uses 'aarch64' in filenames, not 'arm64'
case "$ARCH" in
    aarch64|arm64)
        KIWIX_ARCH="aarch64"
        KIWIX_PACKAGE="kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}.tar.gz"
        ;;
    armv7l|armv6l)
        KIWIX_ARCH="armhf"
        KIWIX_PACKAGE="kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}.tar.gz"
        ;;
    x86_64)
        KIWIX_ARCH="x86_64"
        KIWIX_PACKAGE="kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}.tar.gz"
        ;;
    *)
        echo -e "${RED}✗ Unsupported architecture: $ARCH${NC}"
        echo ""
        echo "Supported architectures:"
        echo "  - aarch64/arm64 (Raspberry Pi 3/4/5 64-bit)"
        echo "  - armv7l/armv6l (Raspberry Pi 32-bit)"
        echo "  - x86_64 (Intel/AMD 64-bit)"
        echo ""
        echo "Attempting to install from apt..."

        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y kiwix-tools

            if command -v kiwix-serve &> /dev/null; then
                echo -e "${GREEN}✓ Installed kiwix-serve from apt${NC}"
                echo ""
                echo "Add this to your .env file:"
                echo "KIWIX_SERVE_PATH=$(which kiwix-serve)"
                exit 0
            fi
        fi

        echo -e "${RED}✗ Could not install kiwix-tools${NC}"
        exit 1
        ;;
esac

echo -e "${GREEN}✓${NC} Will install: $KIWIX_PACKAGE"
echo ""

# Create bin directory
mkdir -p "$BIN_DIR"

# Check if kiwix-serve already exists
if [ -f "$BIN_DIR/kiwix-serve" ]; then
    echo -e "${YELLOW}●${NC} kiwix-serve already exists in bin/"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled"
        exit 0
    fi
    rm -f "$BIN_DIR/kiwix-serve"
fi

# Download kiwix-tools
DOWNLOAD_URL="https://download.kiwix.org/release/kiwix-tools/${KIWIX_PACKAGE}"
TMP_DIR=$(mktemp -d)
TMP_FILE="$TMP_DIR/$KIWIX_PACKAGE"

echo "Downloading from: $DOWNLOAD_URL"
echo "This may take a few minutes..."

if command -v curl &> /dev/null; then
    curl -L -o "$TMP_FILE" "$DOWNLOAD_URL" --progress-bar
elif command -v wget &> /dev/null; then
    wget -O "$TMP_FILE" "$DOWNLOAD_URL" --show-progress
else
    echo -e "${RED}✗ Neither curl nor wget found. Please install one of them.${NC}"
    exit 1
fi

if [ ! -f "$TMP_FILE" ]; then
    echo -e "${RED}✗ Download failed${NC}"
    rm -rf "$TMP_DIR"
    exit 1
fi

echo -e "${GREEN}✓${NC} Downloaded successfully"
echo ""

# Extract
echo "Extracting..."
tar -xzf "$TMP_FILE" -C "$TMP_DIR"

# Find kiwix-serve binary in extracted files
EXTRACTED_DIR=$(find "$TMP_DIR" -type d -name "kiwix-tools*" | head -n 1)

if [ -z "$EXTRACTED_DIR" ]; then
    echo -e "${RED}✗ Could not find extracted directory${NC}"
    rm -rf "$TMP_DIR"
    exit 1
fi

if [ ! -f "$EXTRACTED_DIR/kiwix-serve" ]; then
    echo -e "${RED}✗ kiwix-serve binary not found in extracted files${NC}"
    rm -rf "$TMP_DIR"
    exit 1
fi

# Copy to bin directory
cp "$EXTRACTED_DIR/kiwix-serve" "$BIN_DIR/"
chmod +x "$BIN_DIR/kiwix-serve"

# Cleanup
rm -rf "$TMP_DIR"

echo -e "${GREEN}✓${NC} Installed kiwix-serve to $BIN_DIR/kiwix-serve"
echo ""

# Verify installation
echo "Verifying installation..."
if "$BIN_DIR/kiwix-serve" --version &> /dev/null; then
    VERSION=$("$BIN_DIR/kiwix-serve" --version 2>&1 | head -n 1)
    echo -e "${GREEN}✓${NC} kiwix-serve is working!"
    echo "Version: $VERSION"
else
    echo -e "${RED}✗${NC} kiwix-serve installed but not working"
    echo "The binary may be incompatible with your system"
    exit 1
fi

echo ""
echo -e "${GREEN}Installation completed successfully!${NC}"
echo ""
echo "kiwix-serve is ready to use at: $BIN_DIR/kiwix-serve"
