#!/usr/bin/env bash
set -euo pipefail

os="$(uname -s)"

if [ "${os}" = "Darwin" ]; then
    PLIST="${HOME}/Library/LaunchAgents/com.kenny.obsidian-organize.plist"
    if [ -f "${PLIST}" ]; then
        launchctl unload "${PLIST}" 2>/dev/null || true
        rm -f "${PLIST}"
    fi
    echo "✓ macOS launchd uninstalled"

elif [ "${os}" = "Linux" ]; then
    if systemctl --user is-enabled obsidian-organize.timer >/dev/null 2>&1; then
        systemctl --user disable --now obsidian-organize.timer
        rm -f "${HOME}/.config/systemd/user/obsidian-organize.service"
        rm -f "${HOME}/.config/systemd/user/obsidian-organize.timer"
        systemctl --user daemon-reload
        echo "✓ Linux systemd uninstalled"
    fi
    if crontab -l 2>/dev/null | grep -q "organize.sh"; then
        crontab -l 2>/dev/null | grep -v "organize.sh" | crontab -
        echo "✓ Linux crontab entry removed"
    fi
fi
