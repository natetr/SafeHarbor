#!/bin/bash

# SafeHarbor Network Configuration Startup Script
# This script applies the saved network configuration on system boot
# It should be run by the systemd service on Raspberry Pi

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${DATABASE_PATH:-$PROJECT_DIR/safeharbor.db}"

echo "==============================================="
echo "SafeHarbor Network Configuration Startup"
echo "==============================================="
echo "Database: $DB_PATH"
echo ""

# Check if running on Raspberry Pi
if [ ! -f /proc/cpuinfo ]; then
  echo "Not running on Linux - network configuration skipped"
  exit 0
fi

if ! grep -q "Raspberry Pi" /proc/cpuinfo && ! grep -q "BCM" /proc/cpuinfo; then
  echo "Not running on Raspberry Pi - network configuration skipped"
  exit 0
fi

echo "Raspberry Pi detected"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
  echo "Database not found at $DB_PATH - skipping network configuration"
  exit 0
fi

# Check if required tools are installed
MISSING_TOOLS=""
for tool in hostapd dnsmasq wpa_supplicant ip sqlite3; do
  if ! command -v $tool &> /dev/null; then
    MISSING_TOOLS="$MISSING_TOOLS $tool"
  fi
done

if [ -n "$MISSING_TOOLS" ]; then
  echo "Warning: Missing required tools:$MISSING_TOOLS"
  echo "Network configuration cannot be applied"
  echo "Run install.sh to install dependencies"
  exit 0
fi

# Read network configuration from database
echo "Reading network configuration..."
NETWORK_MODE=$(sqlite3 "$DB_PATH" "SELECT mode FROM network_config ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "")

if [ -z "$NETWORK_MODE" ]; then
  echo "No network configuration found in database"
  echo "Using default settings (no network changes)"
  exit 0
fi

echo "Network mode: $NETWORK_MODE"

# Apply network configuration based on mode
if [ "$NETWORK_MODE" = "hotspot" ]; then
  echo ""
  echo "Applying Hotspot Mode configuration..."
  echo "This will configure the Pi as a Wi-Fi access point"

  # Read hotspot settings from database
  HOTSPOT_SSID=$(sqlite3 "$DB_PATH" "SELECT hotspot_ssid FROM network_config ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "SafeHarbor")
  HOTSPOT_PASSWORD=$(sqlite3 "$DB_PATH" "SELECT hotspot_password FROM network_config ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "safeharbor2024")
  CONNECTION_LIMIT=$(sqlite3 "$DB_PATH" "SELECT connection_limit FROM network_config ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "10")
  HOTSPOT_OPEN=$(sqlite3 "$DB_PATH" "SELECT hotspot_open FROM network_config ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "0")

  echo "SSID: $HOTSPOT_SSID"
  echo "Open network: $([ "$HOTSPOT_OPEN" = "1" ] && echo "Yes" || echo "No")"
  echo "Connection limit: $CONNECTION_LIMIT"

  # Note: Actual network configuration commands would go here
  # For safety, we'll just log the intent and not actually run commands
  # The proper implementation should call the API endpoint instead

  echo ""
  echo "⚠️  Network configuration changes require the SafeHarbor application"
  echo "to be running. Use the Admin Panel > Network Settings > Apply Changes"
  echo "to activate hotspot mode."

elif [ "$NETWORK_MODE" = "home" ]; then
  echo ""
  echo "Applying Home Network Mode configuration..."
  echo "This will connect to your home Wi-Fi network"

  # Read home network settings
  HOME_SSID=$(sqlite3 "$DB_PATH" "SELECT home_network_ssid FROM network_config ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "")

  if [ -z "$HOME_SSID" ]; then
    echo "No home network SSID configured"
    echo "Please configure home network settings in the Admin Panel"
  else
    echo "Network: $HOME_SSID"

    echo ""
    echo "⚠️  Network configuration changes require the SafeHarbor application"
    echo "to be running. Use the Admin Panel > Network Settings > Apply Changes"
    echo "to connect to your home network."
  fi
else
  echo "Unknown network mode: $NETWORK_MODE"
  echo "No network changes applied"
fi

echo ""
echo "==============================================="
echo "Network configuration check complete"
echo "==============================================="

exit 0
