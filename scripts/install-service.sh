#!/bin/bash
# SafeHarbor systemd Service Installation Script
# This script installs SafeHarbor as a systemd service for automatic startup

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_error "Please do not run this script as root"
    print_info "Run it as your normal user: ./scripts/install-service.sh"
    exit 1
fi

# Detect current directory and user
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CURRENT_USER=$(whoami)
CURRENT_GROUP=$(id -gn)

print_info "SafeHarbor systemd Service Installer"
echo ""
echo "Detected settings:"
echo "  User: $CURRENT_USER"
echo "  Group: $CURRENT_GROUP"
echo "  Installation path: $PROJECT_DIR"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    print_info "Please install Node.js first: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 1
fi

NODE_PATH=$(which node)
print_success "Found Node.js at: $NODE_PATH"

# Check if service file exists
if [ ! -f "$PROJECT_DIR/safeharbor.service" ]; then
    print_error "Service file not found at $PROJECT_DIR/safeharbor.service"
    exit 1
fi

# Create a temporary service file with correct paths
print_info "Creating service file with your settings..."
TEMP_SERVICE=$(mktemp)
sed -e "s|User=pi|User=$CURRENT_USER|g" \
    -e "s|Group=pi|Group=$CURRENT_GROUP|g" \
    -e "s|WorkingDirectory=/home/pi/SafeHarbor|WorkingDirectory=$PROJECT_DIR|g" \
    -e "s|ReadWritePaths=/home/pi/SafeHarbor|ReadWritePaths=$PROJECT_DIR|g" \
    -e "s|ExecStart=/usr/bin/node|ExecStart=$NODE_PATH|g" \
    "$PROJECT_DIR/safeharbor.service" > "$TEMP_SERVICE"

# Show the service file
print_info "Service configuration:"
echo ""
grep -E "^User=|^Group=|^WorkingDirectory=|^ExecStart=" "$TEMP_SERVICE" | sed 's/^/  /'
echo ""

# Ask for confirmation
read -p "Install SafeHarbor service with these settings? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Installation cancelled"
    rm "$TEMP_SERVICE"
    exit 0
fi

# Copy service file to systemd
print_info "Installing service file..."
sudo cp "$TEMP_SERVICE" /etc/systemd/system/safeharbor.service
rm "$TEMP_SERVICE"
print_success "Service file installed"

# Reload systemd
print_info "Reloading systemd daemon..."
sudo systemctl daemon-reload
print_success "Systemd reloaded"

# Enable service
print_info "Enabling SafeHarbor service to start on boot..."
sudo systemctl enable safeharbor
print_success "Service enabled"

# Ask if user wants to start now
echo ""
read -p "Start SafeHarbor service now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Starting SafeHarbor service..."
    sudo systemctl start safeharbor
    sleep 2

    # Check status
    if sudo systemctl is-active --quiet safeharbor; then
        print_success "SafeHarbor is running!"
    else
        print_error "SafeHarbor failed to start"
        print_info "Check logs with: sudo journalctl -u safeharbor -n 50"
        exit 1
    fi
else
    print_info "Service not started. Start it later with: sudo systemctl start safeharbor"
fi

echo ""
print_success "Installation complete!"
echo ""
echo "Useful commands:"
echo "  Start service:    sudo systemctl start safeharbor"
echo "  Stop service:     sudo systemctl stop safeharbor"
echo "  Restart service:  sudo systemctl restart safeharbor"
echo "  Check status:     sudo systemctl status safeharbor"
echo "  View logs:        sudo journalctl -u safeharbor -f"
echo "  Disable autostart: sudo systemctl disable safeharbor"
echo ""
print_info "SafeHarbor will now start automatically when your Raspberry Pi boots!"
