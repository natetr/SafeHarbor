#!/bin/bash

# SafeHarbor Clean Start Script
# Ensures ports 4000 and 8080 are free before starting the application

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ports used by SafeHarbor
PORTS=(4000 8080)
EXPRESS_PORT=4000
KIWIX_PORT=8080

echo -e "${BLUE}🧹 SafeHarbor Clean Start${NC}"
echo -e "${BLUE}=========================${NC}"
echo ""

# Function to check if a port is in use
check_port() {
    local port=$1
    lsof -ti:$port 2>/dev/null || true
}

# Function to get process info
get_process_info() {
    local pid=$1
    ps -p $pid -o command= 2>/dev/null || echo "Unknown process"
}

# Function to check if process is SafeHarbor-related
is_safeharbor_process() {
    local pid=$1
    local cmd=$(get_process_info $pid)

    # Check if it's a node process running SafeHarbor server
    if [[ $cmd == *"node"* ]] && [[ $cmd == *"server/index.js"* ]]; then
        return 0
    fi

    # Check if it's nodemon for SafeHarbor
    if [[ $cmd == *"nodemon"* ]] && [[ $cmd == *"server/index.js"* ]]; then
        return 0
    fi

    # Check if it's kiwix-serve
    if [[ $cmd == *"kiwix-serve"* ]]; then
        return 0
    fi

    return 1
}

# Track if we found any processes
found_processes=false

# Check each port
for port in "${PORTS[@]}"; do
    pids=$(check_port $port)

    if [ ! -z "$pids" ]; then
        found_processes=true
        echo -e "${YELLOW}⚠ Port $port is in use${NC}"

        # Process each PID
        for pid in $pids; do
            cmd=$(get_process_info $pid)
            echo -e "  Process: ${BLUE}$pid${NC} - $cmd"

            if is_safeharbor_process $pid; then
                echo -e "  ${GREEN}✓${NC} Identified as SafeHarbor process, will terminate"

                # Try graceful kill first
                echo -e "  Attempting graceful shutdown..."
                kill $pid 2>/dev/null || true

                # Wait a moment
                sleep 1

                # Check if still running, force kill if necessary
                if ps -p $pid > /dev/null 2>&1; then
                    echo -e "  ${YELLOW}Process still running, force killing...${NC}"
                    kill -9 $pid 2>/dev/null || true
                    sleep 0.5
                fi

                # Verify it's dead
                if ps -p $pid > /dev/null 2>&1; then
                    echo -e "  ${RED}✗ Failed to kill process $pid${NC}"
                else
                    echo -e "  ${GREEN}✓ Successfully terminated process $pid${NC}"
                fi
            else
                echo -e "  ${YELLOW}⚠ Not a SafeHarbor process - please manually terminate${NC}"
                echo -e "  ${RED}Cannot start SafeHarbor while port $port is in use${NC}"
                exit 1
            fi
        done
        echo ""
    fi
done

# Final verification
echo -e "${BLUE}Verifying ports are free...${NC}"
all_clear=true

for port in "${PORTS[@]}"; do
    pids=$(check_port $port)
    if [ ! -z "$pids" ]; then
        echo -e "${RED}✗ Port $port is still in use by PID: $pids${NC}"
        all_clear=false
    else
        echo -e "${GREEN}✓ Port $port is free${NC}"
    fi
done

echo ""

if [ "$all_clear" = true ]; then
    if [ "$found_processes" = true ]; then
        echo -e "${GREEN}✓ Cleanup complete! All ports are now free.${NC}"
    else
        echo -e "${GREEN}✓ All ports were already free.${NC}"
    fi
    echo -e "${BLUE}Starting SafeHarbor...${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Failed to free all required ports${NC}"
    echo -e "${YELLOW}Please manually check what's using the ports:${NC}"
    echo -e "  lsof -ti:4000"
    echo -e "  lsof -ti:8080"
    exit 1
fi
