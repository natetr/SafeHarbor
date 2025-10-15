#!/bin/bash

# SafeHarbor NetworkManager Configuration Script
# This script configures NetworkManager to not interfere with wlan0
# which SafeHarbor manages directly for hotspot and home network modes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "SafeHarbor NetworkManager Configuration"
echo "=========================================="
echo ""

# Check if NetworkManager is installed
if ! command -v nmcli &> /dev/null; then
    echo "NetworkManager is not installed - no configuration needed"
    exit 0
fi

echo "NetworkManager detected"

# Check if running on Raspberry Pi
if [ ! -f /proc/cpuinfo ]; then
    echo "Not running on Linux - skipping NetworkManager configuration"
    exit 0
fi

NETWORK_INTERFACE="${NETWORK_INTERFACE:-wlan0}"

echo "Configuring NetworkManager to ignore $NETWORK_INTERFACE..."
echo ""

# Create NetworkManager configuration to mark wlan0 as unmanaged
NM_CONF="/etc/NetworkManager/conf.d/safeharbor-unmanaged.conf"

# Create the configuration content
cat > /tmp/safeharbor-unmanaged.conf << EOF
# SafeHarbor Network Configuration
# This file prevents NetworkManager from managing the wireless interface
# SafeHarbor manages the interface directly for hotspot and home network modes

[keyfile]
unmanaged-devices=interface-name:$NETWORK_INTERFACE
EOF

# Install the configuration
echo "Installing NetworkManager configuration..."
sudo mkdir -p /etc/NetworkManager/conf.d
sudo cp /tmp/safeharbor-unmanaged.conf "$NM_CONF"
sudo rm /tmp/safeharbor-unmanaged.conf

echo "✓ Configuration installed to $NM_CONF"
echo ""

# Remove any existing wlan0 connections from NetworkManager
echo "Removing any existing $NETWORK_INTERFACE connections from NetworkManager..."
CONNECTIONS=$(nmcli -t -f NAME,DEVICE connection show | grep ":$NETWORK_INTERFACE$" | cut -d: -f1 || true)

if [ -n "$CONNECTIONS" ]; then
    while IFS= read -r conn; do
        echo "  Removing connection: $conn"
        sudo nmcli connection delete "$conn" || true
    done <<< "$CONNECTIONS"
    echo "✓ Connections removed"
else
    echo "  No connections found"
fi

echo ""
echo "Reloading NetworkManager configuration..."
sudo systemctl reload NetworkManager

echo "✓ NetworkManager configured successfully"
echo ""
echo "NetworkManager will no longer manage $NETWORK_INTERFACE"
echo "SafeHarbor now has full control over the wireless interface"
echo ""
echo "=========================================="
echo "Configuration Complete"
echo "=========================================="
