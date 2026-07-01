# <img src="matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge Atomberg Plugin

![Node.js CI](https://github.com/cylon147/Atomberg_Fan_Matterbridge_plugin/actions/workflows/build-matterbridge-plugin.yml/badge.svg)
![CodeQL](https://github.com/cylon147/Atomberg_Fan_Matterbridge_plugin/actions/workflows/codeql.yml/badge.svg)
[![codecov](https://codecov.io/gh/cylon147/Atomberg_Fan_Matterbridge_plugin/branch/main/graph/badge.svg)](https://codecov.io/gh/cylon147/Atomberg_Fan_Matterbridge_plugin)

[![powered by](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)
[![powered by](https://img.shields.io/badge/powered%20by-matter--history-blue)](https://www.npmjs.com/package/matter-history)
[![powered by](https://img.shields.io/badge/powered%20by-node--ansi--logger-blue)](https://www.npmjs.com/package/node-ansi-logger)
[![powered by](https://img.shields.io/badge/powered%20by-node--persist--manager-blue)](https://www.npmjs.com/package/node-persist-manager)

This repository contains a Matterbridge plugin for Atomberg smart fans. It discovers fans on your LAN via the local UDP API and exposes them to Matter controllers. Local control is performed over UDP with no cloud dependency.

If you like this project and find it useful, please consider giving it a star on GitHub at [Matterbridge Atomberg Plugin](https://github.com/cylon147/Atomberg_Fan_Matterbridge_plugin) and sponsoring it.

<a href="https://buymeacoffee.com/cylon147">
  <img src="bmc-button.svg" alt="Buy me a coffee" width="120">
</a>

## Features

- **Local discovery**: listens on UDP 5625 for Atomberg beacons/state.
- **Local control**: sends JSON commands on UDP 5600 (power, speed, sleep, timer, light, brightness, color).
- **Matter clusters exposed**: FanControl (multi-speed), LevelControl (brightness), ColorControl (CT mapping).
- **TypeScript toolchain**: ESLint, Prettier, Jest, Vitest pre-configured.
- **Dev Container (optional)** for an instant development environment.

## Getting Started

1. Install dependencies and build:
   - `npm ci`
   - `npm run build`
2. Register the plugin into Matterbridge:
   - `matterbridge -add .`
   - `matterbridge -enable .`
   - `matterbridge -list` (verify it shows `matterbridge-atomberg-plugin`)
3. Run Matterbridge and pair with your controller. The plugin will expose discovered Atomberg fans.
