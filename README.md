# <img src="matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge Atomberg Fan Plugin

[![npm version](https://img.shields.io/npm/v/matterbridge.svg)](https://www.npmjs.com/package/matterbridge)
[![powered by](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)

Matterbridge plugin that discovers Atomberg fans on your local network via UDP, lets you assign friendly display names, and exposes them as bridged Matter devices (Apple Home, Google Home, etc.).

**Plugin name:** `matterbridge-atomberg-fan`  
**Requires Matterbridge:** `>= 3.9.0` (plugin web UI and `onFetch` API)

## Features

- **UDP discovery** — listens for Atomberg fan status broadcasts (default port **5625**)
- **Web UI** — discover fans by IP, configure display names, and manage Matter registration
- **Custom names** — display names appear in Apple Home and other Matter controllers
- **Live name updates** — renaming a fan already in Matter updates Apple Home without re-adding
- **Full FanControl cluster** — speed, mode, percent, rock, wind, and airflow direction support
- **UDP control** — sends commands back to fans on port **5600** when `device_id` is known from broadcasts

## Web UI

After the plugin is installed and enabled, open:

```
http://<matterbridge-host>:8283/plugins/matterbridge-atomberg-fan/
```

You can also click **OPEN WEB UI** in the plugin settings inside Matterbridge.

Deep link to configure a specific fan:

```
http://<matterbridge-host>:8283/plugins/matterbridge-atomberg-fan/?device=192.168.1.50
```

### Typical workflow

1. Open the web UI and wait for fans to appear in **Discovery** (they must be on the same LAN and broadcasting UDP status).
2. Select a fan by IP address and set a **Display name** (e.g. “Living Room Fan”).
3. Click **Save configuration**.
4. Click **Add to Matter** — Matterbridge may prompt for a restart.
5. Pair or refresh your Matter bridge in Apple Home; the fan appears with your custom name.

If you change the display name later, save again — the name updates live in Apple Home when the fan is already registered.

## Installation

From this repository:

```bash
npm install
npm run build
npm run matterbridge:add
npm run matterbridge:enable
```

Or install from npm once published:

```bash
npm install matterbridge-atomberg-fan
```

Then add and enable the plugin through the Matterbridge frontend or CLI.

## Configuration

Plugin settings are defined in `matterbridge-atomberg-fan.schema.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| `udpListenPort` | `5625` | Port for fan status broadcasts |
| `udpCommandPort` | `5600` | Port for sending control commands |
| `fans` | `[]` | Saved fan configs (IP, display name, Matter flag) |
| `openWebUi` | — | Button to open the plugin web UI |

Fans are identified by **IP address** in the UI. The plugin learns each fan’s `device_id` from UDP broadcasts, which is required for local control commands.

## Plugin API

The web UI calls these routes via Matterbridge’s plugin `onFetch` handler:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `fans` | List discovered and configured fans |
| `GET` | `settings` | UDP ports and Matter device count |
| `POST` | `fans-configure` | Save display/product name by IP |
| `POST` | `fans-matter` | `{ ipAddress, action: "add" \| "remove" }` |
| `POST` | `discovery-refresh` | Refresh the fan list |

## Development

```bash
npm install
npm run build
npm test
```

Useful scripts:

| Script | Description |
|--------|-------------|
| `npm run watch` | TypeScript watch mode |
| `npm run matterbridge:add` | Register plugin with local Matterbridge |
| `npm run matterbridge:enable` | Enable the plugin |
| `npm run matterbridge:remove` | Remove the plugin |
| `npm run dev:link` | Link local Matterbridge for development |

### Project layout

```
src/
  module.ts         # Platform, API, Matter lifecycle
  udpDiscovery.ts   # UDP listener and fan tracking
  fanMatter.ts      # Matter endpoint and FanControl handlers
  types.ts          # Shared types
apps/frontend/build/
  index.html        # Plugin web UI
```

## Dev Container

This project includes a VS Code Dev Container with Node.js, TypeScript, ESLint, Prettier, Jest, and Vitest pre-configured. See [Matterbridge README-DEV](https://github.com/Luligu/matterbridge/blob/main/README-DEV.md) for plugin development guidelines.

> **Note:** The dev container cannot pair Matterbridge over the network; use it for build, test, and plugin logic development.

## License

Apache-2.0
