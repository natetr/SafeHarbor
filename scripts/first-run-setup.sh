#!/bin/bash

# SafeHarbor First-Run Setup Wizard
# This script helps configure WiFi settings for first-time installation

set -e

echo ""
echo "========================================"
echo "SafeHarbor First-Run Setup Wizard"
echo "========================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

INSTALL_DIR="/opt/safeharbor"
DB_PATH="${INSTALL_DIR}/safeharbor.db"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
  echo "Error: Database not found at $DB_PATH"
  echo "Please run install.sh first to initialize the database"
  exit 1
fi

echo "This wizard will help you configure your home WiFi settings."
echo "SafeHarbor will automatically connect to your home network on startup."
echo ""
echo "You can change these settings later in the Admin Panel."
echo ""

# Ask if user wants to configure WiFi now
read -p "Configure home WiFi now? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "Skipping WiFi configuration."
  echo "SafeHarbor will use system defaults."
  echo "Configure WiFi in Admin Panel > Network Settings after logging in."
  echo ""
  exit 0
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "WiFi Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Scan for available networks (if possible)
echo "Scanning for available WiFi networks..."
AVAILABLE_NETWORKS=""
if command -v nmcli &> /dev/null; then
  AVAILABLE_NETWORKS=$(nmcli -t -f SSID device wifi list 2>/dev/null | grep -v '^$' | sort -u | head -10 || true)
  if [ -n "$AVAILABLE_NETWORKS" ]; then
    echo ""
    echo "Available networks:"
    echo "$AVAILABLE_NETWORKS" | nl -w2 -s'. '
    echo ""
  fi
fi

# Get WiFi SSID
while true; do
  read -p "Enter WiFi network name (SSID): " WIFI_SSID
  if [ -n "$WIFI_SSID" ]; then
    break
  fi
  echo "SSID cannot be empty. Please try again."
done

# Get WiFi password
while true; do
  read -s -p "Enter WiFi password: " WIFI_PASSWORD
  echo
  if [ -n "$WIFI_PASSWORD" ]; then
    read -s -p "Confirm WiFi password: " WIFI_PASSWORD_CONFIRM
    echo
    if [ "$WIFI_PASSWORD" = "$WIFI_PASSWORD_CONFIRM" ]; then
      break
    fi
    echo "Passwords do not match. Please try again."
  else
    echo "Password cannot be empty. Please try again."
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Configuration Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Network Mode:  Home Network"
echo "WiFi SSID:     $WIFI_SSID"
echo "Password:      ********"
echo ""

read -p "Save this configuration? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "Configuration cancelled."
  echo "SafeHarbor will use system defaults."
  echo ""
  exit 0
fi

echo ""
echo "Saving WiFi configuration to database..."

# Save configuration to database
# First, check if network_config table has any entries
CONFIG_EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM network_config;" 2>/dev/null || echo "0")

if [ "$CONFIG_EXISTS" = "0" ]; then
  # Insert new configuration
  sqlite3 "$DB_PATH" <<EOF
INSERT INTO network_config (
  mode,
  hotspot_ssid,
  hotspot_password,
  hotspot_open,
  hotspot_domain,
  connection_limit,
  home_network_ssid,
  home_network_password,
  captive_portal_enabled,
  created_at
) VALUES (
  'home',
  'SafeHarbor',
  'safeharbor2024',
  0,
  'safeharbor.local',
  10,
  '${WIFI_SSID//\'/\'\'}',
  '${WIFI_PASSWORD//\'/\'\'}',
  0,
  CURRENT_TIMESTAMP
);
EOF
else
  # Update existing configuration
  sqlite3 "$DB_PATH" <<EOF
UPDATE network_config SET
  mode = 'home',
  home_network_ssid = '${WIFI_SSID//\'/\'\'}',
  home_network_password = '${WIFI_PASSWORD//\'/\'\'}'
WHERE id = (SELECT MAX(id) FROM network_config);
EOF
fi

if [ $? -eq 0 ]; then
  echo "✓ WiFi configuration saved successfully"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Setup Complete!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "SafeHarbor will automatically connect to '$WIFI_SSID' on startup."
  echo ""
  echo "Once connected, you can access SafeHarbor at:"
  echo "  • http://safeharbor.local:3000"
  echo "  • Or check your router for the assigned IP address"
  echo ""
  echo "Default admin credentials:"
  echo "  Username: admin"
  echo "  Password: admin"
  echo ""
  echo "⚠️  IMPORTANT: Change the admin password after first login!"
  echo ""
else
  echo "✗ Failed to save configuration"
  echo "You can configure WiFi later in the Admin Panel"
  echo ""
  exit 1
fi
