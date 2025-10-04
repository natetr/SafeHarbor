#!/bin/bash

# SafeHarbor Local Test Script
# Quick start for testing on your Mac

set -e

echo "================================"
echo "SafeHarbor Local Test Setup"
echo "================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo ""
    echo "Please install Node.js first:"
    echo "  Mac: brew install node"
    echo "  Or download from: https://nodejs.org"
    exit 1
fi

echo "✅ Node.js installed: $(node --version)"
echo ""

# Install backend dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
    echo "✅ Backend dependencies installed"
else
    echo "✅ Backend dependencies already installed"
fi

# Install frontend dependencies
if [ ! -d "client/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd client
    npm install
    cd ..
    echo "✅ Frontend dependencies installed"
else
    echo "✅ Frontend dependencies already installed"
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created"
else
    echo "✅ .env file exists"
fi

echo ""
echo "================================"
echo "Setup Complete!"
echo "================================"
echo ""
echo "To start SafeHarbor:"
echo ""
echo "  npm run dev"
echo ""
echo "This will start:"
echo "  - Backend API on http://localhost:3000"
echo "  - Frontend dev server on http://localhost:5173"
echo ""
echo "Open your browser to: http://localhost:5173"
echo ""
echo "Default login:"
echo "  Username: admin"
echo "  Password: admin"
echo ""
echo "Press Ctrl+C to stop the servers"
echo ""
echo "See DEV_SETUP.md for more information"
echo ""
