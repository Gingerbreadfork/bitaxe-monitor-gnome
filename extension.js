import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SPARKLINE_WIDTH = 88;
const SPARKLINE_HEIGHT = 22;
const SPARKLINE_PADDING = 2;
const SPARKLINE_WINDOW_DEFAULT_MINUTES = 5;
const SPARKLINE_MAX_POINTS_HARD_CAP = 720;
const STATUS_NO_IP = 'No IP set';
const STATUS_CONNECTING = 'Connecting...';
const STATUS_DISCONNECTED = 'Disconnected';

class Sparkline {
    constructor({styleClass, windowSeconds = SPARKLINE_WINDOW_DEFAULT_MINUTES * 60, maxPoints = SPARKLINE_MAX_POINTS_HARD_CAP}) {
        this._windowSeconds = Math.max(30, windowSeconds);
        this._maxPoints = Math.max(10, maxPoints);
        this._values = [];

        this.actor = new St.DrawingArea({
            style_class: styleClass,
            reactive: false,
        });
        this.actor.set_size(SPARKLINE_WIDTH, SPARKLINE_HEIGHT);
        this.actor.connect('repaint', this._onRepaint.bind(this));
        this.actor.connect('style-changed', () => this.actor.queue_repaint());
    }

    setWindowSeconds(windowSeconds) {
        this._windowSeconds = Math.max(30, windowSeconds);
        this._pruneOld(this._nowSeconds());
        this.actor.queue_repaint();
    }

    push(value) {
        const now = this._nowSeconds();
        this._values.push({
            timestamp: now,
            value: Number.isFinite(value) ? value : null,
        });
        this._pruneOld(now);
        if (this._values.length > this._maxPoints) {
            this._values.splice(0, this._values.length - this._maxPoints);
        }
        this.actor.queue_repaint();
    }

    clear() {
        this._values = [];
        this.actor.queue_repaint();
    }

    _nowSeconds() {
        return GLib.get_monotonic_time() / 1_000_000;
    }

    _pruneOld(nowSeconds) {
        const cutoff = nowSeconds - this._windowSeconds;
        while (this._values.length > 0 && this._values[0].timestamp < cutoff) {
            this._values.shift();
        }
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) {
            if (cr.$dispose) {
                cr.$dispose();
            }
            return;
        }

        const themeNode = this.actor.get_theme_node();
        const color = themeNode.get_foreground_color();
        const r = color.red / 255;
        const g = color.green / 255;
        const b = color.blue / 255;
        const a = color.alpha / 255;

        const padding = SPARKLINE_PADDING;
        const innerWidth = Math.max(0, width - padding * 2);
        const innerHeight = Math.max(0, height - padding * 2);
        if (innerWidth <= 0 || innerHeight <= 0) {
            if (cr.$dispose) {
                cr.$dispose();
            }
            return;
        }

        const midY = padding + innerHeight / 2;
        cr.setLineWidth(1);
        cr.setSourceRGBA(r, g, b, 0.12 * a);
        cr.moveTo(padding, midY);
        cr.lineTo(padding + innerWidth, midY);
        cr.stroke();

        if (this._values.length === 0) {
            if (cr.$dispose) {
                cr.$dispose();
            }
            return;
        }

