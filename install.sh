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
  iptables \
  lsof \
  avahi-daemon \
  avahi-utils

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
# Suppress warnings about masked/disabled units
systemctl stop hostapd 2>/dev/null || true
systemctl stop dnsmasq 2>/dev/null || true
systemctl disable hostapd 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true

# Configure hostname to safeharbor
echo "Configuring hostname..."
CURRENT_HOSTNAME=$(hostname)
NEW_HOSTNAME="safeharbor"

if [ "$CURRENT_HOSTNAME" != "$NEW_HOSTNAME" ]; then
  echo "Changing hostname from $CURRENT_HOSTNAME to $NEW_HOSTNAME..."

  # Set hostname
  hostnamectl set-hostname $NEW_HOSTNAME

  # Update /etc/hosts
  sed -i "s/127.0.1.1.*$CURRENT_HOSTNAME/127.0.1.1\t$NEW_HOSTNAME/g" /etc/hosts

  # Ensure safeharbor.local is in /etc/hosts
  if ! grep -q "127.0.1.1.*$NEW_HOSTNAME" /etc/hosts; then
    echo "127.0.1.1	$NEW_HOSTNAME $NEW_HOSTNAME.local" >> /etc/hosts
  fi

  echo "Hostname changed to $NEW_HOSTNAME"
else
  echo "Hostname already set to $NEW_HOSTNAME"
fi

# Configure and enable Avahi for mDNS (.local domain resolution)
echo "Configuring Avahi daemon for mDNS..."
systemctl enable avahi-daemon
systemctl restart avahi-daemon

# Verify Avahi is publishing the hostname
sleep 2
if systemctl is-active --quiet avahi-daemon; then
  echo "✓ Avahi daemon is running"
  echo "✓ Device will be accessible at: $NEW_HOSTNAME.local"
else
  echo "⚠️  Warning: Avahi daemon failed to start"
fi

# Create SafeHarbor user (if not exists)
if ! id -u safeharbor > /dev/null 2>&1; then
  echo "Creating safeharbor user..."
  useradd -m -s /bin/bash safeharbor
fi

# Create directories
echo "Creating directories..."
mkdir -p /var/safeharbor/{data,content,zim}
mkdir -p /var/log/safeharbor
mkdir -p /opt/safeharbor/{data,content,zim}

