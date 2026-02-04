# Change Log

All notable changes to the "Set Window Color & Name" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [2.1.0] - 2026-02-04

### Added
- User preference system for per-workspace color settings stored in user preferences
- New `windowColor.workspaceSettings` configuration for persistent per-workspace settings

### Changed
- Completed internal refactoring to use window terminology consistently

## [2.0.0] - 2025-01-12

### Changed
- **BREAKING**: Completely rebranded extension from "project-colors" to "Set Window Color & Name"
- **BREAKING**: Updated all internal types and interfaces to use "window" terminology instead of "project/workspace"
- **BREAKING**: Configuration namespace changed from `projectColors.*` to `windowColor.*`
- **BREAKING**: Configuration key `windowColor.isProjectNameColored` renamed to `windowColor.isWindowNameColored`
- Updated all user-facing text to use "window" instead of "workspace" or "project"
- Updated extension ID to `set-window-color-name`
- Updated repository URL to `https://github.com/lennardv2/vscode-window-colors-name`

### Fixed
- Fixed "colorize active items" incorrectly affecting status bar colors when status bar coloring was disabled
- Improved separation between "colorize status bar" and "colorize active items" options

### Removed
- Removed GitHub Actions workflow (manual publishing only)

## [1.1.2] - 2025-08-05

### Fixed
- Fixed extension activation error on remote SSH environments where window files don't have settings property
- Fixed colorization toggles not immediately removing colors when unchecked (title bar, activity bar, status bar, etc.)
- Fixed window name color staying brown instead of using selected window color when "colorize window name" is enabled

## [1.1.1] - 2025-08-05

### Fixed
- Fixed random color only being applied at startup when no existing color is present
- Fixed debounce on window name to work consistently across all settings (especially color picker)
- Fixed window configuration registration error for windowColor.workspaces
- Fixed random color not being displayed correctly in window settings color picker on startup
- Fixed status bar color not being applied on startup when "color status bar" is enabled by default

## [Unreleased]

- Initial release