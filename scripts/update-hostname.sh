#!/bin/bash

# SafeHarbor Hostname Configuration Script
# This script updates the Raspberry Pi hostname to safeharbor.local
# Run this on your existing Raspberry Pi installation if you installed before this fix

set -e

echo "================================"
echo "SafeHarbor Hostname Update"
echo "================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

# Check if running on Raspberry Pi
if [ ! -f /proc/cpuinfo ]; then
  echo "Not running on Linux - hostname configuration skipped"
  exit 0
fi

if ! grep -q "Raspberry Pi" /proc/cpuinfo && ! grep -q "BCM" /proc/cpuinfo; then
  echo "Not running on Raspberry Pi - hostname configuration skipped"
  exit 0
fi

echo "Raspberry Pi detected"
echo ""

# Install Avahi if not present
if ! command -v avahi-daemon &> /dev/null; then
  echo "Installing Avahi daemon..."
  apt-get update
  apt-get install -y avahi-daemon avahi-utils
  echo "✓ Avahi installed"
else
  echo "✓ Avahi already installed"
fi

# Configure hostname
CURRENT_HOSTNAME=$(hostname)
NEW_HOSTNAME="safeharbor"

echo ""
echo "Current hostname: $CURRENT_HOSTNAME"
echo "New hostname: $NEW_HOSTNAME"
echo ""

if [ "$CURRENT_HOSTNAME" != "$NEW_HOSTNAME" ]; then
  echo "Changing hostname..."

  # Set hostname using hostnamectl
  hostnamectl set-hostname $NEW_HOSTNAME

  # Update /etc/hostname
  echo "$NEW_HOSTNAME" > /etc/hostname

  # Update /etc/hosts - replace old hostname with new one
  sed -i "s/127.0.1.1.*$CURRENT_HOSTNAME/127.0.1.1\t$NEW_HOSTNAME/g" /etc/hosts

  # Ensure safeharbor and safeharbor.local are in /etc/hosts
  if ! grep -q "127.0.1.1.*$NEW_HOSTNAME" /etc/hosts; then
    echo "127.0.1.1	$NEW_HOSTNAME $NEW_HOSTNAME.local" >> /etc/hosts
  fi

  # Also ensure IPv6 localhost entries
  if ! grep -q "::1.*$NEW_HOSTNAME" /etc/hosts; then
    sed -i "s/::1.*/::1 localhost ip6-localhost ip6-loopback $NEW_HOSTNAME $NEW_HOSTNAME.local/" /etc/hosts
  fi

  echo "✓ Hostname changed to $NEW_HOSTNAME"
else
  echo "✓ Hostname already set to $NEW_HOSTNAME"
fi

# Configure and enable Avahi for mDNS (.local domain resolution)
echo ""
echo "Configuring Avahi daemon for mDNS..."

# Ensure Avahi configuration allows publishing
if [ -f /etc/avahi/avahi-daemon.conf ]; then
  # Enable publishing if disabled
  sed -i 's/#*disable-publishing=yes/disable-publishing=no/' /etc/avahi/avahi-daemon.conf
  sed -i 's/#*disable-user-service-publishing=yes/disable-user-service-publishing=no/' /etc/avahi/avahi-daemon.conf

  # Ensure hostname publishing is enabled
  if ! grep -q "^publish-addresses=" /etc/avahi/avahi-daemon.conf; then
    sed -i '/\[publish\]/a publish-addresses=yes' /etc/avahi/avahi-daemon.conf
  fi
  if ! grep -q "^publish-hinfo=" /etc/avahi/avahi-daemon.conf; then
    sed -i '/\[publish\]/a publish-hinfo=yes' /etc/avahi/avahi-daemon.conf
  fi
  if ! grep -q "^publish-workstation=" /etc/avahi/avahi-daemon.conf; then
    sed -i '/\[publish\]/a publish-workstation=yes' /etc/avahi/avahi-daemon.conf
  fi
fi

# Enable and restart Avahi
systemctl enable avahi-daemon
systemctl restart avahi-daemon

# Verify Avahi is running
sleep 2
if systemctl is-active --quiet avahi-daemon; then
  echo "✓ Avahi daemon is running"
else
  echo "✗ Warning: Avahi daemon failed to start"
  systemctl status avahi-daemon
  exit 1
fi

echo ""
echo "================================"
echo "Hostname Update Complete!"
echo "================================"
echo ""
echo "Your device is now accessible at:"
echo "  - http://$NEW_HOSTNAME.local:3000"
echo "  - http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "⚠️  IMPORTANT: You may need to reboot for all changes to take effect."
echo ""
echo "To reboot now, run: sudo reboot"
echo ""
