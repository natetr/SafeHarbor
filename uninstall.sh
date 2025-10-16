#!/bin/bash

# SafeHarbor Uninstall Script
# Removes SafeHarbor from Raspberry Pi

set -e

echo ""
echo "========================================"
echo "SafeHarbor Uninstall"
echo "========================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

echo "This will remove SafeHarbor from your system."
echo ""
echo "⚠️  WARNING: This action cannot be undone!"
echo ""

# Ask for confirmation
read -p "Are you sure you want to uninstall SafeHarbor? (yes/no) " -r
echo
if [ "$REPLY" != "yes" ]; then
  echo "Uninstall cancelled."
  exit 0
fi

echo ""
echo "What would you like to do with your data?"
echo ""
echo "1) Keep all data (content, ZIM libraries, database)"
echo "2) Remove everything (complete clean uninstall)"
echo ""
read -p "Enter choice (1 or 2): " -n 1 -r DATA_CHOICE
echo
echo ""

# Stop and disable service
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Stopping SafeHarbor service..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if systemctl is-active --quiet safeharbor; then
  systemctl stop safeharbor
  echo "✓ Service stopped"
else
  echo "✓ Service already stopped"
fi

if systemctl is-enabled --quiet safeharbor 2>/dev/null; then
  systemctl disable safeharbor
  echo "✓ Service disabled"
else
  echo "✓ Service already disabled"
fi

# Stop any running network services that SafeHarbor may have started
echo ""
echo "Stopping network services..."
killall hostapd 2>/dev/null || true
killall dnsmasq 2>/dev/null || true
killall wpa_supplicant 2>/dev/null || true
echo "✓ Network services stopped"

# Remove systemd service file
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Removing system files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f /etc/systemd/system/safeharbor.service ]; then
  rm /etc/systemd/system/safeharbor.service
  systemctl daemon-reload
  echo "✓ Systemd service removed"
fi

# Remove sudoers file
if [ -f /etc/sudoers.d/safeharbor ]; then
  rm /etc/sudoers.d/safeharbor
  echo "✓ Sudoers configuration removed"
fi

# Remove NetworkManager configuration
if [ -f /etc/NetworkManager/conf.d/99-unmanaged-devices.conf ]; then
  rm /etc/NetworkManager/conf.d/99-unmanaged-devices.conf
  echo "✓ NetworkManager configuration removed"
fi

if [ -f /etc/NetworkManager/conf.d/safeharbor-unmanaged.conf ]; then
  rm /etc/NetworkManager/conf.d/safeharbor-unmanaged.conf
  echo "✓ NetworkManager SafeHarbor configuration removed"
fi

# Reload NetworkManager if it's running
if systemctl is-active --quiet NetworkManager; then
  systemctl reload NetworkManager
  echo "✓ NetworkManager reloaded"
fi

# Remove application directory
echo ""
if [ -d /opt/safeharbor ]; then
  rm -rf /opt/safeharbor
  echo "✓ Application files removed (/opt/safeharbor)"
fi

# Remove or preserve data based on user choice
echo ""
if [ "$DATA_CHOICE" = "2" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Removing all data..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [ -d /var/safeharbor ]; then
    rm -rf /var/safeharbor
    echo "✓ Data directory removed (/var/safeharbor)"
  fi

  if [ -d /var/log/safeharbor ]; then
    rm -rf /var/log/safeharbor
    echo "✓ Log directory removed (/var/log/safeharbor)"
  fi
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Preserving data..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "✓ Data preserved at /var/safeharbor"
  echo "✓ Logs preserved at /var/log/safeharbor"
  echo ""
  echo "You can manually remove these later if needed:"
  echo "  sudo rm -rf /var/safeharbor"
  echo "  sudo rm -rf /var/log/safeharbor"
fi

# Remove user
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Removing SafeHarbor user..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if id -u safeharbor > /dev/null 2>&1; then
  userdel safeharbor 2>/dev/null || true
  echo "✓ SafeHarbor user removed"

  # Remove home directory if it exists
  if [ -d /home/safeharbor ]; then
    rm -rf /home/safeharbor
    echo "✓ SafeHarbor home directory removed"
  fi
else
  echo "✓ SafeHarbor user does not exist"
fi

# Clean up temporary files
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Cleaning up temporary files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

rm -f /tmp/hostapd.conf 2>/dev/null || true
rm -f /tmp/hostapd_recovery.conf 2>/dev/null || true
rm -f /tmp/dnsmasq.conf 2>/dev/null || true
rm -f /tmp/dnsmasq_recovery.conf 2>/dev/null || true
rm -f /tmp/safeharbor_network_state.json 2>/dev/null || true
rm -f /tmp/wpa_supplicant.conf 2>/dev/null || true
echo "✓ Temporary files removed"

# Optional: Remove kiwix-tools if installed by SafeHarbor
echo ""
read -p "Remove kiwix-tools? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if [ -f /usr/local/bin/kiwix-serve ]; then
    rm -f /usr/local/bin/kiwix-*
    echo "✓ kiwix-tools removed"
  else
    echo "✓ kiwix-tools not found in /usr/local/bin"
  fi
fi

# Optional: Remove system dependencies
echo ""
read -p "Remove system dependencies (hostapd, dnsmasq, etc.)? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "Removing system dependencies..."
  apt-get remove -y hostapd dnsmasq sqlite3 2>/dev/null || true
  apt-get autoremove -y 2>/dev/null || true
  echo "✓ System dependencies removed"
fi

echo ""
echo "========================================"
echo "Uninstall Complete!"
echo "========================================"
echo ""

if [ "$DATA_CHOICE" = "1" ]; then
  echo "SafeHarbor has been removed from your system."
  echo "Your data has been preserved at:"
  echo "  • /var/safeharbor"
  echo "  • /var/log/safeharbor"
  echo ""
  echo "To reinstall SafeHarbor with your existing data:"
  echo "  1. Clone the repository"
  echo "  2. Run: sudo bash install.sh"
  echo "  3. Your data will be automatically detected"
else
  echo "SafeHarbor has been completely removed from your system."
  echo "All application files and data have been deleted."
fi

echo ""
echo "Thank you for using SafeHarbor!"
echo ""
