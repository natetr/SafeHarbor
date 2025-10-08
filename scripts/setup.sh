#!/bin/bash

# SafeHarbor Production Setup Script
# This script creates the necessary directories and sets permissions for SafeHarbor to run in production

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DATA_ROOT="/var/safeharbor"
APP_USER="${SUDO_USER:-$USER}"  # Use the user who ran sudo, or current user

echo -e "${GREEN}SafeHarbor Production Setup${NC}"
echo "========================================"
echo ""

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then
   echo -e "${RED}Error: This script must be run with sudo${NC}"
   echo "Usage: sudo ./scripts/setup.sh"
   exit 1
fi

echo "Creating directory structure..."

# Create all necessary directories
directories=(
    "$DATA_ROOT"
    "$DATA_ROOT/data"
    "$DATA_ROOT/content"
    "$DATA_ROOT/zim"
)

for dir in "${directories[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo -e "${GREEN}✓${NC} Created: $dir"
    else
        echo -e "${YELLOW}●${NC} Exists: $dir"
    fi
done

echo ""
echo "Setting permissions..."

# Set ownership to the app user
chown -R "$APP_USER:$APP_USER" "$DATA_ROOT"
echo -e "${GREEN}✓${NC} Set owner to: $APP_USER"

# Set directory permissions (755 = rwxr-xr-x)
chmod -R 755 "$DATA_ROOT"
echo -e "${GREEN}✓${NC} Set permissions to: 755"

# Verify setup
echo ""
echo "Verifying setup..."
if [ -w "$DATA_ROOT" ]; then
    echo -e "${GREEN}✓${NC} Directory is writable"
else
    echo -e "${RED}✗${NC} Directory is NOT writable"
    exit 1
fi

echo ""
echo -e "${GREEN}Setup completed successfully!${NC}"
echo ""
echo "Directory structure:"
ls -lah "$DATA_ROOT"
echo ""
echo "You can now start SafeHarbor with:"
echo "  npm start"
