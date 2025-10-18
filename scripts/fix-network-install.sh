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

# Detect SafeHarbor installation directory
if [ -f "/home/nate/safeharbor/safeharbor.db" ]; then
  INSTALL_DIR="/home/nate/safeharbor"
elif [ -f "/opt/safeharbor/safeharbor.db" ]; then
  INSTALL_DIR="/opt/safeharbor"
elif [ -f "$(pwd)/safeharbor.db" ]; then
  INSTALL_DIR="$(pwd)"
else
  echo "❌ Could not find SafeHarbor installation"
  echo "   Please run this script from the SafeHarbor directory"
  exit 1
fi

DB_PATH="$INSTALL_DIR/safeharbor.db"
echo "Found SafeHarbor at: $INSTALL_DIR"
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
sqlite3 "$DB_PATH" <<EOF
-- Add updated_at column if it doesn't exist
ALTER TABLE network_config ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;
EOF

if [ $? -eq 0 ]; then
  echo "✓ Database column added successfully"
else
  echo "⚠️  Column may already exist (this is OK)"
fi
echo ""

echo "Step 4: Pulling latest code from GitHub..."
cd "$INSTALL_DIR"
git fetch origin network-updates
git reset --hard origin/network-updates

if [ $? -eq 0 ]; then
  echo "✓ Code updated successfully"
else
  echo "❌ Failed to update code from GitHub"
  exit 1
fi
echo ""

echo "Step 5: Verifying fixes..."
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

echo "Step 6: Restarting SafeHarbor service..."
systemctl start safeharbor
sleep 3
systemctl status safeharbor --no-pager -l
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
