#!/bin/bash

# SafeHarbor Sudoers Update Script
# This script updates the sudoers file to include wpa_cli permissions
# Run this on your existing Raspberry Pi installation

set -e

echo "================================"
echo "SafeHarbor Sudoers Update"
echo "================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

echo "Updating sudoers configuration..."

# SECURITY NOTE: The safeharbor service requires sudo access to configure network settings
# (hotspot mode, home network switching, etc.). To minimize security risks:
#   1. NoNewPrivileges is disabled in the systemd service (required for sudo to work)
#   2. Sudo access is limited to ONLY the specific commands below (no password required)
#   3. The service runs as a non-root user (safeharbor)
#   4. Only admin users authenticated via JWT can trigger network changes
cat > /etc/sudoers.d/safeharbor <<EOF
safeharbor ALL=(ALL) NOPASSWD: /usr/sbin/hostapd
safeharbor ALL=(ALL) NOPASSWD: /usr/sbin/dnsmasq
safeharbor ALL=(ALL) NOPASSWD: /sbin/ip
safeharbor ALL=(ALL) NOPASSWD: /sbin/iptables
safeharbor ALL=(ALL) NOPASSWD: /usr/sbin/wpa_supplicant
safeharbor ALL=(ALL) NOPASSWD: /sbin/wpa_cli
safeharbor ALL=(ALL) NOPASSWD: /usr/sbin/wpa_cli
safeharbor ALL=(ALL) NOPASSWD: /sbin/dhclient
safeharbor ALL=(ALL) NOPASSWD: /bin/systemctl
safeharbor ALL=(ALL) NOPASSWD: /sbin/reboot
safeharbor ALL=(ALL) NOPASSWD: /sbin/shutdown
safeharbor ALL=(ALL) NOPASSWD: /usr/bin/killall
safeharbor ALL=(ALL) NOPASSWD: /bin/mount
safeharbor ALL=(ALL) NOPASSWD: /bin/umount
safeharbor ALL=(ALL) NOPASSWD: /usr/bin/hostnamectl
safeharbor ALL=(ALL) NOPASSWD: /bin/cp
EOF

chmod 440 /etc/sudoers.d/safeharbor

# Validate sudoers file
if visudo -c -f /etc/sudoers.d/safeharbor; then
  echo "✓ Sudoers configuration updated successfully"
else
  echo "✗ Error: Invalid sudoers configuration"
  exit 1
fi

echo ""
echo "================================"
echo "Sudoers Update Complete!"
echo "================================"
echo ""
echo "The SafeHarbor service now has permission to validate"
echo "home network connections and automatically fallback to"
echo "hotspot mode if the connection fails."
echo ""
