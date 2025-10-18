#!/bin/bash

# SafeHarbor Network Fix Script
# Fixes database schema and updates code with sudo permissions

set -e

echo "=========================================="
echo "SafeHarbor Network Configuration Fix"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root: sudo bash scripts/fix-network-install.sh"
  exit 1
fi

# Find the git repository (where we're running from)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
if [ ! -d "$SCRIPT_DIR/.git" ]; then
  echo "❌ Not running from a git repository"
  echo "   Please run from the SafeHarbor git clone: ~/safeharbor"
  exit 1
fi

echo "Git repository found at: $SCRIPT_DIR"

# Find the installation directory (where service runs)
if [ -f "/opt/safeharbor/safeharbor.db" ]; then
  INSTALL_DIR="/opt/safeharbor"
elif [ -f "$SCRIPT_DIR/safeharbor.db" ]; then
  INSTALL_DIR="$SCRIPT_DIR"
else
  echo "❌ Could not find SafeHarbor installation"
  echo "   Looking for safeharbor.db in /opt/safeharbor or $SCRIPT_DIR"
  exit 1
fi

DB_PATH="$INSTALL_DIR/safeharbor.db"
echo "Installation found at: $INSTALL_DIR"
echo ""

echo "Step 1: Stopping SafeHarbor service..."
systemctl stop safeharbor
echo "✓ Service stopped"
echo ""

echo "Step 2: Backing up database..."
cp "$DB_PATH" "$DB_PATH.backup-before-fix-$(date +%Y%m%d-%H%M%S)"
echo "✓ Database backed up"
echo ""

echo "Step 3: Adding missing database column..."
# SQLite doesn't allow CURRENT_TIMESTAMP in ALTER TABLE, so we add NULL then update
sqlite3 "$DB_PATH" <<EOF
ALTER TABLE network_config ADD COLUMN updated_at DATETIME;
UPDATE network_config SET updated_at = datetime('now') WHERE updated_at IS NULL;
EOF

if [ $? -eq 0 ]; then
  echo "✓ Database column added successfully"
else
  echo "⚠️  Column may already exist (this is OK)"
fi
echo ""

echo "Step 4: Pulling latest code from GitHub..."
cd "$SCRIPT_DIR"
git fetch origin network-updates
git reset --hard origin/network-updates

if [ $? -eq 0 ]; then
  echo "✓ Code updated in git repository"
else
  echo "❌ Failed to update code from GitHub"
  exit 1
fi
echo ""

# If installation is in a different location, copy the updated files
if [ "$INSTALL_DIR" != "$SCRIPT_DIR" ]; then
  echo "Step 5: Copying updated files to installation directory..."

  # Copy the critical fixed files
  cp "$SCRIPT_DIR/server/services/networkManager.js" "$INSTALL_DIR/server/services/"
  cp "$SCRIPT_DIR/server/database/init.js" "$INSTALL_DIR/server/database/"

  echo "✓ Files copied to $INSTALL_DIR"
  echo ""
  STEP_NUM=6
else
  echo "Step 5: Skipped (installation is same as git repo)"
  echo ""
  STEP_NUM=5
fi

echo "Step $STEP_NUM: Verifying fixes..."
if grep -q "sudo ip link set" "$INSTALL_DIR/server/services/networkManager.js"; then
  echo "✓ Network manager has sudo permissions"
else
  echo "❌ Network manager doesn't have sudo - something went wrong"
  exit 1
fi

if grep -q "ALTER TABLE network_config ADD COLUMN updated_at" "$INSTALL_DIR/server/database/init.js"; then
  echo "✓ Database migration code is present"
else
  echo "❌ Database migration missing - something went wrong"
  exit 1
fi
echo ""

STEP_NUM=$((STEP_NUM + 1))
echo "Step $STEP_NUM: Restarting SafeHarbor service..."
systemctl start safeharbor
sleep 3
systemctl status safeharbor --no-pager -l || true
echo ""

echo "=========================================="
echo "✅ Fix Complete!"
echo "=========================================="
echo ""
echo "The following issues have been fixed:"
echo "  ✓ Database 'updated_at' column added"
echo "  ✓ Network commands now use sudo"
echo ""
echo "You should now be able to:"
echo "  • Save network configuration"
echo "  • Switch between hotspot and WiFi modes"
echo "  • Scan and connect to WiFi networks"
echo ""
echo "Check the logs: sudo journalctl -u safeharbor -f"
echo ""
