#!/bin/bash

# SafeHarbor Health Check Script
# This script checks if the SafeHarbor application is healthy
# Exit code 0 = healthy, 1 = unhealthy
#
# Usage:
#   ./scripts/health-check.sh [--verbose]
#
# Can be used by:
#   - Systemd (ExecStartPre, ExecReload)
#   - External monitoring tools
#   - Manual health checks

set -e

PORT=${SAFEHARBOR_PORT:-3000}
VERBOSE=false

# Parse arguments
if [ "$1" = "--verbose" ] || [ "$1" = "-v" ]; then
  VERBOSE=true
fi

# Function to log (only if verbose)
log() {
  if [ "$VERBOSE" = true ]; then
    echo "$@"
  fi
}

# Function to check if curl is available
check_curl() {
  if ! command -v curl &> /dev/null; then
    echo "ERROR: curl is not installed"
    exit 1
  fi
}

# Main health check
log "SafeHarbor Health Check"
log "======================="
log ""

check_curl

# Check if service is reachable
log "Checking service on port $PORT..."
HEALTH_URL="http://localhost:$PORT/api/health"

# Perform health check with timeout
HTTP_CODE=$(curl -s -o /tmp/safeharbor-health.json -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  echo "UNHEALTHY: Cannot connect to SafeHarbor on port $PORT"
  exit 1
fi

# Check HTTP status code
if [ "$HTTP_CODE" = "200" ]; then
  log "✓ HTTP Status: $HTTP_CODE (healthy)"

  # Parse JSON response if jq is available
  if command -v jq &> /dev/null && [ -f /tmp/safeharbor-health.json ]; then
    STATUS=$(jq -r '.status // "unknown"' /tmp/safeharbor-health.json 2>/dev/null)
    UPTIME=$(jq -r '.uptime // 0' /tmp/safeharbor-health.json 2>/dev/null)

    log "✓ Status: $STATUS"
    log "✓ Uptime: ${UPTIME}s"

    # Check individual components if available
    if jq -e '.checks' /tmp/safeharbor-health.json >/dev/null 2>&1; then
      log ""
      log "Component Status:"

      MEMORY_STATUS=$(jq -r '.checks.memory.status // "unknown"' /tmp/safeharbor-health.json 2>/dev/null)
      DB_STATUS=$(jq -r '.checks.database.status // "unknown"' /tmp/safeharbor-health.json 2>/dev/null)
      KIWIX_STATUS=$(jq -r '.checks.kiwix.status // "unknown"' /tmp/safeharbor-health.json 2>/dev/null)

      log "  Memory: $MEMORY_STATUS"
      log "  Database: $DB_STATUS"
      log "  Kiwix: $KIWIX_STATUS"

      # Check if any component is unhealthy
      if [ "$MEMORY_STATUS" = "error" ] || [ "$DB_STATUS" = "error" ] || [ "$KIWIX_STATUS" = "error" ]; then
        echo "DEGRADED: Some components are unhealthy"
        rm -f /tmp/safeharbor-health.json
        exit 1
      fi
    fi
  fi

  echo "HEALTHY"
  rm -f /tmp/safeharbor-health.json
  exit 0

elif [ "$HTTP_CODE" = "503" ]; then
  log "⚠ HTTP Status: $HTTP_CODE (degraded)"
  echo "DEGRADED: Service is degraded"
  rm -f /tmp/safeharbor-health.json
  exit 1

else
  log "❌ HTTP Status: $HTTP_CODE (unexpected)"
  echo "UNHEALTHY: Unexpected HTTP status $HTTP_CODE"
  rm -f /tmp/safeharbor-health.json
  exit 1
fi
