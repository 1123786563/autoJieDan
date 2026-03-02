#!/bin/bash
# K6 Load Test Runner
# Usage: ./run-test.sh [scenario] [environment]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
SCENARIO="${1:-all}"
ENVIRONMENT="${2:-local}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.json"
K6_SCRIPT="${SCRIPT_DIR}/k6-scenario.js"

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}Error: k6 is not installed${NC}"
    echo "Install k6: brew install k6"
    exit 1
fi

# Check if the k6 script exists
if [ ! -f "$K6_SCRIPT" ]; then
    echo -e "${RED}Error: k6-scenario.js not found at $K6_SCRIPT${NC}"
    exit 1
fi

# Function to get base URL from config
get_base_url() {
    local env=$1
    if command -v jq &> /dev/null && [ -f "$CONFIG_FILE" ]; then
        jq -r ".environments.${env}.base_url" "$CONFIG_FILE"
    else
        case "$env" in
            local) echo "http://localhost:10790" ;;
            docker) echo "http://localhost:8080" ;;
            *) echo "http://localhost:10790" ;;
        esac
    fi
}

# Get base URL
BASE_URL=$(get_base_url "$ENVIRONMENT")
export BASE_URL

echo -e "${GREEN}=== AutoJieDan Load Testing ===${NC}"
echo "Scenario: $SCENARIO"
echo "Environment: $ENVIRONMENT"
echo "Base URL: $BASE_URL"
echo ""

# Check if service is running
echo -e "${YELLOW}Checking service health...${NC}"
HEALTH_URL="${BASE_URL}/health"
if command -v curl &> /dev/null; then
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Service is healthy${NC}"
    else
        echo -e "${RED}✗ Service is not responding at $HEALTH_URL${NC}"
        echo "Please start the service with: docker compose up -d automaton"
        exit 1
    fi
else
    echo -e "${YELLOW}Warning: curl not found, skipping health check${NC}"
fi
echo ""

# Run the appropriate scenario
case "$SCENARIO" in
    constant_load)
        echo -e "${GREEN}Running constant load test...${NC}"
        k6 run --stage constant_load "$K6_SCRIPT"
        ;;
    spike_test)
        echo -e "${GREEN}Running spike test...${NC}"
        k6 run --stage spike_test "$K6_SCRIPT"
        ;;
    smoke)
        echo -e "${GREEN}Running smoke test...${NC}"
        k6 run --env BASE_URL="$BASE_URL" -e SCENARIOS='{ "smoke": { "executor": "constant-vus", "vus": 1, "duration": "30s" } }' "$K6_SCRIPT"
        ;;
    all)
        echo -e "${GREEN}Running all scenarios...${NC}"
        k6 run "$K6_SCRIPT"
        ;;
    *)
        echo -e "${RED}Unknown scenario: $SCENARIO${NC}"
        echo "Available scenarios: constant_load, spike_test, smoke, all"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}=== Test Complete ===${NC}"