        let min = Infinity;
        let max = -Infinity;
        for (const point of this._values) {
            const value = point.value;
            if (Number.isFinite(value)) {
                min = Math.min(min, value);
                max = Math.max(max, value);
            }
        }

        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            if (cr.$dispose) {
                cr.$dispose();
            }
            return;
        }

        let range = max - min;
        if (range < 1e-6) {
            min -= 1;
            max += 1;
            range = max - min;
        }

        const oldestTimestamp = this._values[0].timestamp;
        const latestTimestamp = this._values[this._values.length - 1].timestamp;
        const observedSpanSeconds = Math.max(0, latestTimestamp - oldestTimestamp);

        // Warm-up mode: until we have a full history window, spread points
        // over the observed range so the sparkline "fills in" naturally.
        const startTimestamp = observedSpanSeconds < this._windowSeconds
            ? oldestTimestamp
            : latestTimestamp - this._windowSeconds;
        const plotSpanSeconds = Math.max(1e-6, latestTimestamp - startTimestamp);
        const segments = [];
        let current = [];

        for (let i = 0; i < this._values.length; i++) {
            const point = this._values[i];
            const value = point.value;
            if (!Number.isFinite(value)) {
                if (current.length > 0) {
                    segments.push(current);
                    current = [];
                }
                continue;
            }

            const position = (point.timestamp - startTimestamp) / plotSpanSeconds;
            const x = padding + Math.min(1, Math.max(0, position)) * innerWidth;
            const y = padding + ((max - value) / range) * innerHeight;
            current.push([x, y]);
        }

        if (current.length > 0) {
            segments.push(current);
        }

        for (const segment of segments) {
            if (segment.length === 1) {
                const [x, y] = segment[0];
                cr.setSourceRGBA(r, g, b, 0.9 * a);
                cr.arc(x, y, 1.6, 0, Math.PI * 2);
                cr.fill();
                continue;
            }

            const last = segment[segment.length - 1];

            cr.newPath();
            cr.moveTo(segment[0][0], segment[0][1]);
            for (let i = 1; i < segment.length; i++) {
                cr.lineTo(segment[i][0], segment[i][1]);
            }
            cr.lineTo(last[0], padding + innerHeight);
            cr.lineTo(segment[0][0], padding + innerHeight);
            cr.closePath();
            cr.setSourceRGBA(r, g, b, 0.18 * a);
            cr.fill();

            cr.newPath();
            cr.moveTo(segment[0][0], segment[0][1]);
            for (let i = 1; i < segment.length; i++) {
                cr.lineTo(segment[i][0], segment[i][1]);
            }
            cr.setLineWidth(1.4);
            cr.setLineCap(1);
            cr.setLineJoin(1);
            cr.setSourceRGBA(r, g, b, 0.9 * a);
            cr.stroke();
        }

        for (let i = this._values.length - 1; i >= 0; i--) {
            const point = this._values[i];
            const value = point.value;
            if (!Number.isFinite(value)) {
                continue;
            }
            const position = (point.timestamp - startTimestamp) / plotSpanSeconds;
            const x = padding + Math.min(1, Math.max(0, position)) * innerWidth;
            const y = padding + ((max - value) / range) * innerHeight;
            cr.setSourceRGBA(r, g, b, 1.0 * a);
            cr.arc(x, y, 2.0, 0, Math.PI * 2);
            cr.fill();
            break;
        }

        if (cr.$dispose) {
            cr.$dispose();
        }
    }
}

