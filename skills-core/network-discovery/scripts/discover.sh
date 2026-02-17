#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Network Discovery Script (Anveshana)
#
# Usage:
#   ./discover.sh                      # Scan local machine
#   ./discover.sh 192.168.1.0/24       # Scan subnet
#   ./discover.sh 192.168.1.50         # Scan single host
#   ./discover.sh 192.168.1.50 --full  # Full scan with service detection
#
# Requires: bash 4+. Optional: nmap, netcat.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TARGET="${1:-localhost}"
MODE="${2:---quick}"
TIMEOUT=2

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Tool Detection ─────────────────────────────────────────────────────────

HAS_NMAP=false
HAS_NC=false
HAS_LSOF=false
HAS_SS=false

command -v nmap &>/dev/null && HAS_NMAP=true
command -v nc &>/dev/null && HAS_NC=true
command -v lsof &>/dev/null && HAS_LSOF=true
command -v ss &>/dev/null && HAS_SS=true

echo -e "${BOLD}═══ Network Discovery (Anveshana) ═══${RESET}"
echo -e "Target: ${CYAN}${TARGET}${RESET}"
echo -e "Mode:   ${MODE}"
echo -e "Tools:  nmap=${HAS_NMAP} nc=${HAS_NC} lsof=${HAS_LSOF} ss=${HAS_SS}"
echo ""

# ─── Local Machine Scan ─────────────────────────────────────────────────────

if [[ "$TARGET" == "localhost" || "$TARGET" == "127.0.0.1" || "$TARGET" == "::1" ]]; then
    echo -e "${BOLD}── Local Services ──${RESET}"

    if $HAS_LSOF; then
        echo -e "${CYAN}Listening ports (lsof):${RESET}"
        lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | awk 'NR==1 || /LISTEN/' | head -30
    elif $HAS_SS; then
        echo -e "${CYAN}Listening ports (ss):${RESET}"
        ss -tlnp 2>/dev/null | head -30
    else
        echo -e "${YELLOW}No lsof or ss available. Using netstat:${RESET}"
        netstat -an 2>/dev/null | grep LISTEN | head -30
    fi

    echo ""

    # Docker containers
    if command -v docker &>/dev/null; then
        echo -e "${BOLD}── Docker Containers ──${RESET}"
        docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}" 2>/dev/null || echo "(docker not running)"
        echo ""
    fi

    # Network interfaces
    echo -e "${BOLD}── Network Interfaces ──${RESET}"
    if command -v ip &>/dev/null; then
        ip -br addr 2>/dev/null
    else
        ifconfig 2>/dev/null | grep -E "^[a-z]|inet " | sed 's/^/  /'
    fi

    exit 0
fi

# ─── Remote Host / Subnet Scan ──────────────────────────────────────────────

# Check if target is a subnet (contains /)
if [[ "$TARGET" == *"/"* ]]; then
    echo -e "${BOLD}── Subnet Sweep ──${RESET}"

    if $HAS_NMAP; then
        echo -e "${CYAN}Using nmap ping sweep:${RESET}"
        nmap -sn "$TARGET" 2>/dev/null | grep -E "scan report|Host is|MAC"
    else
        # Extract base IP and sweep
        BASE=$(echo "$TARGET" | cut -d'/' -f1 | sed 's/\.[0-9]*$//')
        echo -e "${CYAN}Using ping sweep (${BASE}.1-254):${RESET}"
        ALIVE=()
        for i in $(seq 1 254); do
            if ping -c 1 -W 1 "${BASE}.${i}" &>/dev/null; then
                echo -e "  ${GREEN}alive${RESET}: ${BASE}.${i}"
                ALIVE+=("${BASE}.${i}")
            fi
        done
        echo ""
        echo "Found ${#ALIVE[@]} live host(s)."

        # Quick port scan on alive hosts
        if [[ ${#ALIVE[@]} -gt 0 && "$MODE" == "--full" ]]; then
            echo ""
            echo -e "${BOLD}── Port Scan (alive hosts) ──${RESET}"
            COMMON_PORTS=(22 80 443 3000 3141 5432 6379 8080 8443 18369)
            for host in "${ALIVE[@]}"; do
                echo -e "\n${CYAN}${host}:${RESET}"
                for port in "${COMMON_PORTS[@]}"; do
                    (echo >/dev/tcp/"${host}"/"${port}") 2>/dev/null && \
                        echo -e "  ${GREEN}open${RESET}: ${port}"
                done
            done
        fi
    fi

    exit 0
fi

# ─── Single Host Scan ───────────────────────────────────────────────────────

echo -e "${BOLD}── Host Check ──${RESET}"

# Ping
if ping -c 1 -W 2 "$TARGET" &>/dev/null; then
    TTL=$(ping -c 1 "$TARGET" 2>/dev/null | grep -oE 'ttl=[0-9]+' | cut -d= -f2)
    echo -e "  Status: ${GREEN}alive${RESET}"
    echo -e "  TTL:    ${TTL:-unknown}"
    if [[ -n "$TTL" ]]; then
        if (( TTL <= 64 )); then echo -e "  OS:     likely Linux/macOS"
        elif (( TTL <= 128 )); then echo -e "  OS:     likely Windows"
        else echo -e "  OS:     likely network device"
        fi
    fi
else
    echo -e "  Status: ${RED}unreachable${RESET} (host may be blocking ICMP)"
fi

echo ""

# Port scan
echo -e "${BOLD}── Port Scan ──${RESET}"

if $HAS_NMAP; then
    if [[ "$MODE" == "--full" ]]; then
        echo -e "${CYAN}Full scan with service detection:${RESET}"
        nmap -sT -sV -p- -T4 "$TARGET" 2>/dev/null
    else
        echo -e "${CYAN}Quick scan (top 100 ports):${RESET}"
        nmap -F "$TARGET" 2>/dev/null
    fi
else
    echo -e "${CYAN}Scanning common ports (no nmap):${RESET}"
    PORTS=(21 22 23 25 53 80 110 143 443 445 993 995 \
           1433 1521 3000 3141 3306 3389 5000 5432 5672 \
           6379 6443 7788 8080 8443 8888 9090 9200 18369 27017)

    for port in "${PORTS[@]}"; do
        if $HAS_NC; then
            if nc -z -w "$TIMEOUT" "$TARGET" "$port" 2>/dev/null; then
                echo -e "  ${GREEN}open${RESET}: ${port}"
            fi
        else
            if (echo >/dev/tcp/"$TARGET"/"$port") 2>/dev/null; then
                echo -e "  ${GREEN}open${RESET}: ${port}"
            fi
        fi
    done
fi

echo ""
echo -e "${BOLD}Done.${RESET}"
