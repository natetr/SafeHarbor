#!/bin/bash

# SafeHarbor Production Setup Script
# Complete automated installation for Raspberry Pi and Linux servers

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_ROOT="/var/safeharbor"
APP_USER="${SUDO_USER:-$USER}"  # Use the user who ran sudo, or current user

echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     SafeHarbor Production Setup      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
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

# =============================================================================
# Step 2: Check/Create .env file
# =============================================================================
echo ""
echo "Checking environment configuration..."

cd "$PROJECT_ROOT"

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo -e "${YELLOW}●${NC} .env file not found, creating from .env.example..."
        sudo -u "$APP_USER" cp .env.example .env
        echo -e "${GREEN}✓${NC} Created .env file"
        echo -e "${YELLOW}⚠  Please edit .env and change the default passwords!${NC}"
    else
        echo -e "${RED}✗${NC} .env.example not found!"
        echo "Please create a .env file manually"
        exit 1
    fi
else
    echo -e "${GREEN}✓${NC} .env file exists"
fi

# =============================================================================
# Step 3: Install Dependencies
# =============================================================================
echo ""
echo "Installing dependencies..."

# Check if running as the app user for npm commands
if [ -d "node_modules" ]; then
    echo -e "${YELLOW}●${NC} Dependencies already installed"
else
    echo "Installing server dependencies..."
    sudo -u "$APP_USER" npm install
    echo -e "${GREEN}✓${NC} Server dependencies installed"
fi

if [ -d "client/node_modules" ]; then
    echo -e "${YELLOW}●${NC} Client dependencies already installed"
else
    echo "Installing client dependencies..."
    cd "$PROJECT_ROOT/client"
    sudo -u "$APP_USER" npm install
    cd "$PROJECT_ROOT"
    echo -e "${GREEN}✓${NC} Client dependencies installed"
fi

# =============================================================================
# Step 4: Build Frontend
# =============================================================================
echo ""
echo "Building frontend..."

if [ -d "client/dist" ]; then
    echo -e "${YELLOW}●${NC} Frontend already built"
    read -p "Rebuild? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$PROJECT_ROOT/client"
        sudo -u "$APP_USER" npm run build
        cd "$PROJECT_ROOT"
        echo -e "${GREEN}✓${NC} Frontend rebuilt"
    fi
else
    cd "$PROJECT_ROOT/client"
    sudo -u "$APP_USER" npm run build
    cd "$PROJECT_ROOT"
    echo -e "${GREEN}✓${NC} Frontend built"
fi

# =============================================================================
# Step 5: Install Kiwix-Tools
# =============================================================================
echo ""
echo "Checking kiwix-serve..."

if [ -f "$PROJECT_ROOT/bin/kiwix-serve" ]; then
    # Check if it's the right architecture
    FILE_TYPE=$(file "$PROJECT_ROOT/bin/kiwix-serve" | head -n 1)
    if echo "$FILE_TYPE" | grep -q "Mach-O"; then
        echo -e "${YELLOW}⚠${NC}  Found macOS binary (wrong platform)"
        echo "Installing correct kiwix-serve for Linux..."
        sudo -u "$APP_USER" bash "$PROJECT_ROOT/scripts/install-kiwix.sh"
    elif echo "$FILE_TYPE" | grep -q "ELF"; then
        echo -e "${GREEN}✓${NC} kiwix-serve binary exists (Linux)"
    else
        echo -e "${YELLOW}⚠${NC}  Unknown kiwix-serve binary type"
        read -p "Reinstall? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo -u "$APP_USER" bash "$PROJECT_ROOT/scripts/install-kiwix.sh"
        fi
    fi
else
    echo "Installing kiwix-serve..."
    sudo -u "$APP_USER" bash "$PROJECT_ROOT/scripts/install-kiwix.sh"
fi

# =============================================================================
# Setup Complete
# =============================================================================
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup Completed Successfully! ✓    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo "Installation Summary:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓${NC} Data directories created in: $DATA_ROOT"
echo -e "${GREEN}✓${NC} Permissions configured for user: $APP_USER"
echo -e "${GREEN}✓${NC} Environment configuration: .env"
echo -e "${GREEN}✓${NC} Dependencies installed"
echo -e "${GREEN}✓${NC} Frontend built"
echo -e "${GREEN}✓${NC} Kiwix-serve configured"
echo ""
echo "Directory structure:"
ls -lah "$DATA_ROOT" | tail -n +4
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Review and customize .env file (especially passwords!)"
echo "   nano .env"
echo ""
echo "2. Start SafeHarbor:"
echo "   npm start"
echo ""
echo "3. Access the interface at:"
echo "   http://localhost:3000"
echo "   (or http://$(hostname -I | awk '{print $1}'):3000 from other devices)"
echo ""
echo "4. Login with:"
echo "   Username: admin"
echo "   Password: (check your .env file)"
echo ""
echo -e "${YELLOW}⚠  Security Reminder:${NC}"
echo "   - Change default passwords in .env"
echo "   - Generate secure JWT_SECRET: openssl rand -base64 32"
echo ""
echo "For systemd auto-start, see: README-DEPLOYMENT.md"
echo ""
