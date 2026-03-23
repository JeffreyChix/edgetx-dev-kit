# EdgeTX Dev Kit

> A VS Code extension for writing EdgeTX Lua scripts with IntelliSense, diagnostics, script generation, and SD card deployment — built for the RC community.

[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue)](https://code.visualstudio.com)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## What is this?

EdgeTX Dev Kit brings a proper development environment to EdgeTX Lua scripting. If you've ever written a widget or telemetry script in a plain text editor, copy-pasted it to an SD card, flashed it to your radio, and stared at a blank screen wondering what went wrong, then this extension is for you.

It connects to auto-generated stubs from the EdgeTX source, gives you real IntelliSense for every API, catches mistakes before you ever touch your radio, and deploys directly to your SD card on save.

## Requirements

- [VS Code](https://code.visualstudio.com/) 1.85 or later
- [Lua Language Server](https://marketplace.visualstudio.com/items?itemName=sumneko.lua) (`sumneko.lua`) — installed automatically as a dependency
- [EdgeTX Companion](https://edgetx.org) (optional, recommended for simulation)

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a Lua file (or create a new one)
3. Run `EdgeTX: Toggle EdgeTX Mode` from the command palette (`Ctrl+Shift+P`)
4. Set your radio profile when prompted — select your EdgeTX version and display type
5. Start writing

The extension activates automatically on any `.lua` file. EdgeTX mode (IntelliSense, diagnostics, API search) activates on top of that once you toggle it on or enable `edgetx.autoActivateOnStart` in settings.

## Features

### IntelliSense & Type Checking

The extension syncs versioned `.d.lua` stub files from the [edgetx-lua-gen](https://github.com/JeffreyChix/edgetx-lua-gen) pipeline — a GitHub Actions workflow that parses EdgeTX C++ source and generates LuaLS-compatible definitions automatically.

Once stubs are loaded, the Lua Language Server provides:

- Autocomplete for all EdgeTX globals (`lcd`, `model`, `system`, `getValue`, etc.)
- Parameter hints and type signatures on hover
- Go-to-definition on any EdgeTX API
- Version-aware types — APIs that changed between versions reflect the correct signature for your profile

Annotate your script with the correct type and LuaLS handles the rest:

```lua
---@type WidgetScript
local script = {
    name = "MyWidget",
    options = { { "Toggle", BOOL, 1 } },
    create = function(zone, options) return {} end,
    refresh = function(widget, event, touchState) end,
}
return script
```

### Script Generation

#### Wizard

Run `EdgeTX: New Script (Wizard)` to open a guided webview that walks you through selecting a script type, EdgeTX version, and display type. The wizard generates a complete, annotated script template in the active editor.

#### Inline Shortcuts

In any `.lua` file with EdgeTX mode active, type `!` at the start of a line to open the script picker, then select a script type and press `Tab` or `Enter`:

| Shortcut | Generates        |
| -------- | ---------------- |
| `!w`     | Widget script    |
| `!t`     | Telemetry script |
| `!f`     | Function script  |
| `!m`     | Mix script       |
| `!o`     | One-time script  |

The trigger text is replaced with a fully annotated script template. A formatter runs automatically if you have a Lua formatter (e.g. `prettier`) installed.

### Diagnostics

The extension runs two layers of diagnostics on every save:

#### Structural checks

- **Missing return statement** — warns if the file doesn't end with a `return` statement
- **Missing required fields** — informs if the returned table is missing non-optional fields for the detected script type and version
- **Wrong field types** — errors if a field is assigned the wrong type (e.g. a string where a function is expected)

These checks read the actual returned table via an AST parse (using `luaparse`).
The extension understands all common script structures and not just table literals:

```lua
-- Inline table
return { name = "X", create = function() end }

-- Variable-initialized table
local script = { name = "X", create = function() end }
return script

-- Sequential assignment
local script = {}
script.name = "X"
script.create = function() end
return script
```

#### Widget-specific checks

- `name` must be 10 characters or less
- `options` maximum: 5 entries on EdgeTX ≤ 2.10, 10 entries from 2.11
- Each option name (first element) must be 10 characters or less with no spaces

#### Lint checks

- **Unavailble APIs on display type** — errors if you use color-only apis: `lcd.setColor()`, `RGB()`, `COLOR_THEME_*`, `TINSIZE` etc. on a B&W profile and vice-versa
- **Version-gated APIs** — errors if you use an API that requires a newer version than your profile (e.g. `touchState` requires 2.6+)
- **Unsupported standard libraries** — errors for `os`, `coroutine`, `package`, `debug` usage; `table` flagged on B&W profiles
- **Unsupported `io` functions** — errors for any `io.*` call outside the five supported functions: `io.open`, `io.close`, `io.read`, `io.write`, `io.seek`

### API Search

Click the EdgeTX icon in the activity bar to open the API Search sidebar. Search across all functions and constants for your active EdgeTX version.

Clicking a result (functions only) inserts a snippet directly into the active editor at the cursor position.

You can also open API Search as a floating panel beside your editor via `EdgeTX: Search API` from the command palette or right-click context menu.

### SD Card Deployment

Configure your SD card path once:

```json
"edgetx.sdCardPath": "/Volumes/EdgeTX"
```

From that point, the extension knows where to deploy each script type based on the `---@type` annotation:

| Script type       | Target path          |
| ----------------- | -------------------- |
| `WidgetScript`    | `WIDGETS/{name}/`    |
| `TelemetryScript` | `SCRIPTS/TELEMETRY/` |
| `FunctionScript`  | `SCRIPTS/FUNCTIONS/` |
| `MixScript`       | `SCRIPTS/MIXES/`     |
| `OneTimeScript`   | `SCRIPTS/TOOLS/`     |

Widget scripts are deployed into a subfolder named after the `name` field in the returned table. If the name field can't be resolved, the filename is used as a fallback.

**Auto-deploy on save:**

```json
"edgetx.autoDeployOnSave": true
```

When enabled, every save to a recognized EdgeTX Lua file copies it to the correct SD card location automatically. The status bar shows deploy status briefly after each deploy.

**Manual deploy:**

Run `EdgeTX: Deploy Script to SD Card` from the command palette or right-click menu to deploy the active file on demand.

**Deploy guards:**

Before deploying, the extension checks for errors in the current file. If blocking errors exist, you'll be prompted to confirm before proceeding.

If the SD card path doesn't exist or the card is ejected, you will be notified.

### Radio Profile

Run `EdgeTX: Set Radio Profile` to configure:

- **EdgeTX version** — determines which stubs and API docs are loaded, and which version-gated diagnostics apply
- **Display type** — `color` or `bw` or `monochrome`, used to flag display-specific API misuse
- **Radio name** — shown in the status bar for quick reference

The active profile is shown in the status bar:

```
EdgeTX: Jumper T20 2.10
```

### Stub Sync

Stubs are fetched from a remote pipeline that tracks EdgeTX releases. On activation, the extension checks for stub updates silently in the background.

Run `EdgeTX: Check for API Updates and Sync` to force a manual sync.

The base URL is configurable if you host your own stubs:
PLEASE BE CAREFUL HERE.

```json
"edgetx.stubsRawBaseUrl": "https://raw.githubusercontent.com/JeffreyChix/edgetx-stubs/main"
```

## Commands

All commands are available via `Ctrl+Shift+P` and prefixed with `EdgeTX:`.

| Command                                  | Description                                                 |
| ---------------------------------------- | ----------------------------------------------------------- |
| `EdgeTX: Toggle EdgeTX Mode`             | Enable or disable EdgeTX mode for the current workspace     |
| `EdgeTX: Set Radio Profile`              | Configure your radio's EdgeTX version and display type      |
| `EdgeTX: New Script (Wizard)`            | Open the guided script generation wizard                    |
| `EdgeTX: New Widget Script`              | Generate a widget script template in the active editor      |
| `EdgeTX: New Telemetry Script`           | Generate a telemetry script template                        |
| `EdgeTX: New Function Script`            | Generate a function script template                         |
| `EdgeTX: New Mix Script`                 | Generate a mix script template                              |
| `EdgeTX: New OneTime Script`             | Generate a one-time script template                         |
| `EdgeTX: Search API`                     | Open the API search panel                                   |
| `EdgeTX: Deploy Script to SD Card`       | Deploy the active script to the configured SD card path     |
| `EdgeTX: Check for API Updates and Sync` | Force a stub sync against the remote pipeline               |
| `EdgeTX: Simulate Script`                | _(Coming soon)_ Live script simulation via EdgeTX Companion |

## Extension Settings

| Setting                      | Type      | Default        | Description                                                     |
| ---------------------------- | --------- | -------------- | --------------------------------------------------------------- |
| `edgetx.autoActivateOnStart` | `boolean` | `false`        | Automatically enable EdgeTX mode on start if a Lua file is open |
| `edgetx.autoDeployOnSave`    | `boolean` | `false`        | Deploy to SD card automatically on every save                   |
| `edgetx.sdCardPath`          | `string`  | —              | Absolute path to your EdgeTX SD card root                       |
| `edgetx.checkUpdatesOnStart` | `boolean` | `true`         | Check for stub updates when the extension activates             |
| `edgetx.stubsRawBaseUrl`     | `string`  | GitHub raw URL | Base URL for stub file hosting                                  |

## Script Types

EdgeTX Dev Kit supports all five EdgeTX Lua script types:

### Widget Script

Displayed in a zone on color LCD radios. Requires `name`, `create`, and `refresh`. Optional: `options`, `update`, `background`.

### Telemetry Script

Displayed on a telemetry screen page. Has full LCD access. Requires `run`. Optional: `init`, `background`.

### Function Script

Activated by a switch. Runs in the background. No LCD access. Requires `run`. Optional: `init`, `background` (from 2.4).

### Mix Script

Custom mix that reads inputs and produces outputs. Requires `run`. Optional: `input`, `output`, `init`. **Do not use for anything safety-critical.**

### One-Time Script

Runs once when activated. Useful for setup or configuration. Requires `run`. Optional: `init`.

## Release Notes

### 1.0.0

Initial release.

- LuaLS IntelliSense via versioned auto-generated stubs
- Version-aware diagnostics (structural, lint, widget constraints)
- Script generation wizard and inline `!w`, `!t`, `!f`, `!m`, `!o` shortcuts
- API Search sidebar and panel
- Radio profile management
- SD card auto-deploy
- Stub sync pipeline integration

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/JeffreyChix/edgetx-dev-kit).

If you find a bug or want to request a feature, open an issue with as much detail as possible — EdgeTX version, radio model, and a minimal script to reproduce the problem.
