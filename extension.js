import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const BitaxeIndicator = GObject.registerClass(
class BitaxeIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Bitaxe Monitor', false);

        this._settings = settings;
        this._httpSession = new Soup.Session();
        this._cancellable = new Gio.Cancellable();
        this._timeoutId = null;
        this._ipDebounceId = null;
        this._inFlight = false;
        this._stats = null;
        this._destroyed = false;

        this.add_style_class_name('bitaxe-indicator');

        this._label = new St.Label({
            text: 'Bitaxe: --',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.add_style_class_name('bitaxe-label');
        this.add_child(this._label);

        this._createMenuItems();

        this._settingsChangedIds = [];
        const updateKeys = [
            'show-hashrate',
            'show-temperature',
            'show-power',
            'show-vrm-temp',
            'show-efficiency',
            'show-fan-rpm',
            'show-frequency',
            'show-shares',
            'show-uptime',
            'panel-separator',
            'custom-separator',
            'hashrate-unit',
        ];

        for (const key of updateKeys) {
            this._settingsChangedIds.push(
                this._settings.connect(`changed::${key}`, () => this._updateUI())
            );
        }

        this._settingsChangedIds.push(
            this._settings.connect('changed::refresh-interval', () => this._refresh())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::bitaxe-ip', () => this._debounceRefresh())
        );

        this._refresh();
    }

    _createMenuItems() {
        const headerItem = new PopupMenu.PopupMenuItem('Bitaxe Stats', {
            reactive: false,
        });
        headerItem.label.style = 'font-weight: bold;';
        this.menu.addMenuItem(headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._statValueLabels = new Map();
        this._voltageRailRows = new Map();

        this._columnsBox = new St.BoxLayout({
            style_class: 'bitaxe-popup-columns',
            x_expand: true,
        });
        this._leftColumn = new St.BoxLayout({
            style_class: 'bitaxe-popup-column',
            vertical: true,
            x_expand: true,
        });
        this._rightColumn = new St.BoxLayout({
            style_class: 'bitaxe-popup-column',
            vertical: true,
            x_expand: true,
        });
        this._columnsBox.add_child(this._leftColumn);
        this._columnsBox.add_child(this._rightColumn);

        const contentItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        contentItem.actor.add_style_class_name('bitaxe-popup-content');
        contentItem.actor.add_child(this._columnsBox);
        this.menu.addMenuItem(contentItem);

        this._addSection(this._leftColumn, 'Hashrate', [
            {key: 'hashrate', label: 'Hashrate'},
            {key: 'hashrate1m', label: 'Hashrate 1m'},
            {key: 'hashrate10m', label: 'Hashrate 10m'},
            {key: 'hashrate1h', label: 'Hashrate 1h'},
            {key: 'errorRate', label: 'Error Rate'},
        ]);

        this._addSection(this._leftColumn, 'Temperature', [
            {key: 'asicTemp', label: 'ASIC Temp'},
            {key: 'vrmTemp', label: 'VRM Temp'},
            {key: 'tempTarget', label: 'Temp Target'},
        ]);

        this._addSection(this._leftColumn, 'Power', [
            {key: 'power', label: 'Power'},
            {key: 'voltage', label: 'Voltage'},
            {key: 'current', label: 'Current'},
            {key: 'coreVoltage', label: 'Core Voltage'},
        ]);

        this._railsHeader = this._createSectionHeader('Voltage Rails');
        this._railsHeader.visible = false;
        this._leftColumn.add_child(this._railsHeader);
        this._voltageRailsBox = new St.BoxLayout({
            style_class: 'bitaxe-rails-box',
            vertical: true,
            x_expand: true,
        });
        this._voltageRailsBox.visible = false;
        this._leftColumn.add_child(this._voltageRailsBox);

        this._addSection(this._leftColumn, 'Performance', [
            {key: 'fan', label: 'Fan'},
            {key: 'frequency', label: 'Frequency'},
            {key: 'efficiency', label: 'Efficiency'},
            {key: 'overclock', label: 'Overclock'},
        ]);

        this._addSection(this._rightColumn, 'Pool', [
            {key: 'pool', label: 'Pool'},
            {key: 'poolDifficulty', label: 'Pool Diff'},
            {key: 'fallbackPool', label: 'Fallback Pool'},
        ]);

        this._addSection(this._rightColumn, 'Shares', [
            {key: 'sharesAccepted', label: 'Accepted'},
            {key: 'sharesRejected', label: 'Rejected'},
            {key: 'bestDiff', label: 'Best Diff'},
            {key: 'bestSessionDiff', label: 'Session Best'},
        ]);

        this._addSection(this._rightColumn, 'System', [
            {key: 'uptime', label: 'Uptime'},
            {key: 'model', label: 'Model'},
            {key: 'version', label: 'Version'},
            {key: 'boardVersion', label: 'Board Version'},
        ]);

        this._addSection(this._rightColumn, 'Network', [
            {key: 'ipAddress', label: 'IP Address'},
            {key: 'ssid', label: 'SSID'},
            {key: 'wifiRssi', label: 'Wi-Fi RSSI'},
            {key: 'freeHeap', label: 'Free Heap'},
        ]);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Now');
        refreshItem.connect('activate', () => {
            this._fetchStats();
        });
        this.menu.addMenuItem(refreshItem);
    }

    _refresh() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        this._fetchStats();

        let interval = this._settings.get_int('refresh-interval');
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._fetchStats();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _debounceRefresh() {
        if (this._ipDebounceId) {
            GLib.source_remove(this._ipDebounceId);
            this._ipDebounceId = null;
        }

        this._ipDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            500,
            () => {
                this._ipDebounceId = null;
                this._refresh();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _fetchStats() {
        if (this._destroyed) {
            return;
        }

        let ip = this._settings.get_string('bitaxe-ip');

        if (!ip || ip === '') {
            this._clearStatsUI('No IP set');
            return;
        }

        let url = `http://${ip}/api/system/info`;
        let message = Soup.Message.new('GET', url);

        if (this._inFlight) {
            this._cancellable.cancel();
            this._cancellable = new Gio.Cancellable();
        }

        this._inFlight = true;
        this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            this._cancellable,
            (session, result) => {
                try {
                    if (this._destroyed) {
                        return;
                    }

                    let bytes = session.send_and_read_finish(result);
                    let decoder = new TextDecoder('utf-8');
                    let response = decoder.decode(bytes.get_data());

                    this._stats = JSON.parse(response);
                    this._updateUI();
                } catch (e) {
                    if (this._destroyed) {
                        return;
                    }

                    if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        return;
                    }

                    logError(e, 'Failed to fetch Bitaxe stats');
                    this._clearStatsUI('Error');
                } finally {
                    this._inFlight = false;
                }
            }
        );
    }

    _updateUI() {
        if (this._destroyed || !this._stats) {
            return;
        }

        let labelParts = [];

        if (this._settings.get_boolean('show-hashrate')) {
            let hashrate = this._formatHashrate(this._toNumber(this._stats.hashRate, 0));
            labelParts.push(hashrate);
        }

        if (this._settings.get_boolean('show-temperature')) {
            // Always prioritize ASIC temp for panel display
            let asicTemp = Math.round(this._toNumber(this._stats.temp, 0));
            labelParts.push(`${asicTemp}°C`);
        }

        if (this._settings.get_boolean('show-vrm-temp')) {
            let vrmTemp = Math.round(this._toNumber(this._stats.vrTemp, 0));
            labelParts.push(`VRM:${vrmTemp}°C`);
        }

        if (this._settings.get_boolean('show-power')) {
            let power = this._toNumber(this._stats.power, 0).toFixed(1);
            labelParts.push(`${power}W`);
        }

        if (this._settings.get_boolean('show-efficiency')) {
            let efficiency = this._getStatNumber(['efficiency', 'efficiencyGHW'], NaN);
            if (!Number.isFinite(efficiency)) {
                let hr = this._toNumber(this._stats.hashRate, 0);
                let pwr = this._toNumber(this._stats.power, 0);
                if (pwr > 0 && hr > 0) {
                    efficiency = hr / pwr;
                }
            }
            if (Number.isFinite(efficiency)) {
                labelParts.push(`${efficiency.toFixed(1)}GH/W`);
            }
        }

        if (this._settings.get_boolean('show-fan-rpm')) {
            let fanRpm = this._toNumber(this._stats.fanrpm, 0);
            if (fanRpm > 0) {
                labelParts.push(`${fanRpm}RPM`);
            }
        }

        if (this._settings.get_boolean('show-frequency')) {
            let frequency = this._toNumber(this._stats.frequency, 0);
            if (frequency > 0) {
                labelParts.push(`${frequency}MHz`);
            }
        }

        if (this._settings.get_boolean('show-shares')) {
            let shares = this._toNumber(this._stats.sharesAccepted, 0);
            labelParts.push(`${shares}sh`);
        }

        if (this._settings.get_boolean('show-uptime')) {
            let uptimeSeconds = this._toNumber(this._stats.uptimeSeconds, 0);
            if (uptimeSeconds > 0) {
                let hours = Math.floor(uptimeSeconds / 3600);
                let minutes = Math.floor((uptimeSeconds % 3600) / 60);
                if (hours > 0) {
                    labelParts.push(`${hours}h${minutes}m`);
                } else {
                    labelParts.push(`${minutes}m`);
                }
            }
        }

        let separator = this._settings.get_string('custom-separator');
        if (!separator || separator === '') {
            separator = this._settings.get_string('panel-separator');
        }
        separator = ` ${separator} `;

        let labelText = labelParts.length > 0
            ? labelParts.join(separator)
            : 'Bitaxe';

        this._updateLabel(labelText);

        this._setStatValue('hashrate', this._formatHashrate(this._toNumber(this._stats.hashRate, 0)));
        this._setStatValue('hashrate1m', this._formatHashrate(this._toNumber(this._stats.hashRate_1m, 0)));
        this._setStatValue('hashrate10m', this._formatHashrate(this._toNumber(this._stats.hashRate_10m, 0)));
        this._setStatValue('hashrate1h', this._formatHashrate(this._toNumber(this._stats.hashRate_1h, 0)));

        let errorPercentage = this._toNumber(this._stats.errorPercentage, 0);
        this._setStatValue('errorRate', `${errorPercentage.toFixed(2)}%`);

        let asicTemp = Math.round(this._toNumber(this._stats.temp, 0));
        this._setStatValue('asicTemp', `${asicTemp}°C`);

        let vrmTemp = Math.round(this._toNumber(this._stats.vrTemp, 0));
        this._setStatValue('vrmTemp', `${vrmTemp}°C`);

        let tempTarget = Math.round(this._toNumber(this._stats.temptarget, 0));
        this._setStatValue('tempTarget', tempTarget > 0 ? `${tempTarget}°C` : '--');

        let power = this._toNumber(this._stats.power, 0).toFixed(2);
        this._setStatValue('power', `${power}W`);

        let voltage = this._toNumber(this._stats.voltage, 0).toFixed(0);
        this._setStatValue('voltage', `${voltage}mV`);

        let current = this._toNumber(this._stats.current, 0).toFixed(0);
        this._setStatValue('current', `${current}mA`);

        let coreVoltage = this._toNumber(this._stats.coreVoltageActual, 0);
        this._setStatValue('coreVoltage', coreVoltage > 0 ? `${coreVoltage}mV` : '--');

        let fanRpm = this._toNumber(this._stats.fanrpm, NaN);
        this._setStatValue('fan', this._formatFanRpm(fanRpm));

        let frequency = this._toNumber(this._stats.frequency, 0);
        this._setStatValue('frequency', this._formatFrequency(frequency));

        let efficiency = this._getStatNumber(['efficiency', 'efficiencyGHW', 'efficiency_ghw', 'ghw', 'gh_per_watt', 'hashRatePerWatt'], NaN);
        if (!Number.isFinite(efficiency)) {
            let hr = this._toNumber(this._stats.hashRate, 0);
            let pwr = this._toNumber(this._stats.power, 0);
            if (pwr > 0 && hr > 0) {
                efficiency = hr / pwr;
            }
        }
        this._setStatValue('efficiency', this._formatEfficiency(efficiency));

        let overclockEnabled = this._toNumber(this._stats.overclockEnabled, 0);
        this._setStatValue('overclock', overclockEnabled === 1 ? 'Enabled' : 'Disabled');

        this._setStatValue('pool', this._stats.stratumURL || 'Not connected');

        let poolDiff = this._toNumber(this._stats.poolDifficulty, 0);
        this._setStatValue('poolDifficulty', this._formatDifficulty(poolDiff));

        let fallbackPool = this._stats.fallbackStratumURL || '--';
        this._setStatValue('fallbackPool', fallbackPool);

        let sharesAccepted = this._toNumber(this._stats.sharesAccepted, 0);
        let sharesRejected = this._toNumber(this._stats.sharesRejected, 0);
        this._setStatValue('sharesAccepted', this._formatCount(sharesAccepted));
        this._setStatValue('sharesRejected', this._formatCount(sharesRejected));

        let bestDiff = this._toNumber(this._stats.bestDiff, 0);
        this._setStatValue('bestDiff', this._formatDifficulty(bestDiff));

        let bestSessionDiff = this._toNumber(this._stats.bestSessionDiff, 0);
        this._setStatValue('bestSessionDiff', this._formatDifficulty(bestSessionDiff));

        this._setStatValue('uptime', this._formatUptime(this._stats.uptimeSeconds));
        this._setStatValue('model', this._stats.ASICModel || 'Unknown');
        this._setStatValue('version', this._stats.version || 'Unknown');

        let boardVersion = this._stats.boardVersion || '--';
        this._setStatValue('boardVersion', boardVersion);

        let ipAddress = this._stats.ipv4 || this._stats.ipAddress || '--';
        this._setStatValue('ipAddress', ipAddress);

        let ssid = this._stats.ssid || '--';
        this._setStatValue('ssid', ssid);

        let rssi = this._toNumber(this._stats.wifiRSSI, NaN);
        this._setStatValue('wifiRssi', this._formatRssi(rssi));

        let freeHeap = this._toNumber(this._stats.freeHeap, 0);
        this._setStatValue('freeHeap', this._formatBytes(freeHeap));

        this._updateVoltageRails();
    }

    _formatHashrate(hashrate) {
        if (!Number.isFinite(hashrate) || hashrate === 0) {
            return '0 GH/s';
        }

        let unit = this._settings.get_string('hashrate-unit');

        // Hashrate is in GH/s from the API
        if (unit === 'TH/s') {
            return `${(hashrate / 1000).toFixed(2)} TH/s`;
        } else if (unit === 'GH/s') {
            return `${hashrate.toFixed(2)} GH/s`;
        } else {
            if (hashrate >= 1000) {
                return `${(hashrate / 1000).toFixed(2)} TH/s`;
            }
            return `${hashrate.toFixed(2)} GH/s`;
        }
    }

    _formatEfficiency(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '--';
        }
        return `${value.toFixed(2)} GH/W`;
    }

    _formatFrequency(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '--';
        }
        return `${value.toFixed(0)} MHz`;
    }

    _formatFanRpm(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '--';
        }
        return `${value.toFixed(0)} RPM`;
    }

    _formatRssi(value) {
        if (!Number.isFinite(value)) {
            return '--';
        }
        return `${value.toFixed(0)} dBm`;
    }

    _formatCount(value) {
        if (!Number.isFinite(value)) {
            return '--';
        }
        return `${Math.round(value)}`;
    }

    _formatUptime(value) {
        if (value === undefined || value === null || value === '') {
            return '--';
        }

        let seconds = Number(value);
        if (!Number.isFinite(seconds)) {
            return String(value);
        }

        seconds = Math.max(0, Math.floor(seconds));
        let days = Math.floor(seconds / 86400);
        let hours = Math.floor((seconds % 86400) / 3600);
        let minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    _formatDifficulty(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '--';
        }

        // Format large numbers with K, M, B, T suffixes
        if (value >= 1e12) {
            return `${(value / 1e12).toFixed(2)}T`;
        } else if (value >= 1e9) {
            return `${(value / 1e9).toFixed(2)}B`;
        } else if (value >= 1e6) {
            return `${(value / 1e6).toFixed(2)}M`;
        } else if (value >= 1e3) {
            return `${(value / 1e3).toFixed(2)}K`;
        }
        return `${Math.round(value)}`;
    }

    _formatBytes(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return '--';
        }

        // Convert bytes to appropriate unit
        if (value >= 1024 * 1024) {
            return `${(value / (1024 * 1024)).toFixed(2)} MB`;
        } else if (value >= 1024) {
            return `${(value / 1024).toFixed(2)} KB`;
        }
        return `${Math.round(value)} B`;
    }

    _toNumber(value, fallback) {
        let num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    _getStatValue(keys) {
        for (let key of keys) {
            if (this._stats && Object.prototype.hasOwnProperty.call(this._stats, key)) {
                let value = this._stats[key];
                if (value !== undefined && value !== null && value !== '') {
                    return value;
                }
            }
        }
        return undefined;
    }

    _getStatNumber(keys, fallback) {
        let value = this._getStatValue(keys);
        return this._toNumber(value, fallback);
    }

    _getSharesValue(keys) {
        if (this._stats && typeof this._stats.shares === 'object' && this._stats.shares !== null) {
            for (let key of keys) {
                if (Object.prototype.hasOwnProperty.call(this._stats.shares, key)) {
                    return this._toNumber(this._stats.shares[key], NaN);
                }
            }
        }

        return this._getStatNumber(keys, NaN);
    }

    _getWifiRssi() {
        let direct = this._getStatNumber(['wifiRSSI', 'wifi_rssi', 'rssi', 'signal', 'wifiSignal'], NaN);
        if (Number.isFinite(direct)) {
            return direct;
        }

        let wifi = null;
        if (this._stats && typeof this._stats.wifi === 'object' && this._stats.wifi !== null) {
            wifi = this._stats.wifi;
        } else if (this._stats && typeof this._stats.wifiInfo === 'object' && this._stats.wifiInfo !== null) {
            wifi = this._stats.wifiInfo;
        } else if (this._stats && typeof this._stats.wlan === 'object' && this._stats.wlan !== null) {
            wifi = this._stats.wlan;
        }

        if (wifi) {
            for (let key of ['rssi', 'RSSI', 'signal', 'signalDbm', 'dbm']) {
                if (Object.prototype.hasOwnProperty.call(wifi, key)) {
                    return this._toNumber(wifi[key], NaN);
                }
            }
        }

        return NaN;
    }

    _formatVoltageValue(value) {
        if (!Number.isFinite(value)) {
            return '--';
        }
        if (value >= 20) {
            return `${value.toFixed(0)} mV`;
        }
        return `${value.toFixed(2)} V`;
    }

    _getVoltageRails() {
        if (!this._stats) {
            return null;
        }

        for (let key of ['voltageRails', 'voltage_rails', 'voltages', 'voltageMap']) {
            if (typeof this._stats[key] === 'object' && this._stats[key] !== null) {
                return this._stats[key];
            }
        }

        return null;
    }

    _updateVoltageRails() {
        this._clearVoltageRails();
        let rails = this._getVoltageRails();
        if (!rails) {
            return;
        }

        let entries = Object.entries(rails)
            .map(([railName, value]) => [String(railName), value])
            .sort((a, b) => a[0].localeCompare(b[0]));

        if (entries.length === 0) {
            return;
        }

        this._railsHeader.visible = true;
        this._voltageRailsBox.visible = true;

        for (let [railName, value] of entries) {
            let key = `rail:${railName}`;
            let row = this._createStatRow({
                key,
                label: `${railName} Rail`,
            });
            this._voltageRailsBox.add_child(row);
            this._voltageRailRows.set(key, row);
            let voltageValue = this._formatVoltageValue(this._toNumber(value, NaN));
            this._setStatValue(key, voltageValue);
        }
    }

    _updateLabel(text) {
        this._label.text = text;
    }

    _setStatValue(key, value) {
        let label = this._statValueLabels.get(key);
        if (label) {
            label.text = value;
        }
    }

    _createSectionHeader(title) {
        return new St.Label({
            text: title,
            style_class: 'bitaxe-section-title',
            x_align: Clutter.ActorAlign.START,
        });
    }

    _addSection(column, title, entries) {
        let header = this._createSectionHeader(title);
        column.add_child(header);

        for (let entry of entries) {
            column.add_child(this._createStatRow(entry));
        }
    }

    _createStatRow(entry) {
        let row = new St.BoxLayout({
            style_class: 'bitaxe-stat-row',
            x_expand: true,
        });

        let label = new St.Label({
            text: entry.label,
            style_class: 'bitaxe-stat-label',
            x_align: Clutter.ActorAlign.START,
        });

        let value = new St.Label({
            text: '--',
            style_class: 'bitaxe-stat-value',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });

        row.add_child(label);
        row.add_child(value);

        this._statValueLabels.set(entry.key, value);

        return row;
    }

    _clearVoltageRails() {
        if (this._voltageRailRows) {
            for (let [key, row] of this._voltageRailRows.entries()) {
                row.destroy();
                this._statValueLabels.delete(key);
            }
            this._voltageRailRows.clear();
        }

        if (this._railsHeader) {
            this._railsHeader.visible = false;
        }
        if (this._voltageRailsBox) {
            this._voltageRailsBox.visible = false;
        }
    }

    _clearStatsUI(labelText) {
        this._stats = null;
        this._updateLabel(labelText);

        this._setStatValue('hashrate', '--');
        this._setStatValue('hashrate1m', '--');
        this._setStatValue('hashrate10m', '--');
        this._setStatValue('hashrate1h', '--');
        this._setStatValue('errorRate', '--');

        this._setStatValue('asicTemp', '--');
        this._setStatValue('vrmTemp', '--');
        this._setStatValue('tempTarget', '--');

        this._setStatValue('power', '--');
        this._setStatValue('voltage', '--');
        this._setStatValue('current', '--');
        this._setStatValue('coreVoltage', '--');

        this._setStatValue('fan', '--');
        this._setStatValue('frequency', '--');
        this._setStatValue('efficiency', '--');
        this._setStatValue('overclock', '--');

        this._setStatValue('pool', '--');
        this._setStatValue('poolDifficulty', '--');
        this._setStatValue('fallbackPool', '--');

        this._setStatValue('sharesAccepted', '--');
        this._setStatValue('sharesRejected', '--');
        this._setStatValue('bestDiff', '--');
        this._setStatValue('bestSessionDiff', '--');

        this._setStatValue('uptime', '--');
        this._setStatValue('model', '--');
        this._setStatValue('version', '--');
        this._setStatValue('boardVersion', '--');

        this._setStatValue('ipAddress', '--');
        this._setStatValue('ssid', '--');
        this._setStatValue('wifiRssi', '--');
        this._setStatValue('freeHeap', '--');

        this._clearVoltageRails();
    }

    destroy() {
        this._destroyed = true;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._ipDebounceId) {
            GLib.source_remove(this._ipDebounceId);
            this._ipDebounceId = null;
        }

        if (this._settingsChangedIds) {
            for (let id of this._settingsChangedIds) {
                this._settings.disconnect(id);
            }
            this._settingsChangedIds = null;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }

        super.destroy();
    }
});

export default class BitaxeMonitorExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new BitaxeIndicator(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
    }
}
