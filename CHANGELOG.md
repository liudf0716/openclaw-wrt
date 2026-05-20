# Changelog

## 2026.5.20

### Features

- Add optional `notificationTarget` plugin config for device event delivery context injection.
- Publish `notificationTarget` in the plugin config schema and manifest.

## 2026.4.5

### Features

- Initial release of the openclaw-wrt extension.
- Chawrtd event-stream client for managing openclaw-wrt enabled OpenWrt routers.
- Device connection management with alias support (Router-1, Router-2, etc.).
- Comprehensive tool suite for router management:
  - Device discovery and status monitoring
  - Client management (list, info, kickoff, temporary pass)
  - Wi-Fi configuration (get/set SSID, password, encryption)
  - Trusted domains and MAC allowlists
  - Auth server configuration
  - Shell command execution
  - Device reboot
