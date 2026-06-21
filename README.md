# AI Vault Organizer

An Obsidian plugin that automatically organizes your vault daily using [kiro-cli](https://kiro.dev) AI.

## What it does

- **Classifies** new notes from `Dropbox/` inbox into topic folders
- **Summarizes and restructures** changed notes
- **Merges** duplicate content
- **Resets** template files (e.g. daily notes) back to their template
- **Commits** all changes to git automatically

## Requirements

- [kiro-cli](https://kiro.dev) installed and authenticated
- Vault must be a git repository (`git init`)
- macOS or Linux

## Installation

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](../../releases/latest)
2. Copy to `<vault>/.obsidian/plugins/ai-vault-organizer/`
3. Copy `organize.sh`, `prompt-template.txt` to `<vault>/.obsidian/vault-organizer/`
4. Enable the plugin in Obsidian settings

### Schedule (run without Obsidian open)

```bash
# macOS / Linux
OBSIDIAN_VAULT=/path/to/vault bash install.sh
```

To uninstall the schedule:
```bash
bash uninstall.sh
```

## Configuration

In Obsidian → Settings → AI Vault Organizer:

| Setting | Default | Description |
|---------|---------|-------------|
| organize.sh path | `<vault>/.obsidian/vault-organizer/organize.sh` | Path to the shell script |
| kiro-cli path | `kiro-cli` | Full path if not in PATH |
| Vault override | (current vault) | Override OBSIDIAN_VAULT |
| Scheduled time | `06:00` | Daily run time (HH:MM) |
| Interval | disabled | Run every N minutes |

## Templates

Place template files in `.obsidian/vault-organizer/templates/`.  
Any vault file matching a template filename will have its content reset to the template on each run.

```
.obsidian/vault-organizer/templates/
  daily-report.md    ← resets vault's daily-report.md each run
```

## How it works

```
Plugin (UI + Scheduler)
  └─ spawn → organize.sh
               ├─ pre-commit uncommitted files
               ├─ collect .md files changed in last 24h
               ├─ build prompt (vault tree + file contents + templates)
               └─ kiro-cli chat --no-interactive --trust-all-tools
                    └─ AI organizes files, git commit + push
```

## License

MIT
