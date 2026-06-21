#!/usr/bin/env bash
set -euo pipefail

OBSIDIAN_VAULT="${OBSIDIAN_VAULT:-/Users/kenny/ObsidianVaults/KennyGollum}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORGANIZE_SCRIPT="${SCRIPT_DIR}/organize.sh"

mkdir -p "${OBSIDIAN_VAULT}/_history"

os="$(uname -s)"

if [ "${os}" = "Darwin" ]; then
    PLIST_DEST="${HOME}/Library/LaunchAgents/com.kenny.obsidian-organize.plist"
    mkdir -p "${HOME}/Library/LaunchAgents"
    sed -e "s|{{OBSIDIAN_VAULT}}|${OBSIDIAN_VAULT}|g" \
        -e "s|{{ORGANIZE_SCRIPT}}|${ORGANIZE_SCRIPT}|g" \
        "${SCRIPT_DIR}/launchd/com.kenny.obsidian-organize.plist.template" \
        > "${PLIST_DEST}"
    launchctl load "${PLIST_DEST}"
    echo "✓ macOS launchd installed: ${PLIST_DEST}"

elif [ "${os}" = "Linux" ]; then
    if systemctl --user status >/dev/null 2>&1; then
        SYSTEMD_DIR="${HOME}/.config/systemd/user"
        mkdir -p "${SYSTEMD_DIR}"
        sed -e "s|{{OBSIDIAN_VAULT}}|${OBSIDIAN_VAULT}|g" \
            -e "s|{{ORGANIZE_SCRIPT}}|${ORGANIZE_SCRIPT}|g" \
            "${SCRIPT_DIR}/systemd/obsidian-organize.service.template" \
            > "${SYSTEMD_DIR}/obsidian-organize.service"
        sed -e "s|{{OBSIDIAN_VAULT}}|${OBSIDIAN_VAULT}|g" \
            "${SCRIPT_DIR}/systemd/obsidian-organize.timer.template" \
            > "${SYSTEMD_DIR}/obsidian-organize.timer"
        systemctl --user daemon-reload
        systemctl --user enable --now obsidian-organize.timer
        echo "✓ Linux systemd user timer installed"
    else
        (crontab -l 2>/dev/null; echo "0 6 * * * OBSIDIAN_VAULT=${OBSIDIAN_VAULT} bash ${ORGANIZE_SCRIPT}") | crontab -
        echo "✓ Linux crontab installed"
    fi
else
    echo "Unsupported OS: ${os}" >&2
    exit 1
fi
