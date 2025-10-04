#!/bin/bash

echo "Starting SafeHarbor in development mode..."
echo ""
echo "Backend will run on: http://localhost:3000"
echo "Frontend will run on: http://localhost:5173"
echo ""
echo "Open http://localhost:5173 in your browser"
echo "Login with: admin / admin"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Start both servers
npm run dev