# Set ownership
chown -R safeharbor:safeharbor /var/safeharbor
chown -R safeharbor:safeharbor /var/log/safeharbor
chown -R safeharbor:safeharbor /opt/safeharbor

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

  # Check if .env.example exists in the source directory
  SOURCE_DIR="$(dirname "$0")"
  if [ -f "$SOURCE_DIR/.env.example" ]; then
    cp "$SOURCE_DIR/.env.example" "$INSTALL_DIR/.env"
  elif [ -f "$INSTALL_DIR/.env.example" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  else
    echo "Warning: .env.example not found, creating minimal .env file..."
    cat > "$INSTALL_DIR/.env" <<'EOF'
PORT=3000
NODE_ENV=production
JWT_SECRET=change-this-to-a-random-secret-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
DATA_DIR=/var/safeharbor/data
CONTENT_DIR=/var/safeharbor/content
ZIM_DIR=/var/safeharbor/zim
DATABASE_PATH=/opt/safeharbor/safeharbor.db
KIWIX_SERVE_PORT=8080
ZIM_LOG_LEVEL=basic
HOTSPOT_SSID=SafeHarbor
HOTSPOT_PASSWORD=safeharbor2024
NETWORK_INTERFACE=wlan0
EOF
  fi

  # Generate random JWT secret
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/change-this-to-a-random-secret-key/$JWT_SECRET/" "$INSTALL_DIR/.env"

  chown safeharbor:safeharbor "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  echo "✓ .env file created with random JWT secret"
else
  echo "✓ .env file already exists, skipping"
fi

# Add safeharbor user to necessary groups (do this before creating sudoers file)
usermod -a -G netdev safeharbor
usermod -a -G sudo safeharbor

# Create sudoers file for network management
# SECURITY NOTE: The safeharbor service requires sudo access to configure network settings
# (hotspot mode, home network switching, etc.). To minimize security risks:
#   1. NoNewPrivileges is disabled in the systemd service (required for sudo to work)
#   2. Sudo access is limited to ONLY the specific commands below (no password required)
#   3. The service runs as a non-root user (safeharbor)
#   4. Only admin users authenticated via JWT can trigger network changes
echo "Configuring sudo permissions for network management..."
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
safeharbor ALL=(ALL) NOPASSWD: /bin/chmod
EOF

chmod 440 /etc/sudoers.d/safeharbor

# Create systemd service with enhanced crash recovery
echo "Creating systemd service..."
cat > /etc/systemd/system/safeharbor.service <<'EOF'
[Unit]
Description=SafeHarbor - Offline Knowledge Hub
Documentation=https://github.com/natetr/SafeHarbor
After=network.target
Wants=network-online.target

# Restart throttling - prevent restart loops
# Max 5 restarts within 10 minutes, then give up
StartLimitBurst=5
StartLimitIntervalSec=600

[Service]
Type=simple
User=safeharbor
WorkingDirectory=/opt/safeharbor
ExecStart=/usr/bin/node /opt/safeharbor/server/index.js

# Environment
Environment=NODE_ENV=production

# Restart policy - only restart on failure, not on intentional exit
Restart=on-failure
RestartSec=10

# Don't restart if app exits with these codes (intentional shutdown)
RestartPreventExitStatus=0 2

# Graceful shutdown - give app 30s to clean up before SIGKILL
TimeoutStopSec=30

# Resource limits
LimitNOFILE=65536

# Task limits to prevent fork bombs
TasksMax=512

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=safeharbor

# Security hardening
# NOTE: NoNewPrivileges is disabled to allow network configuration via sudo
# This is required for hotspot mode and home network switching
# Access to sudo commands is restricted via /etc/sudoers.d/safeharbor
PrivateTmp=true

# Protect system directories
ProtectSystem=strict
# Allow writing to these directories (including /run/sudo for passwordless sudo)
ReadWritePaths=/opt/safeharbor /var/safeharbor /var/log/safeharbor /tmp /run/sudo

# Protect home directory
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd configuration
systemctl daemon-reload
systemctl enable safeharbor

# Initialize database using dedicated script (avoids starting service)
echo "Initializing database..."
if [ -f "$(dirname "$0")/scripts/init-database.sh" ]; then
  bash "$(dirname "$0")/scripts/init-database.sh" "${INSTALL_DIR}/safeharbor.db" || {
    echo "⚠️  Database initialization failed"
    echo "   Falling back to service-based initialization"
    systemctl start safeharbor
    sleep 5
    systemctl stop safeharbor
  }
elif [ -f "${INSTALL_DIR}/scripts/init-database.sh" ]; then
  bash "${INSTALL_DIR}/scripts/init-database.sh" "${INSTALL_DIR}/safeharbor.db" || {
    echo "⚠️  Database initialization failed"
    echo "   Falling back to service-based initialization"
    systemctl start safeharbor
    sleep 5
    systemctl stop safeharbor
  }
else
  echo "⚠️  Database init script not found, using service-based initialization"
  systemctl start safeharbor
  sleep 5
  systemctl stop safeharbor
fi

# Set ownership of database
chown safeharbor:safeharbor "${INSTALL_DIR}/safeharbor.db" 2>/dev/null || true
chmod 644 "${INSTALL_DIR}/safeharbor.db" 2>/dev/null || true

# Run first-time setup wizard (database exists now, service NOT running)
echo ""
echo "================================"
echo "First-Time Setup"
echo "================================"
echo ""

if [ -f "$(dirname "$0")/scripts/first-run-setup.sh" ]; then
  bash "$(dirname "$0")/scripts/first-run-setup.sh" || true
elif [ -f "${INSTALL_DIR}/scripts/first-run-setup.sh" ]; then
  bash "${INSTALL_DIR}/scripts/first-run-setup.sh" || true
else
  echo "⚠️  First-run setup wizard not found"
  echo "   You can configure WiFi settings later in the Admin Panel"
  echo ""
fi

# NOW start the service with the configured network settings
echo "Starting SafeHarbor service..."
systemctl start safeharbor

# Wait a moment for service to start
sleep 3

# Check if service started successfully
if systemctl is-active --quiet safeharbor; then
  echo "✓ SafeHarbor service started successfully"
else
  echo "⚠️  Service may have issues starting"
  echo "   Check logs with: sudo journalctl -u safeharbor -n 50"
fi

# Configure firewall
echo "Configuring firewall..."
# Allow HTTP traffic
iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -j ACCEPT

# Save iptables rules
iptables-save > /etc/iptables/rules.v4 || true

# Configure NetworkManager to not interfere with wlan0
# SafeHarbor manages wlan0 directly for hotspot and home network modes
if command -v nmcli &> /dev/null; then
  echo "Configuring NetworkManager to ignore wlan0..."

  # Create NetworkManager configuration
  mkdir -p /etc/NetworkManager/conf.d
  cat > /etc/NetworkManager/conf.d/safeharbor-unmanaged.conf <<EOF
# SafeHarbor Network Configuration
# This file prevents NetworkManager from managing the wireless interface
# SafeHarbor manages the interface directly for hotspot and home network modes

[keyfile]
unmanaged-devices=interface-name:wlan0
EOF

  # Remove any existing wlan0 connections
  CONNECTIONS=$(nmcli -t -f NAME,DEVICE connection show 2>/dev/null | grep ":wlan0$" | cut -d: -f1 || true)
  if [ -n "$CONNECTIONS" ]; then
    while IFS= read -r conn; do
      echo "  Removing NetworkManager connection: $conn"
      nmcli connection delete "$conn" 2>/dev/null || true
    done <<< "$CONNECTIONS"
  fi

  # Reload NetworkManager
  systemctl reload NetworkManager 2>/dev/null || true

  echo "✓ NetworkManager configured to ignore wlan0"
  echo "  SafeHarbor now has full control over the wireless interface"
else
  echo "NetworkManager not installed - no configuration needed"
fi

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
