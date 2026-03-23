# Changelog

All notable changes to EdgeTX Dev Kit are documented here.

## [Unreleased]

Nothing yet. Follow the [repository](https://github.com/JeffreyChix/edgetx-dev-kit) to stay up to date.


## [1.0.0] — 2026-03-22

### Added

- **IntelliSense** — versioned `.d.lua` stub files synced from the `edgetx-lua-gen` pipeline, providing autocomplete, hover signatures, and go-to-definition for all EdgeTX globals across supported versions
- **Radio profile** — configure EdgeTX version, display type (color/B&W), and radio name via `EdgeTX: Set Radio Profile`
- **Script generation wizard** — guided webview for generating annotated script templates via `EdgeTX: New Script (Wizard)`
- **Inline script shortcuts** — type `!` at the start of a line, select and press Tab to generate a script template in place
- **Structural diagnostics** — AST-based checks for missing return statements, missing required fields, and wrong field types against the returned table
- **Widget constraint diagnostics** — enforces widget `name` length (≤10 chars), options count limits (5 for ≤2.10, 10 from 2.11), and option name rules (≤10 chars, no spaces)
- **Lint diagnostics** — flags display specific apis, version-gated API usage, unsupported standard libraries (`os`, `coroutine`, `package`, `debug`), and unsupported `io` functions
- **API Search** — sidebar view and floating panel for searching EdgeTX functions and constants with snippet insertion
- **SD card deployment** — auto-deploy on save or manual deploy via `EdgeTX: Deploy Script to SD Card`, with script-type-aware target path resolution and deploy guards against scripts with errors
- **Stub sync** — background sync on activation with manual trigger via `EdgeTX: Check for API Updates and Sync`

---

[Unreleased]: https://github.com/JeffreyChix/edgetx-dev-kit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/JeffreyChix/edgetx-dev-kit/releases/tag/v1.0.0