const BitaxeIndicator = GObject.registerClass(
class BitaxeIndicator extends PanelMenu.Button {
    _init(settings, openPreferencesCallback = null) {
        super._init(0.0, 'Bitaxe Monitor', false);

        this._settings = settings;
        this._openPreferences = openPreferencesCallback;
        this._httpSession = new Soup.Session();
        this._cancellable = new Gio.Cancellable();
        this._timeoutId = null;
        this._ipDebounceId = null;
        this._inFlight = false;
        this._stats = null;
        this._hasFetchedStats = false;
        this._lastFailureLogKey = null;
        this._sparklineSeries = new Map();
        this._pendingPanelLabelText = null;
        this._sparklineWindowSeconds = this._getSparklineWindowSeconds();
        this._isPaused = false;

        this.add_style_class_name('bitaxe-indicator');

        this._label = new St.Label({
            text: 'Bitaxe: --',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.add_style_class_name('bitaxe-label');
        this.add_child(this._label);

        this._createMenuItems();
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen && this._pendingPanelLabelText !== null) {
                this._label.text = this._pendingPanelLabelText;
                this._pendingPanelLabelText = null;
            }
        });

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
            'show-sparklines',
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
            this._settings.connect('changed::show-sparklines', () => this._updateSparklineVisibility())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::show-network-info', () => this._updateNetworkVisibility())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::sparkline-window-minutes', () => this._updateSparklineWindow())
        );

        this._settingsChangedIds.push(
            this._settings.connect('changed::refresh-interval', () => this._refresh())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::bitaxe-ip', () => {
                this._updateWebUIButtonState();
                this._debounceRefresh();
            })
        );

        this._refresh();
    }

    _createMenuItems() {
        const headerItem = new PopupMenu.PopupMenuItem('Bitaxe Monitor', {
            reactive: false,
        });
        headerItem.label.add_style_class_name('bitaxe-popup-title');
        this.menu.addMenuItem(headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._statValueLabels = new Map();
        this._voltageRailRows = new Map();

        this._columnsBox = new St.BoxLayout({
            style_class: 'bitaxe-popup-columns',
            x_expand: true,
        });
        this._leftColumn = new St.BoxLayout({
            style_class: 'bitaxe-popup-column bitaxe-popup-column-left',
            vertical: true,
            x_expand: true,
            clip_to_allocation: true,
        });
        this._rightColumn = new St.BoxLayout({
            style_class: 'bitaxe-popup-column bitaxe-popup-column-right',
            vertical: true,
            x_expand: true,
            clip_to_allocation: true,
        });
        this._columnDivider = new St.Widget({
            style_class: 'bitaxe-popup-divider',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._columnsBox.add_child(this._leftColumn);
        this._columnsBox.add_child(this._columnDivider);
        this._columnsBox.add_child(this._rightColumn);

        const contentItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        contentItem.actor.add_style_class_name('bitaxe-popup-content');
        contentItem.actor.add_child(this._columnsBox);
        this.menu.addMenuItem(contentItem);

        this._addSection(this._leftColumn, 'Hashrate', [
            {key: 'hashrate', label: 'Hashrate', sparkline: 'hashrate'},
            {key: 'hashrate1m', label: 'Hashrate 1m'},
            {key: 'hashrate10m', label: 'Hashrate 10m'},
            {key: 'hashrate1h', label: 'Hashrate 1h'},
            {key: 'errorRate', label: 'Error Rate', sparkline: 'error-rate'},
        ]);

        this._addSection(this._leftColumn, 'Temperature', [
            {key: 'asicTemp', label: 'ASIC Temp', sparkline: 'temp'},
            {key: 'vrmTemp', label: 'VRM Temp', sparkline: 'vrm-temp'},
            {key: 'tempTarget', label: 'Temp Target'},
        ]);

        this._addSection(this._leftColumn, 'Power', [
            {key: 'power', label: 'Power', sparkline: 'power'},
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
            {key: 'fan', label: 'Fan', sparkline: 'fan'},
            {key: 'frequency', label: 'Frequency'},
            {key: 'efficiency', label: 'Efficiency', sparkline: 'efficiency'},
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
            {key: 'updatedLast', label: 'Last Refresh'},
        ]);

        this._networkSectionActors = this._addSection(this._rightColumn, 'Network', [
            {key: 'ipAddress', label: 'IP Address'},
            {key: 'ssid', label: 'SSID'},
            {key: 'wifiRssi', label: 'Wi-Fi RSSI'},
            {key: 'freeHeap', label: 'Free Heap'},
        ]);
        this._updateNetworkVisibility();

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const actionsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const actionsBox = new St.BoxLayout({
            style_class: 'bitaxe-popup-actions',
            x_expand: true,
        });

        const refreshButton = new St.Button({
            label: 'Refresh Now',
            style_class: 'button bitaxe-popup-action-button',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        refreshButton.connect('clicked', () => {
            this._fetchStats();
        });

        const settingsButton = new St.Button({
            label: 'Settings',
            style_class: 'button bitaxe-popup-action-button',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        settingsButton.connect('clicked', () => {
            this.menu.close();
            if (this._openPreferences) {
                this._openPreferences();
            }
        });

        const openWebUIButton = new St.Button({
            label: 'Open Web UI',
            style_class: 'button bitaxe-popup-action-button',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        openWebUIButton.connect('clicked', () => {
            const uri = this._getBitaxeWebUIUri();
            if (!uri) {
                return;
            }
            this.menu.close();
            try {
                Gio.AppInfo.launch_default_for_uri(uri, null);
            } catch (error) {
                logError(error, `[bitaxe-monitor] Failed to open Bitaxe Web UI: ${uri}`);
            }
        });

        const pauseButton = new St.Button({
            label: 'Pause',
            style_class: 'button bitaxe-popup-action-button',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        pauseButton.connect('clicked', () => {
            this._setPaused(!this._isPaused);
        });

        this._refreshButton = refreshButton;
        this._openWebUIButton = openWebUIButton;
        this._pauseButton = pauseButton;

        actionsBox.add_child(refreshButton);
        actionsBox.add_child(pauseButton);
        actionsBox.add_child(openWebUIButton);
        actionsBox.add_child(settingsButton);
        actionsItem.actor.add_style_class_name('bitaxe-popup-actions-row');
        actionsItem.actor.add_child(actionsBox);
        this.menu.addMenuItem(actionsItem);
        this._setRefreshButtonBusy(false);
        this._updatePauseButtonState();
        this._updateWebUIButtonState();
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
                if (!this._isPaused) {
                    this._fetchStats();
                }
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
        if (this._isPaused) {
            this._setRefreshButtonBusy(false);
            return;
        }

        let ip = this._settings.get_string('bitaxe-ip');

        if (!ip || ip === '') {
            this._hasFetchedStats = false;
            this._lastFailureLogKey = null;
            this._setRefreshButtonBusy(false);
            this._clearStatsUI(STATUS_NO_IP);
            return;
        }

        if (!this._hasFetchedStats) {
            this._updateLabel(STATUS_CONNECTING);
        }

        let url = `http://${ip}/api/system/info`;
        let message = Soup.Message.new('GET', url);

        if (this._inFlight) {
            return;
        }

        this._inFlight = true;
        this._setRefreshButtonBusy(true);
        this._httpSession.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            this._cancellable,
            (session, result) => {
                try {
                    let bytes = session.send_and_read_finish(result);
                    let status = message.get_status();
                    if (status !== Soup.Status.OK) {
                        throw new Error(`HTTP ${status}: ${message.get_reason_phrase()}`);
                    }

                    let decoder = new TextDecoder('utf-8');
                    let response = decoder.decode(bytes.get_data());

                    this._stats = JSON.parse(response);
                    this._hasFetchedStats = true;
                    this._lastFailureLogKey = null;
                    this._updateUI();
                } catch (e) {
                    if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        return;
                    }

                    this._handleFetchFailure(e, ip);
                } finally {
                    this._inFlight = false;
                    this._setRefreshButtonBusy(false);
                }
            }
        );
    }

    _handleFetchFailure(error, ip) {
        const expected = this._isExpectedConnectionIssue(error);
        this._logFetchFailure(error, ip, expected);

        if (this._hasFetchedStats) {
            this._clearStatsUI(STATUS_DISCONNECTED);
        } else {
            this._clearStatsUI(STATUS_CONNECTING);
        }
    }

    _isExpectedConnectionIssue(error) {
        if (!error) {
            return true;
        }

        if (error instanceof SyntaxError || error.name === 'SyntaxError') {
            return false;
        }

        let message = String(error.message || error).toLowerCase();
        if (message.includes('http ') || message.includes('json')) {
            return false;
        }

        return true;
    }

    _logFetchFailure(error, ip, expected) {
        let message = String((error && error.message) ? error.message : error);
        let key = `${expected ? 'expected' : 'unexpected'}:${message}`;
        if (key === this._lastFailureLogKey) {
            return;
        }

        this._lastFailureLogKey = key;
        if (expected) {
            log(`[bitaxe-monitor] Waiting for Bitaxe (${ip}): ${message}`);
        } else {
            logError(error, 'Bitaxe monitor fetch failed');
        }
    }

    _updateUI() {
        if (!this._stats) {
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
        this._pushSparkline('hashrate', this._toNumber(this._stats.hashRate, NaN));
        this._pushSparkline('error-rate', errorPercentage);
        this._pushSparkline('temp', this._toNumber(this._stats.temp, NaN));
        this._pushSparkline('vrm-temp', this._toNumber(this._stats.vrTemp, NaN));
        this._pushSparkline('power', this._toNumber(this._stats.power, NaN));
        this._pushSparkline('fan', fanRpm);
        this._pushSparkline('efficiency', efficiency);
        this._updateSparklineVisibility();
        this._setStatValue('updatedLast', this._formatTimeNow());
    }

    _formatTimeNow() {
        const now = GLib.DateTime.new_now_local();
        return now.format('%H:%M:%S') || '--:--:--';
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
        if (this.menu && this.menu.isOpen) {
            this._pendingPanelLabelText = text;
            return;
        }
        this._pendingPanelLabelText = null;
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
        let actors = [];
        let header = this._createSectionHeader(title);
        column.add_child(header);
        actors.push(header);
        const isLeftColumn = column === this._leftColumn;

        for (let entry of entries) {
            let row = this._createStatRow(entry, {isLeftColumn});
            column.add_child(row);
            actors.push(row);
        }

        return actors;
    }

    _createStatRow(entry, options = {}) {
        const isLeftColumn = Boolean(options.isLeftColumn);
        let row = new St.BoxLayout({
            style_class: 'bitaxe-stat-row',
            x_expand: true,
        });
        if (isLeftColumn) {
            row.add_style_class_name('bitaxe-stat-row-left');
        }
        if (entry.sparkline) {
            row.add_style_class_name('bitaxe-stat-row-sparkline');
        }

        let label = new St.Label({
            text: entry.label,
            style_class: 'bitaxe-stat-label',
            x_align: Clutter.ActorAlign.START,
        });

        let value = new St.Label({
            text: '--',
            style_class: 'bitaxe-stat-value',
            x_expand: !isLeftColumn,
            x_align: Clutter.ActorAlign.END,
        });
        if (!isLeftColumn) {
            value.add_style_class_name('bitaxe-stat-value-fluid');
        }
        if (value.clutter_text) {
            value.clutter_text.set_single_line_mode(true);
            value.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        }

        row.add_child(label);
        if (isLeftColumn) {
            const sparklineCell = new St.BoxLayout({
                style_class: 'bitaxe-sparkline-cell',
                x_align: Clutter.ActorAlign.CENTER,
            });
            if (entry.sparkline) {
                const sparkline = this._ensureSparkline(entry.sparkline);
                sparklineCell.add_child(sparkline.actor);
            } else {
                sparklineCell.add_style_class_name('bitaxe-sparkline-cell-empty');
            }
            row.add_child(sparklineCell);
        } else if (entry.sparkline) {
            const sparkline = this._ensureSparkline(entry.sparkline);
            row.add_child(sparkline.actor);
        }
        row.add_child(value);

        this._statValueLabels.set(entry.key, value);

        return row;
    }

    _ensureSparkline(key) {
        let sparkline = this._sparklineSeries.get(key);
        if (!sparkline) {
            sparkline = new Sparkline({
                styleClass: `bitaxe-sparkline bitaxe-sparkline-${key}`,
                windowSeconds: this._sparklineWindowSeconds,
                maxPoints: SPARKLINE_MAX_POINTS_HARD_CAP,
            });
            sparkline.actor.visible = this._settings.get_boolean('show-sparklines');
            this._sparklineSeries.set(key, sparkline);
        }
        return sparkline;
    }

    _pushSparkline(key, value) {
        const sparkline = this._sparklineSeries.get(key);
        if (!sparkline) {
            return;
        }
        sparkline.push(value);
    }

    _updateSparklineVisibility() {
        const visible = this._settings.get_boolean('show-sparklines');
        for (const sparkline of this._sparklineSeries.values()) {
            sparkline.actor.visible = visible;
        }
    }

    _updateNetworkVisibility() {
        const visible = this._settings.get_boolean('show-network-info');
        if (!this._networkSectionActors) {
            return;
        }

        for (const actor of this._networkSectionActors) {
            actor.visible = visible;
        }
    }

    _updateSparklineWindow() {
        this._sparklineWindowSeconds = this._getSparklineWindowSeconds();
        for (const sparkline of this._sparklineSeries.values()) {
            sparkline.setWindowSeconds(this._sparklineWindowSeconds);
        }
    }

    _getSparklineWindowSeconds() {
        const minutes = Math.max(1, this._settings.get_int('sparkline-window-minutes') || SPARKLINE_WINDOW_DEFAULT_MINUTES);
        return minutes * 60;
    }

    _setRefreshButtonBusy(isBusy) {
        if (!this._refreshButton) {
            return;
        }

        const canRefresh = !isBusy && !this._isPaused;
        this._refreshButton.reactive = canRefresh;
        this._refreshButton.can_focus = canRefresh;
    }

    _setPaused(paused) {
        const next = Boolean(paused);
        if (this._isPaused === next) {
            return;
        }

        this._isPaused = next;

        if (this._isPaused) {
            if (this._inFlight && this._cancellable) {
                this._cancellable.cancel();
                this._cancellable = new Gio.Cancellable();
            }
            this._setRefreshButtonBusy(false);
            this._setStatValue('updatedLast', 'Paused');
            this._updateLabel('Paused');
        } else {
            this._fetchStats();
        }

        this._updatePauseButtonState();
    }

    _updatePauseButtonState() {
        if (!this._pauseButton) {
            return;
        }
        this._pauseButton.label = this._isPaused ? 'Unpause' : 'Pause';
    }

    _getBitaxeWebUIUri() {
        const configured = this._settings.get_string('bitaxe-ip').trim();
        if (!configured) {
            return null;
        }
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(configured)) {
            return configured;
        }
        return `http://${configured}`;
    }

    _updateWebUIButtonState() {
        if (!this._openWebUIButton) {
            return;
        }
        const hasUri = Boolean(this._getBitaxeWebUIUri());
        this._openWebUIButton.reactive = hasUri;
        this._openWebUIButton.can_focus = hasUri;
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
        this._setStatValue('updatedLast', '--');

        this._setStatValue('ipAddress', '--');
        this._setStatValue('ssid', '--');
        this._setStatValue('wifiRssi', '--');
        this._setStatValue('freeHeap', '--');

        this._clearVoltageRails();
        this._clearSparklines();
    }

    _clearSparklines() {
        for (const sparkline of this._sparklineSeries.values()) {
            sparkline.clear();
        }
    }

    destroy() {
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

        if (this._sparklineSeries) {
            this._sparklineSeries.clear();
            this._sparklineSeries = null;
        }

        super.destroy();
    }
});

export default class BitaxeMonitorExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new BitaxeIndicator(this._settings, () => this.openPreferences());
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
