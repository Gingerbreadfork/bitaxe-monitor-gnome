# Bitaxe Monitor - GNOME Extension

A GNOME Shell extension that displays real-time stats from your Bitaxe mining device directly on your panel.

## Features

- **Real-time monitoring** of your Bitaxe device
- **Panel display** showing hashrate, temperature, and power consumption
- **Detailed popup menu** with additional stats including:
  - Current, 1m, and 10m hashrate averages
  - ASIC temperature
  - Power consumption and voltage
  - Fan RPM, frequency, efficiency (GH/W)
  - Uptime and shares accepted/rejected
  - Wi-Fi RSSI and voltage rails (when available)
  - ASIC model and firmware version
  - Mining pool information
- **Customizable refresh interval** (1-60 seconds)
- **Toggle display options** for panel stats
- **Auto-refresh** with configurable intervals

## Installation

### Method 1: Manual Installation

1. Clone or download this repository
2. Copy the extension directory to your GNOME extensions folder:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/
   cp -r /path/to/bitaxe-monitor-gnome ~/.local/share/gnome-shell/extensions/bitaxe-monitor@gingerbreadfork.github.io
   ```

3. Compile the settings schema:
   ```bash
   cd ~/.local/share/gnome-shell/extensions/bitaxe-monitor@gingerbreadfork.github.io
   glib-compile-schemas schemas/
   ```

4. Restart GNOME Shell:
   - On X11: Press `Alt+F2`, type `r`, and press Enter
   - On Wayland: Log out and log back in

5. Enable the extension:
   ```bash
   gnome-extensions enable bitaxe-monitor@gingerbreadfork.github.io
   ```

### Method 2: Using the Install Script

```bash
./install.sh
```

## Configuration

1. Open GNOME Extensions app or use:
   ```bash
   gnome-extensions prefs bitaxe-monitor@gingerbreadfork.github.io
   ```

2. Enter your Bitaxe IP address (e.g., `192.168.1.100`)
3. Configure refresh interval (default: 5 seconds)
4. Toggle which stats to display on the panel

## AxeOS API

This extension uses the AxeOS API to fetch stats from your Bitaxe device. The main endpoint used is:

```
http://<bitaxe-ip>/api/system/info
```

This returns comprehensive system information including hashrate, temperature, power consumption, and device details.

## Requirements

- GNOME Shell 45 or 46
- A Bitaxe device running AxeOS firmware
- Network access to your Bitaxe device

Tested working on a Bitaxe Gamma 602.

## Troubleshooting

### Extension not showing stats

1. Verify your Bitaxe IP address is correct in the settings
2. Ensure your Bitaxe is accessible from your computer (try pinging it)
3. Check the AxeOS web interface is accessible at `http://<bitaxe-ip>`
4. Look for errors in the GNOME Shell logs:
   ```bash
   journalctl -f -o cat /usr/bin/gnome-shell
   ```

### Extension not loading

1. Ensure the extension is enabled:
   ```bash
   gnome-extensions enable bitaxe-monitor@gingerbreadfork.github.io
   ```

2. Check for JavaScript errors:
   ```bash
   journalctl -f -o cat /usr/bin/gnome-shell | grep bitaxe
   ```

3. Verify the schema is compiled:
   ```bash
   ls ~/.local/share/gnome-shell/extensions/bitaxe-monitor@gingerbreadfork.github.io/schemas/gschemas.compiled
   ```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Credits

- Built for the Bitaxe community
- Uses the AxeOS API from the [ESP-Miner](https://github.com/bitaxeorg/ESP-Miner) project
