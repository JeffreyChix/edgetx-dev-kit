# Changelog

All notable changes to EdgeTX Dev Kit are documented here.

## [Unreleased]

Nothing yet. Follow the [repository](https://github.com/JeffreyChix/edgetx-dev-kit) to stay up to date.

## [2.2.0] — 2026-06-09

### Added

- **Simulator log viewer** — A **Logs** panel in the simulator header captures all output from the running firmware and your Lua scripts in real time. Up to 1000 entries are retained per session and the log clears automatically on each new simulation start.

- **Log level tagging** — Every log entry is tagged with a colored source label: `lua` (standard output from scripts), `fw` (internal EdgeTX firmware trace messages), and `err` (Lua runtime errors and stderr). Colors follow the active VS Code theme via CSS variables.

- **Log filtering and search** — Toggle source chips (**Lua**, **FW**, **Err**) to show or hide each log level independently. A search bar filters entries by text, case-insensitively, on top of the active source filters. Hover a chip to see a tooltip describing what it captures.

- **Auto-scroll toggle** — A **↓** button in the log panel header enables or disables automatic scrolling to the latest entry. When disabled, the view stays locked so you can scroll back freely.

- **Log panel state persistence** — The open/closed state of the log panel is saved to `globalState` and restored when the simulator is reopened, consistent with Controls and Telemetry panel persistence.

### Fixed

- **Keyboard input leaking into search bar** — Simulator keyboard shortcuts (stick movements, switch toggles, etc.) no longer fire when focus is inside the log search bar or any other text input in the simulator panel.

---

## [2.1.0] — 2026-05-23

### Added

- **Multi-file watch mode** — Watch mode now reacts to saves across all open `.lua` files, not just the entry point. Editing a helper script that your widget or telemetry script depends on now triggers an automatic reload just like editing the main file would.

- **Manual reload button** — A `↻` icon button in the simulator header lets you restart the simulation at any time without saving a file or re-running a command.

- **Keyboard shortcuts** — Six commands now have default keybindings. Script-specific shortcuts are scoped to Lua files with EdgeTX mode active:
  | Command | Windows / Linux | Mac |
  |---|---|---|
  | Watch Script | `Ctrl+Alt+W` | `Cmd+Alt+W` |
  | Simulate Script | `Ctrl+Alt+S` | `Cmd+Alt+S` |
  | Deploy Script | `Ctrl+Alt+D` | `Cmd+Alt+D` |
  | Search API | `Ctrl+Alt+A` | `Cmd+Alt+A` |
  | Open Simulator | `Ctrl+Alt+O` | `Cmd+Alt+O` |
  | Set Radio Profile | `Ctrl+Alt+P` | `Cmd+Alt+P` |


### Changed

- **Wide-screen radios open in a full-width tab** — Radios with a screen width greater than 490px (e.g. RadioMaster TX16S MK3) now open the simulator as a tab in the active editor group instead of a split side panel, giving the larger display the space it needs.

### Fixed

- **Simulator panel jumps back to side panel on watch reload** — When the simulator was moved to a standalone tab, a watch-triggered reload would force it back to the side panel. The panel now stays wherever the user placed it.

---

## [2.0.0] — 2026-05-16

### Added

- **Built-in EdgeTX simulator** — The actual EdgeTX firmware compiled to WebAssembly runs directly inside VS Code via `EdgeTX: Open Simulator`. No EdgeTX Companion or external tools required. The simulator displays the radio LCD and responds to all inputs in real time.

- **Script simulation** — `EdgeTX: Simulate Script` reads the `---@type` annotation of the active Lua file, auto-deploys it to the SD card, and launches it in the simulator immediately. Widget scripts appear on the main screen; telemetry scripts run standalone. Both color LCD and monochrome (B&W) radios are supported.

- **Watch mode** — `EdgeTX: Watch Script` combines simulation with live reload. Every file save triggers an automatic redeploy and simulator restart. A **● WATCHING** badge in the simulator header confirms watch mode is active.

- **`---@simulate` annotation** — Widget scripts can declare a specific layout and zone to simulate in, matching the exact screen area they will occupy on the radio:
  ```lua
  ---@simulate Layout2x2 zone=1
  ```
  Omitting the annotation defaults to a full-screen zone.

- **Controls panel** — A collapsible panel in the simulator exposes the full radio control set: dual gimbals with spring physics, switches, buttons, pots, sliders, and trim buttons. All inputs are wired live to the running firmware.

- **Telemetry streaming** — A dedicated Telemetry panel streams simulated CRSF telemetry frames to the firmware at 10 Hz across five tabs: Link, GPS, Attitude, Battery, and Flight. Values are editable per-field and streaming can be toggled on or off independently of the simulation.

- **Audio support** — Simulator audio (beeps, alerts, speech) is captured from the firmware and played back through the host audio context.

- **WASM caching with ETag validation** — The WASM firmware binary is downloaded once and cached to disk. On subsequent launches the extension performs a lightweight HEAD request to check for a newer build; re-download only happens when a new firmware version is detected.

- **Simulator session persistence** — Radio model settings and any changes made during a simulation session (configured models, stored settings) are saved to disk and restored on the next boot, giving continuity across sessions.

- **Model backup and restore** — When `Simulate Script` injects a widget into the active model, the original model state is backed up and restored automatically when the simulator panel closes, so subsequent plain simulator opens start from a clean state.

- **Simulator UI state persistence** — Show/Hide Controls and Telemetry panel open/closed states are remembered across sessions via `globalState`.


### Changed

- **Radio profile IDs updated** — Supported radio definitions have been revised and some radio identifiers have changed. **Existing users must run `EdgeTX: Set Radio Profile` after upgrading** to reselect their radio and clear any stale profile data.

- **`sdCardPath` now also drives the simulator filesystem** — When an SD card path is configured, the simulator reads and writes from that path directly, keeping simulation in sync with real radio data.

---

## [1.1.2] — 2026-04-06

### Added
- **`bit32` deprecation warning** — Warns when using `bit32` in EdgeTX v2.11+ (Lua 5.3), where it is deprecated in favor of native bitwise operators (`&`, `|`, `~`)

## [1.1.1] — 2026-04-06

### Fixed
 - Fixed `lvgl` lint checks in unknown scripts.

## [1.1.0] — 2026-04-06

### Added
- LVGL API support — Full LVGL widget API coverage including widget constructors, settings table intellisense, and both functional and OOP call styles
- Workspace-free activation — EdgeTX Dev Kit can now be activated without an active workspace or folder open. Just open a lua file and work.

### Fixed
- `bit32` library unavailable — Resolved an issue where bit32 was not recognized due to the Lua version target; the extension now correctly defaults to Lua 5.2
- Bundled EdgeTX versions not sorted — Fixed incorrect ordering of bundled EdgeTX versions; they now appear sorted from latest to oldest
- Various stability improvements — Additional bug fixes and reliability improvements across the extension

## [1.0.0] — 2026-03-23

### Added

- **IntelliSense** — versioned `.d.lua` stub files synced from the `edgetx-lua-gen` pipeline, providing autocomplete, hover signatures, and go-to-definition for all EdgeTX globals across supported versions
- **Radio profile** — configure EdgeTX version, display type (color/B&W), and radio name via `EdgeTX: Set Radio Profile`
- **Script generation wizard** — guided webview for generating annotated script templates via `EdgeTX: New Script (Wizard)`
- **Inline script shortcuts** — type `!` at the start of a line, select and press Tab to generate a script template in place
- **Structural diagnostics** — AST-based checks for missing return statements, missing required fields, and wrong field types against the returned table
- **Widget constraint diagnostics** — enforces widget `name` length (≤10 chars), options count limits (5 for ≤2.10, 10 from 2.11), option name rules (≤10 chars, no spaces) and widget scripts on color displays only
- **Lint diagnostics** — flags display specific apis, version-gated API usage, unsupported standard libraries (`os`, `coroutine`, `package`, `debug`), unsupported `io` functions and lcd unsupported scripts
- **API Search** — sidebar view and floating panel for searching EdgeTX functions and constants with snippet insertion
- **SD card deployment** — auto-deploy on save or manual deploy via `EdgeTX: Deploy Script to SD Card`, with script-type-aware target path resolution and deploy guards against scripts with errors
- **Stub sync** — background sync on activation with manual trigger via `EdgeTX: Check for API Updates and Sync`

---

[Unreleased]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v1.1.2...v2.0.0
[1.1.2]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/JeffreyChix/edgetx-dev-kit/releases/tag/v1.0.0
