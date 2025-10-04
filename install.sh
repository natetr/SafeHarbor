#!/bin/bash

# SafeHarbor Installation Script for Raspberry Pi
# This script installs and configures SafeHarbor

set -e

echo "================================"
echo "SafeHarbor Installation"
echo "================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

# Update system
echo "Updating system..."
apt-get update
apt-get upgrade -y

# Install dependencies
echo "Installing dependencies..."
apt-get install -y \
  nodejs \
  npm \
  hostapd \
  dnsmasq \
  kiwix-tools \
  sqlite3 \
  git \
  curl \
  wireless-tools \
  wpasupplicant \
  iptables

# Stop services that will be configured later
systemctl stop hostapd || true
systemctl stop dnsmasq || true
systemctl disable hostapd || true
systemctl disable dnsmasq || true

# Create SafeHarbor user (if not exists)
if ! id -u safeharbor > /dev/null 2>&1; then
  echo "Creating safeharbor user..."
  useradd -m -s /bin/bash safeharbor
fi

# Create directories
echo "Creating directories..."
mkdir -p /var/safeharbor/{data,content,zim}
mkdir -p /var/log/safeharbor

# Set ownership
chown -R safeharbor:safeharbor /var/safeharbor
chown -R safeharbor:safeharbor /var/log/safeharbor

# Copy application files
echo "Installing application..."
INSTALL_DIR="/opt/safeharbor"
mkdir -p $INSTALL_DIR

# If running from source directory
if [ -f "$(dirname "$0")/package.json" ]; then
  cp -r "$(dirname "$0")"/* $INSTALL_DIR/
  chown -R safeharbor:safeharbor $INSTALL_DIR
fi

cd $INSTALL_DIR

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
sudo -u safeharbor npm install
cd client && sudo -u safeharbor npm install && cd ..

# Build frontend
echo "Building frontend..."
cd client && sudo -u safeharbor npm run build && cd ..

# Create environment file
if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo "Creating .env file..."
  cp .env.example .env

  # Generate random JWT secret
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/change-this-to-a-random-secret-key/$JWT_SECRET/" .env

  chown safeharbor:safeharbor .env
  chmod 600 .env
fi

# Create systemd service
echo "Creating systemd service..."
cat > /etc/systemd/system/safeharbor.service <<EOF
[Unit]
Description=SafeHarbor Offline Knowledge Hub
After=network.target

[Service]
Type=simple
User=safeharbor
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $INSTALL_DIR/server/index.js
Restart=on-failure
RestartSec=10

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl daemon-reload
systemctl enable safeharbor
systemctl start safeharbor

# Configure firewall
echo "Configuring firewall..."
# Allow HTTP traffic
iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -j ACCEPT

# Save iptables rules
iptables-save > /etc/iptables/rules.v4 || true

# Add safeharbor user to necessary groups
usermod -a -G netdev safeharbor
usermod -a -G sudo safeharbor

# Create sudoers file for network management
cat > /etc/sudoers.d/safeharbor <<EOF
safeharbor ALL=(ALL) NOPASSWD: /usr/sbin/hostapd
safeharbor ALL=(ALL) NOPASSWD: /usr/sbin/dnsmasq
safeharbor ALL=(ALL) NOPASSWD: /sbin/ip
safeharbor ALL=(ALL) NOPASSWD: /sbin/iptables
safeharbor ALL=(ALL) NOPASSWD: /usr/sbin/wpa_supplicant
safeharbor ALL=(ALL) NOPASSWD: /sbin/dhclient
safeharbor ALL=(ALL) NOPASSWD: /bin/systemctl
safeharbor ALL=(ALL) NOPASSWD: /sbin/reboot
safeharbor ALL=(ALL) NOPASSWD: /sbin/shutdown
safeharbor ALL=(ALL) NOPASSWD: /usr/bin/killall
safeharbor ALL=(ALL) NOPASSWD: /bin/mount
safeharbor ALL=(ALL) NOPASSWD: /bin/umount
EOF

chmod 440 /etc/sudoers.d/safeharbor

echo "================================"
echo "Installation Complete!"
echo "================================"
echo ""
echo "SafeHarbor is now running on port 3000"
echo ""
echo "Default admin credentials:"
echo "  Username: admin"
echo "  Password: admin"
echo ""
echo "IMPORTANT: Change the default password immediately!"
echo ""
echo "Access SafeHarbor at:"
echo "  http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "To view logs:"
echo "  sudo journalctl -u safeharbor -f"
echo ""
echo "To restart SafeHarbor:"
echo "  sudo systemctl restart safeharbor"
echo ""
