#!/bin/bash

# ================================================
#   Install Node.js in WSL (run this ONCE if
#   node is not found)
# ================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

clear
echo -e "${CYAN}"
echo "  ================================================"
echo "   Node.js Installer for WSL"
echo "  ================================================"
echo -e "${NC}"

echo -e "${YELLOW}Updating apt packages...${NC}"
sudo apt-get update -y

echo ""
echo -e "${YELLOW}Installing Node.js v20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo ""
if command -v node &>/dev/null; then
    echo -e "${GREEN}[SUCCESS] Node.js installed!${NC}"
    echo "  Node version: $(node --version)"
    echo "  npm version:  $(npm --version)"
    echo ""
    echo -e "  Now run: ${CYAN}bash run-wsl.sh${NC}"
else
    echo -e "${RED}[FAILED] Node.js installation failed.${NC}"
    echo "  Try manually: sudo apt-get install nodejs"
fi

echo ""
read -p "Press Enter to exit..."
