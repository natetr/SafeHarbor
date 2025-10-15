#!/bin/bash

# SafeHarbor Permission Fix Script
# Fixes common permission and systemd service issues after updates

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
echo "You can now start the service with:"
echo "  sudo systemctl start safeharbor"
echo ""
echo "Or restart it with:"
echo "  sudo systemctl restart safeharbor"
echo ""
