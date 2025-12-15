# Changelog

All notable changes to ClaudeTerm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2024-12-15

### 🎉 Initial Release

#### Features

- **Full Terminal Emulation**
  - Complete xterm.js integration
  - Support for all interactive commands (vim, nano, claude, htop, etc.)
  - Proper PTY support via Python proxy
  - Terminal resize handling

- **Theme System**
  - Light theme (default) - professional and clean
  - Dark theme - easy on the eyes
  - Custom theme editor with full ANSI 16-color control
  - Theme preview and switching

- **Smart Directory Management**
  - Auto-cd to current note's directory
  - Falls back to vault root when no note is active
  - Configurable via settings

- **Keyboard Shortcuts**
  - Open Terminal
  - Toggle Terminal (show/hide)
  - Focus Terminal
  - Clear Terminal
  - Restart Terminal
  - All commands support custom hotkey binding

- **Settings UI**
  - Theme selection and customization
  - Behavior configuration
  - Color picker for custom themes
  - Reset to defaults option

#### Technical Highlights

- Python PTY proxy architecture bypasses Electron native module limitations
- Precise ECHO control prevents character duplication
- Bidirectional data streaming
- Clean error handling and recovery
- Automatic terminal sizing

#### Documentation

- Comprehensive README with examples
- Architecture documentation (ARCHITECTURE.md)
- Development guide (CLAUDE.md)
- Installation instructions
- Troubleshooting guide

### Platform Support

- ✅ macOS (tested on macOS 14+)
- ✅ Linux (tested on Ubuntu 22.04+)
- ❌ Windows (planned for future release)

### Known Limitations

- Requires Python 3 installed on system
- Desktop-only (not available on mobile)
- Single terminal instance (multi-tab planned)
- No session persistence across restarts (planned)

---

## [Unreleased]

### Planned Features

- [ ] Windows support via conpty/winpty
- [ ] Multiple terminal tabs
- [ ] Session persistence
- [ ] Command history search
- [ ] Custom startup commands
- [ ] Terminal profiles
- [ ] Split terminal views

---

[1.0.0]: https://github.com/chicogong/obsidian-claude-code/releases/tag/v1.0.0
