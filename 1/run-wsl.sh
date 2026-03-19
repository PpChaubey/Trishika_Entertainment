#!/bin/bash

# ================================================
#   THE WEIGHT OF SILENCE - WSL Setup & Runner
#   Directory: /mnt/c/Users/Himanshu/Desktop/MOVIES/MOVI
# ================================================

WINDOWS_DIR="/mnt/c/Users/Himanshu/Desktop/MOVIES/MOVI"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}"
echo "  ================================================"
echo "   THE WEIGHT OF SILENCE - AI Thriller Server"
echo "   WSL Runner for Himanshu"
echo "  ================================================"
echo -e "${NC}"

# ── Step 1: Go to project directory ──────────────────
echo -e "${YELLOW}[1/5] Navigating to project directory...${NC}"
cd "$WINDOWS_DIR" 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Cannot find directory: $WINDOWS_DIR${NC}"
    echo "        Make sure the MOVI folder exists on your Desktop."
    read -p "Press Enter to exit..."
    exit 1
fi
echo -e "${GREEN}[OK] In: $(pwd)${NC}"
echo ""

# ── Step 2: Check Node.js ─────────────────────────────
echo -e "${YELLOW}[2/5] Checking Node.js...${NC}"
if ! command -v node &>/dev/null; then
    echo -e "${RED}[ERROR] Node.js not found in WSL!${NC}"
    echo ""
    echo "  Run these commands to install it:"
    echo -e "${CYAN}"
    echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    echo -e "${NC}"
    read -p "Press Enter to exit..."
    exit 1
fi
echo -e "${GREEN}[OK] Node $(node --version) found${NC}"
echo ""

# ── Step 3: Check/create .env ─────────────────────────
echo -e "${YELLOW}[3/5] Checking .env config...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}[!] .env not found. Creating it now...${NC}"
    echo ""
    echo -e "  Get your key from: ${CYAN}https://console.x.ai${NC}"
    echo ""
    read -p "  Paste your Grok API key: " GROK_KEY
    if [ -z "$GROK_KEY" ]; then
        echo -e "${RED}[ERROR] No key entered. Exiting.${NC}"
        read -p "Press Enter to exit..."
        exit 1
    fi
    echo "GROK_API_KEY=$GROK_KEY" > .env
    echo "PORT=3000" >> .env
    echo -e "${GREEN}[OK] .env created with your API key!${NC}"
else
    echo -e "${GREEN}[OK] .env found${NC}"
fi
echo ""

# ── Step 4: Install dependencies ─────────────────────
echo -e "${YELLOW}[4/5] Checking dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo "  Installing npm packages (first time only)..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] npm install failed!${NC}"
        read -p "Press Enter to exit..."
        exit 1
    fi
    echo -e "${GREEN}[OK] Dependencies installed!${NC}"
else
    echo -e "${GREEN}[OK] node_modules found${NC}"
fi
echo ""

# ── Step 5: Start server ──────────────────────────────
echo -e "${YELLOW}[5/5] Starting server...${NC}"
echo ""
echo -e "${CYAN}  ------------------------------------------------"
echo "   Server running at: http://localhost:3000"
echo "   Open that URL in your Windows browser!"
echo "   Press Ctrl+C to stop"
echo -e "  ------------------------------------------------${NC}"
echo ""

node server.js
