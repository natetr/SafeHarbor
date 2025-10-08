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
  sqlite3 \
  git \
  curl \
  wireless-tools \
  wpasupplicant \
  iptables

# Install kiwix-tools with libzim 9.2.0+ (fixes macOS/large file mmap issues)
echo "Installing kiwix-tools..."
KIWIX_VERSION="3.7.0-2"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  KIWIX_ARCH="aarch64"
elif [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "armhf" ]; then
  KIWIX_ARCH="armhf"
elif [ "$ARCH" = "x86_64" ]; then
  KIWIX_ARCH="x86_64"
else
  echo "Warning: Unknown architecture $ARCH, falling back to apt-get kiwix-tools"
  apt-get install -y kiwix-tools
  KIWIX_ARCH=""
fi

if [ -n "$KIWIX_ARCH" ]; then
  echo "Detected architecture: $KIWIX_ARCH"
  KIWIX_URL="https://download.kiwix.org/release/kiwix-tools/kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}.tar.gz"

  # Download and extract kiwix-tools
  cd /tmp
  echo "Downloading kiwix-tools from $KIWIX_URL..."
  curl -L -o kiwix-tools.tar.gz "$KIWIX_URL"

  if [ $? -eq 0 ]; then
    echo "Extracting kiwix-tools..."
    tar -xzf kiwix-tools.tar.gz

    # Find the extracted directory
    KIWIX_DIR=$(find /tmp -maxdepth 1 -type d -name "kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}" | head -n 1)

    if [ -d "$KIWIX_DIR" ]; then
      # Install to /usr/local/bin
      mkdir -p /usr/local/bin
      cp "$KIWIX_DIR"/kiwix-* /usr/local/bin/
      chmod +x /usr/local/bin/kiwix-*

      # Verify installation
      /usr/local/bin/kiwix-serve --version
      echo "kiwix-tools $KIWIX_VERSION installed successfully"
    else
      echo "Error: Could not find extracted kiwix-tools directory"
      echo "Falling back to apt-get kiwix-tools"
      apt-get install -y kiwix-tools
    fi

    # Cleanup
    rm -f /tmp/kiwix-tools.tar.gz
    rm -rf "$KIWIX_DIR"
  else
    echo "Error downloading kiwix-tools, falling back to apt-get"
    apt-get install -y kiwix-tools
  fi

  cd - > /dev/null
fi

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
