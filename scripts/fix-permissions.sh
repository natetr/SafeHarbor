#!/bin/bash

# SafeHarbor Permission Fix Script
# Handles dev-to-production transition and fixes permission issues

set -e

echo "================================"
echo "SafeHarbor Permission Fix"
echo "================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

INSTALL_DIR="/opt/safeharbor"
CURRENT_USER="${SUDO_USER:-$USER}"

# Detect if we're transitioning from dev to production
if [ -d "$INSTALL_DIR" ]; then
  DB_OWNER=$(stat -c '%U' "${INSTALL_DIR}/safeharbor.db" 2>/dev/null || stat -f '%Su' "${INSTALL_DIR}/safeharbor.db" 2>/dev/null || echo "unknown")

  if [ "$DB_OWNER" != "safeharbor" ] && [ "$DB_OWNER" != "root" ] && [ "$DB_OWNER" != "unknown" ]; then
    echo "⚠️  Detected development installation (owned by $DB_OWNER)"
    echo "   This script will transition to production mode (systemd service)"
    echo ""
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
    echo ""
    echo "Transitioning from dev to production mode..."
    DEV_TO_PROD=true
  else
    echo "Detected production installation"
    DEV_TO_PROD=false
  fi
else
  echo "Fresh installation detected"
  DEV_TO_PROD=false
fi

echo ""

echo "Fixing directory permissions..."

# Create all required directories
mkdir -p ${INSTALL_DIR}/data
mkdir -p ${INSTALL_DIR}/content
mkdir -p ${INSTALL_DIR}/zim
mkdir -p ${INSTALL_DIR}/uploads
mkdir -p /var/safeharbor/data
mkdir -p /var/safeharbor/content
mkdir -p /var/safeharbor/zim
mkdir -p /var/log/safeharbor

echo "✓ Directories created"

# Set ownership to safeharbor user
echo "Setting ownership to safeharbor user..."
chown -R safeharbor:safeharbor ${INSTALL_DIR}
chown -R safeharbor:safeharbor /var/safeharbor
chown -R safeharbor:safeharbor /var/log/safeharbor

echo "✓ Ownership set"

# Fix database file permissions specifically
if [ -f "${INSTALL_DIR}/safeharbor.db" ]; then
  echo "Fixing database permissions..."
  chown safeharbor:safeharbor ${INSTALL_DIR}/safeharbor.db*
  chmod 664 ${INSTALL_DIR}/safeharbor.db*
  echo "✓ Database permissions fixed"
fi

# Set proper directory permissions
chmod 755 ${INSTALL_DIR}
chmod -R u+w ${INSTALL_DIR}

echo "✓ Directory permissions set"

# Stop any manually running instances if transitioning to production
if [ "$DEV_TO_PROD" = true ]; then
  echo ""
  echo "Stopping any manually running instances..."

  # Kill any node processes running SafeHarbor
  pkill -f "node.*server/index.js" || true
  pkill -f "nodemon.*server/index.js" || true

  echo "✓ Stopped manual instances"
fi

# Fix systemd service file
SERVICE_FILE="/etc/systemd/system/safeharbor.service"

if [ -f "$SERVICE_FILE" ]; then
  echo "Checking systemd service configuration..."

  # Check if ReadWritePaths needs updating
  if grep -q "ReadWritePaths=.*\/home\/pi\/SafeHarbor" "$SERVICE_FILE"; then
    echo "Fixing ReadWritePaths in service file..."

    # Create backup
    cp "$SERVICE_FILE" "${SERVICE_FILE}.backup-$(date +%Y%m%d-%H%M%S)"

    # Update ReadWritePaths to only include existing directories
    sed -i 's|ReadWritePaths=.*|ReadWritePaths=/opt/safeharbor /var/safeharbor /var/log/safeharbor /tmp|' "$SERVICE_FILE"

    echo "✓ Service file updated"

    # Reload systemd
    systemctl daemon-reload
    echo "✓ Systemd configuration reloaded"
  else
    echo "✓ Service file looks correct"
  fi

  # Move StartLimitIntervalSec to [Unit] section if it's in [Service]
  if grep -A 20 "\[Service\]" "$SERVICE_FILE" | grep -q "StartLimitIntervalSec"; then
    echo "Fixing StartLimitIntervalSec location..."

    # Remove from Service section
    sed -i '/^\[Service\]/,/^\[.*\]/ { /StartLimitIntervalSec/d; }' "$SERVICE_FILE"

    # Add to Unit section if not already there
    if ! grep -A 10 "\[Unit\]" "$SERVICE_FILE" | grep -q "StartLimitIntervalSec"; then
      sed -i '/^\[Unit\]/a StartLimitIntervalSec=600' "$SERVICE_FILE"
    fi

    echo "✓ StartLimitIntervalSec moved to [Unit] section"

    systemctl daemon-reload
    echo "✓ Systemd configuration reloaded"
  fi
else
  echo "⚠️  Warning: Service file not found at $SERVICE_FILE"
  echo "   This is expected if running in development mode"
fi

echo ""
echo "================================"
echo "Permission Fix Complete!"
echo "================================"
echo ""

if [ "$DEV_TO_PROD" = true ]; then
  echo "✅ Successfully transitioned to production mode!"
  echo ""
  echo "The system is now configured to:"
  echo "  - Run as systemd service (starts automatically on boot)"
  echo "  - Run as 'safeharbor' user (not your personal account)"
  echo "  - Store data in /opt/safeharbor"
  echo ""
  echo "To manage the service:"
  echo "  Start:   sudo systemctl start safeharbor"
  echo "  Stop:    sudo systemctl stop safeharbor"
  echo "  Restart: sudo systemctl restart safeharbor"
  echo "  Status:  sudo systemctl status safeharbor"
  echo "  Logs:    sudo journalctl -u safeharbor -f"
  echo ""
  echo "Starting the service now..."
  systemctl start safeharbor
  echo ""
  echo "Service started! Check status with:"
  echo "  sudo systemctl status safeharbor"
else
  echo "You can now start the service with:"
  echo "  sudo systemctl start safeharbor"
  echo ""
  echo "Or restart it with:"
  echo "  sudo systemctl restart safeharbor"
fi
echo ""
