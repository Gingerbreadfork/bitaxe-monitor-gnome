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
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SPARKLINE_WIDTH = 88;
const SPARKLINE_HEIGHT = 22;
const SPARKLINE_PADDING = 2;
const SPARKLINE_WINDOW_DEFAULT_MINUTES = 5;
const SPARKLINE_MAX_POINTS_HARD_CAP = 720;
const STATUS_NO_DEVICES = 'No devices';
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

const DeviceSelectorDialog = GObject.registerClass(
class DeviceSelectorDialog extends ModalDialog.ModalDialog {
    _init(devices, currentView, onSelect) {
        super._init({styleClass: 'device-selector-dialog'});

        this._devices = devices;
        this._currentView = currentView;
        this._onSelect = onSelect;

        const title = new St.Label({
            text: 'Select View',
            style_class: 'device-selector-dialog-title',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.contentLayout.add_child(title);

        const scrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: 'device-selector-scroll',
        });

        const listBox = new St.BoxLayout({
            vertical: true,
            style_class: 'device-selector-list',
        });

        // Add Farm View option
        const farmButton = this._createDeviceButton('Farm View', 'farm', this._currentView === 'farm');
        listBox.add_child(farmButton);

        // Add separator
        const separator = new St.Widget({
            style_class: 'popup-separator-menu-item device-selector-separator',
        });
        listBox.add_child(separator);

        // Add individual devices
        for (const device of this._devices) {
            const deviceName = device.nickname || device.ip || 'Device';
            const isSelected = this._currentView === device.id;
            const button = this._createDeviceButton(deviceName, device.id, isSelected);
            listBox.add_child(button);
        }

        scrollView.add_child(listBox);
        this.contentLayout.add_child(scrollView);

        this.addButton({
            label: 'Cancel',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
    }

    _createDeviceButton(label, id, isSelected) {
        const button = new St.Button({
            style_class: 'device-selector-button',
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });

        const box = new St.BoxLayout({
            x_expand: true,
        });

        const labelWidget = new St.Label({
            text: label,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        box.add_child(labelWidget);

        if (isSelected) {
            const checkmark = new St.Label({
                text: '●',
                style_class: 'device-selector-checkmark',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(checkmark);
        }

        button.set_child(box);

        button.connect('clicked', () => {
            if (this._onSelect) {
                this._onSelect(id);
            }
            this.close();
        });

        return button;
    }
});

const BitaxeIndicator = GObject.registerClass(
class BitaxeIndicator extends PanelMenu.Button {
    _init(settings, openPreferencesCallback = null) {
        super._init(0.0, 'Bitaxe Monitor', false);

        this._settings = settings;
        this._openPreferences = openPreferencesCallback;
        this._httpSession = new Soup.Session();
        this._cancellable = new Gio.Cancellable();
        this._timeoutId = null;
        this._devicesChangedDebounceId = null;
        this._inFlight = false;
        this._devices = [];
        this._deviceStats = new Map();
        this._deviceSparklines = new Map();
        this._hasFetchedStats = false;
        this._pendingPanelLabelText = null;
        this._sparklineWindowSeconds = this._getSparklineWindowSeconds();
        this._isPaused = false;
        this._currentView = 'auto'; // 'auto', 'farm', or deviceId
        this._selectedDeviceId = null;

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
            'panel-display-mode',
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
            this._settings.connect('changed::sparkline-theme', () => this._updateSparklineTheme())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::refresh-interval', () => this._refresh())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::devices-json', () => this._debounceDevicesChanged())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::selected-device-id', () => this._onSelectedDeviceChanged())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::default-view', () => this._updateViewMode())
        );
        this._settingsChangedIds.push(
            this._settings.connect('changed::farm-view-columns', () => this._updateFarmView())
        );

        // Listen for farm view stats settings changes
        const farmStatsKeys = [
            'farm-show-hashrate',
            'farm-show-asic-temp',
            'farm-show-vrm-temp',
            'farm-show-power',
            'farm-show-voltage',
            'farm-show-efficiency',
            'farm-show-shares',
            'farm-show-error-rate',
            'farm-show-best-diff',
            'farm-show-fan',
            'farm-show-frequency',
            'farm-show-pool',
            'farm-show-uptime',
            'farm-show-model',
        ];
        for (const key of farmStatsKeys) {
            this._settingsChangedIds.push(
                this._settings.connect(`changed::${key}`, () => this._updateFarmView())
            );
        }

        this._loadDevices();
        this._refresh();
    }

    _createMenuItems() {
        // Header with title and view indicator
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const headerBox = new St.BoxLayout({
            x_expand: true,
        });

        const titleLabel = new St.Label({
            text: 'Bitaxe Monitor',
            style_class: 'bitaxe-popup-title',
            x_expand: true,
        });

        this._viewLabel = new St.Label({
            text: '',
            style_class: 'bitaxe-view-label',
            x_align: Clutter.ActorAlign.END,
        });

        headerBox.add_child(titleLabel);
        headerBox.add_child(this._viewLabel);
        headerItem.actor.add_child(headerBox);
        this.menu.addMenuItem(headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Farm view container
        this._farmViewContainer = new St.ScrollView({
            style_class: 'bitaxe-farm-view',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        this._farmViewBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        this._farmViewContainer.add_child(this._farmViewBox);

        const farmViewItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        farmViewItem.actor.add_child(this._farmViewContainer);
        this.menu.addMenuItem(farmViewItem);
        this._farmViewItem = farmViewItem;
        this._farmViewItem.actor.visible = false;

        // Single device view (original detailed view)
        this._singleDeviceScrollView = new St.ScrollView({
            style_class: 'bitaxe-single-device-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });

        this._singleDeviceContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });

        this._statValueLabels = new Map();
        this._voltageRailRows = new Map();
        this._sparklineCells = new Map(); // Maps entry.sparkline -> St.BoxLayout cell
        this._currentSparklineDeviceId = null; // Track which device's sparklines are currently displayed

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
        this._singleDeviceContainer.add_child(this._columnsBox);
        this._singleDeviceScrollView.add_child(this._singleDeviceContainer);

        const singleDeviceItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        singleDeviceItem.actor.add_style_class_name('bitaxe-popup-content');
        singleDeviceItem.actor.add_child(this._singleDeviceScrollView);
        this.menu.addMenuItem(singleDeviceItem);
        this._singleDeviceItem = singleDeviceItem;

        // Apply initial sparkline theme
        this._updateSparklineTheme();

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

        // Action buttons
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
            this._fetchAllDevices();
        });

        const copyStatsButton = new St.Button({
            label: 'Copy Stats',
            style_class: 'button bitaxe-popup-action-button',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        copyStatsButton.connect('clicked', () => {
            this._copyStatsToClipboard();
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
                console.error(`[bitaxe-monitor] Failed to open Bitaxe Web UI: ${uri}`, error);
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

        const selectViewButton = new St.Button({
            label: 'Select View',
            style_class: 'button bitaxe-popup-action-button',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        selectViewButton.connect('clicked', () => {
            this._openDeviceSelectorDialog();
        });

        this._refreshButton = refreshButton;
        this._copyStatsButton = copyStatsButton;
        this._openWebUIButton = openWebUIButton;
        this._pauseButton = pauseButton;
        this._selectViewButton = selectViewButton;

        actionsBox.add_child(refreshButton);
        actionsBox.add_child(copyStatsButton);
        actionsBox.add_child(pauseButton);
        actionsBox.add_child(selectViewButton);
        actionsBox.add_child(openWebUIButton);
        actionsBox.add_child(settingsButton);
        actionsItem.actor.add_style_class_name('bitaxe-popup-actions-row');
        actionsItem.actor.add_child(actionsBox);
        this.menu.addMenuItem(actionsItem);
        this._setRefreshButtonBusy(false);
        this._updatePauseButtonState();
        this._updateWebUIButtonState();
    }

    _loadDevices() {
        const devicesJson = this._settings.get_string('devices-json');
        try {
            this._devices = JSON.parse(devicesJson);
        } catch (e) {
            this._devices = [];
        }

        // Migrate old single IP if devices list is empty
        if (this._devices.length === 0) {
            const oldIp = this._settings.get_string('bitaxe-ip');
            if (oldIp && oldIp !== '') {
                this._devices = [{
                    id: `device-${Date.now()}`,
                    nickname: 'My Bitaxe',
                    ip: oldIp,
                }];
                this._settings.set_string('devices-json', JSON.stringify(this._devices));
            }
        }

        this._selectedDeviceId = this._settings.get_string('selected-device-id');
        if (!this._selectedDeviceId && this._devices.length > 0) {
            this._selectedDeviceId = this._devices[0].id;
            this._settings.set_string('selected-device-id', this._selectedDeviceId);
        }

        this._updateViewMode();
        this._buildDeviceSelector();
    }

    _buildDeviceSelector() {
        if (!this._selectViewButton) {
            return;
        }

        // Show button only when there are multiple devices
        if (this._devices.length <= 1) {
            this._selectViewButton.visible = false;
        } else {
            this._selectViewButton.visible = true;
            this._selectViewButton.label = 'View';
        }

        // Update header label to show current view
        if (this._viewLabel) {
            let currentViewLabel = '';
            if (this._currentView === 'farm') {
                currentViewLabel = 'Farm View';
            } else {
                const currentDevice = this._devices.find(d => d.id === this._currentView);
                if (currentDevice) {
                    currentViewLabel = currentDevice.nickname || currentDevice.ip || 'Device';
                }
            }
            this._viewLabel.text = currentViewLabel;
        }
    }

    _openDeviceSelectorDialog() {
        const dialog = new DeviceSelectorDialog(
            this._devices,
            this._currentView,
            (viewId) => {
                this._switchToView(viewId);
            }
        );
        dialog.open();
    }

    _switchToView(view) {
        this._currentView = view;
        if (view !== 'farm' && view !== 'auto') {
            this._selectedDeviceId = view;
            this._settings.set_string('selected-device-id', view);
        }
        this._buildDeviceSelector();
        this._updateViewDisplay();
    }

    _updateViewMode() {
        const defaultView = this._settings.get_string('default-view');

        if (this._devices.length === 0) {
            this._currentView = 'auto';
        } else if (this._devices.length === 1) {
            this._currentView = this._devices[0].id;
        } else if (defaultView === 'farm') {
            this._currentView = 'farm';
        } else if (defaultView === 'single') {
            this._currentView = this._selectedDeviceId || this._devices[0].id;
        } else { // 'auto'
            this._currentView = this._devices.length >= 2 ? 'farm' : this._devices[0].id;
        }

        this._updateViewDisplay();
    }

    _updateViewDisplay() {
        const isFarmView = this._currentView === 'farm';

        this._farmViewItem.actor.visible = isFarmView;
        this._singleDeviceItem.actor.visible = !isFarmView;

        if (isFarmView) {
            this._updateFarmView();
        } else {
            this._updateSingleDeviceView();
        }
    }

    _updateFarmView() {
        this._farmViewBox.destroy_all_children();

        if (this._devices.length === 0) {
            const placeholder = new St.Label({
                text: 'No devices configured.\nOpen Settings to add your Bitaxe devices.',
                style_class: 'bitaxe-farm-placeholder',
            });
            this._farmViewBox.add_child(placeholder);
            return;
        }

        const columns = Math.max(1, Math.min(4, this._settings.get_int('farm-view-columns')));

        // Calculate fixed card width based on column count
        // 900px max-width - 24px padding = 876px available
        // Account for 8px margin per card (4px each side) and 8px spacing between cards
        const containerWidth = 876;
        const totalMargin = columns * 8; // 4px margin on each side per card
        const totalSpacing = (columns - 1) * 8; // spacing between cards
        const availableWidth = containerWidth - totalMargin - totalSpacing;
        const cardWidth = Math.floor(availableWidth / columns);

        if (columns === 1) {
            // Single column - simple vertical layout
            for (const device of this._devices) {
                const deviceCard = this._createFarmDeviceCard(device);
                this._farmViewBox.add_child(deviceCard);
            }
        } else {
            // Multi-column layout
            let currentRow = null;
            let deviceCount = 0;

            for (const device of this._devices) {
                if (deviceCount % columns === 0) {
                    currentRow = new St.BoxLayout({
                        style_class: 'bitaxe-farm-row',
                        x_expand: false,
                    });
                    this._farmViewBox.add_child(currentRow);
                }

                const deviceCard = this._createFarmDeviceCard(device);
                deviceCard.set_width(cardWidth);
                currentRow.add_child(deviceCard);
                deviceCount++;
            }
        }
    }

    _createFarmDeviceCard(device) {
        const card = new St.BoxLayout({
            style_class: 'bitaxe-farm-card',
            vertical: true,
            x_expand: false,
        });

        const stats = this._deviceStats.get(device.id);

        // Header with nickname
        const header = new St.BoxLayout({
            style_class: 'bitaxe-farm-card-header',
            x_expand: true,
        });
        const nicknameLabel = new St.Label({
            text: device.nickname || device.ip || 'Device',
            style_class: 'bitaxe-farm-card-title',
            x_expand: true,
        });
        header.add_child(nicknameLabel);

        // Status indicator
        const statusLabel = new St.Label({
            text: stats ? '●' : '○',
            style_class: stats ? 'bitaxe-farm-status-online' : 'bitaxe-farm-status-offline',
        });
        header.add_child(statusLabel);
        card.add_child(header);

        if (!stats) {
            const offlineLabel = new St.Label({
                text: 'Offline or connecting...',
                style_class: 'bitaxe-farm-offline',
            });
            card.add_child(offlineLabel);
            return card;
        }

        // Stats grid
        const grid = new St.BoxLayout({
            style_class: 'bitaxe-farm-stats-grid',
            vertical: true,
        });

        const addRow = (label, value) => {
            const row = new St.BoxLayout({
                style_class: 'bitaxe-farm-stat-row',
                x_expand: true,
            });
            const labelWidget = new St.Label({
                text: label,
                style_class: 'bitaxe-farm-stat-label',
            });
            const valueWidget = new St.Label({
                text: value,
                style_class: 'bitaxe-farm-stat-value',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
            });
            row.add_child(labelWidget);
            row.add_child(valueWidget);
            grid.add_child(row);
        };

        if (this._settings.get_boolean('farm-show-hashrate')) {
            addRow('Hashrate', this._formatHashrate(this._toNumber(stats.hashRate, 0)));
        }

        if (this._settings.get_boolean('farm-show-asic-temp')) {
            addRow('ASIC Temp', `${Math.round(this._toNumber(stats.temp, 0))}°C`);
        }

        if (this._settings.get_boolean('farm-show-vrm-temp')) {
            addRow('VRM Temp', `${Math.round(this._toNumber(stats.vrTemp, 0))}°C`);
        }

        if (this._settings.get_boolean('farm-show-power')) {
            addRow('Power', `${this._toNumber(stats.power, 0).toFixed(2)}W`);
        }

        if (this._settings.get_boolean('farm-show-voltage')) {
            const voltage = this._toNumber(stats.voltage, 0);
            addRow('Voltage', voltage > 0 ? `${voltage.toFixed(0)}mV` : '--');
        }

        if (this._settings.get_boolean('farm-show-efficiency')) {
            const hr = this._toNumber(stats.hashRate, 0);
            const pwr = this._toNumber(stats.power, 0);
            let efficiency = NaN;
            if (pwr > 0 && hr > 0) {
                efficiency = hr / pwr;
            }
            addRow('Efficiency', Number.isFinite(efficiency) ? `${efficiency.toFixed(2)} GH/W` : '--');
        }

        if (this._settings.get_boolean('farm-show-shares')) {
            addRow('Shares', `${this._toNumber(stats.sharesAccepted, 0)}`);
        }

        if (this._settings.get_boolean('farm-show-error-rate')) {
            const errorPercentage = this._toNumber(stats.errorPercentage, 0);
            addRow('Error Rate', `${errorPercentage.toFixed(2)}%`);
        }

        if (this._settings.get_boolean('farm-show-best-diff')) {
            const bestDiff = this._toNumber(stats.bestDiff, 0);
            addRow('Best Diff', this._formatDifficulty(bestDiff));
        }

        if (this._settings.get_boolean('farm-show-fan')) {
            const fanRpm = this._toNumber(stats.fanrpm, 0);
            addRow('Fan', fanRpm > 0 ? `${fanRpm} RPM` : '--');
        }

        if (this._settings.get_boolean('farm-show-frequency')) {
            const frequency = this._toNumber(stats.frequency, 0);
            addRow('Frequency', frequency > 0 ? `${frequency} MHz` : '--');
        }

        if (this._settings.get_boolean('farm-show-pool')) {
            const pool = stats.stratumURL || '--';
            // Shorten pool URL for compact display
            const poolDisplay = pool.length > 30 ? pool.substring(0, 27) + '...' : pool;
            addRow('Pool', poolDisplay);
        }

        if (this._settings.get_boolean('farm-show-uptime')) {
            addRow('Uptime', this._formatUptime(stats.uptimeSeconds));
        }

        if (this._settings.get_boolean('farm-show-model')) {
            const model = stats.ASICModel || '--';
            addRow('Model', model);
        }

        card.add_child(grid);
        return card;
    }

    _updateSingleDeviceView() {
        const device = this._devices.find(d => d.id === this._currentView);
        if (!device) {
            this._clearStatsUI('No device selected');
            return;
        }

        // Ensure sparklines are populated for this device
        this._populateSparklineCells(device.id);

        const stats = this._deviceStats.get(device.id);
        if (!stats) {
            this._clearStatsUI(STATUS_CONNECTING);
            return;
        }

        this._updateSingleDeviceStats(device, stats);
    }

    _updateSingleDeviceStats(device, stats) {
        this._setStatValue('hashrate', this._formatHashrate(this._toNumber(stats.hashRate, 0)));
        this._setStatValue('hashrate1m', this._formatHashrate(this._toNumber(stats.hashRate_1m, 0)));
        this._setStatValue('hashrate10m', this._formatHashrate(this._toNumber(stats.hashRate_10m, 0)));
        this._setStatValue('hashrate1h', this._formatHashrate(this._toNumber(stats.hashRate_1h, 0)));

        const errorPercentage = this._toNumber(stats.errorPercentage, 0);
        this._setStatValue('errorRate', `${errorPercentage.toFixed(2)}%`);

        const asicTemp = Math.round(this._toNumber(stats.temp, 0));
        this._setStatValue('asicTemp', `${asicTemp}°C`);

        const vrmTemp = Math.round(this._toNumber(stats.vrTemp, 0));
        this._setStatValue('vrmTemp', `${vrmTemp}°C`);

        const tempTarget = Math.round(this._toNumber(stats.temptarget, 0));
        this._setStatValue('tempTarget', tempTarget > 0 ? `${tempTarget}°C` : '--');

        const power = this._toNumber(stats.power, 0).toFixed(2);
        this._setStatValue('power', `${power}W`);

        const voltage = this._toNumber(stats.voltage, 0).toFixed(0);
        this._setStatValue('voltage', `${voltage}mV`);

        const current = this._toNumber(stats.current, 0).toFixed(0);
        this._setStatValue('current', `${current}mA`);

        const coreVoltage = this._toNumber(stats.coreVoltageActual, 0);
        this._setStatValue('coreVoltage', coreVoltage > 0 ? `${coreVoltage}mV` : '--');

        const fanRpm = this._toNumber(stats.fanrpm, NaN);
        this._setStatValue('fan', this._formatFanRpm(fanRpm));

        const frequency = this._toNumber(stats.frequency, 0);
        this._setStatValue('frequency', this._formatFrequency(frequency));

        let efficiency = this._toNumber(stats.efficiency, NaN);
        if (!Number.isFinite(efficiency)) {
            const hr = this._toNumber(stats.hashRate, 0);
            const pwr = this._toNumber(stats.power, 0);
            if (pwr > 0 && hr > 0) {
                efficiency = hr / pwr;
            }
        }
        this._setStatValue('efficiency', this._formatEfficiency(efficiency));

        const overclockEnabled = this._toNumber(stats.overclockEnabled, 0);
        this._setStatValue('overclock', overclockEnabled === 1 ? 'Enabled' : 'Disabled');

        this._setStatValue('pool', stats.stratumURL || 'Not connected');

        const poolDiff = this._toNumber(stats.poolDifficulty, 0);
        this._setStatValue('poolDifficulty', this._formatDifficulty(poolDiff));

        const fallbackPool = stats.fallbackStratumURL || '--';
        this._setStatValue('fallbackPool', fallbackPool);

        const sharesAccepted = this._toNumber(stats.sharesAccepted, 0);
        const sharesRejected = this._toNumber(stats.sharesRejected, 0);
        this._setStatValue('sharesAccepted', this._formatCount(sharesAccepted));
        this._setStatValue('sharesRejected', this._formatCount(sharesRejected));

        const bestDiff = this._toNumber(stats.bestDiff, 0);
        this._setStatValue('bestDiff', this._formatDifficulty(bestDiff));

        const bestSessionDiff = this._toNumber(stats.bestSessionDiff, 0);
        this._setStatValue('bestSessionDiff', this._formatDifficulty(bestSessionDiff));

        this._setStatValue('uptime', this._formatUptime(stats.uptimeSeconds));
        this._setStatValue('model', stats.ASICModel || 'Unknown');
        this._setStatValue('version', stats.version || 'Unknown');

        const boardVersion = stats.boardVersion || '--';
        this._setStatValue('boardVersion', boardVersion);

        const ipAddress = stats.ipv4 || stats.ipAddress || '--';
        this._setStatValue('ipAddress', ipAddress);

        const ssid = stats.ssid || '--';
        this._setStatValue('ssid', ssid);

        const rssi = this._toNumber(stats.wifiRSSI, NaN);
        this._setStatValue('wifiRssi', this._formatRssi(rssi));

        const freeHeap = this._toNumber(stats.freeHeap, 0);
        this._setStatValue('freeHeap', this._formatBytes(freeHeap));

        this._updateVoltageRails(stats);
        this._pushDeviceSparkline(device.id, 'hashrate', this._toNumber(stats.hashRate, NaN));
        this._pushDeviceSparkline(device.id, 'error-rate', errorPercentage);
        this._pushDeviceSparkline(device.id, 'temp', this._toNumber(stats.temp, NaN));
        this._pushDeviceSparkline(device.id, 'vrm-temp', this._toNumber(stats.vrTemp, NaN));
        this._pushDeviceSparkline(device.id, 'power', this._toNumber(stats.power, NaN));
        this._pushDeviceSparkline(device.id, 'fan', fanRpm);
        this._pushDeviceSparkline(device.id, 'efficiency', efficiency);
        this._updateSparklineVisibility();
        this._setStatValue('updatedLast', this._formatTimeNow());
    }

    _refresh() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        this._fetchAllDevices();

        const interval = this._settings.get_int('refresh-interval');
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                if (!this._isPaused) {
                    this._fetchAllDevices();
                }
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _debounceDevicesChanged() {
        if (this._devicesChangedDebounceId) {
            GLib.source_remove(this._devicesChangedDebounceId);
            this._devicesChangedDebounceId = null;
        }

        this._devicesChangedDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            500,
            () => {
                this._devicesChangedDebounceId = null;
                this._loadDevices();
                this._refresh();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _onSelectedDeviceChanged() {
        this._selectedDeviceId = this._settings.get_string('selected-device-id');
        if (this._currentView !== 'farm' && this._currentView !== 'auto') {
            this._currentView = this._selectedDeviceId;
            this._updateViewDisplay();
            this._buildDeviceSelector();
        }
    }

    _fetchAllDevices() {
        if (this._isPaused) {
            this._setRefreshButtonBusy(false);
            return;
        }

        if (this._devices.length === 0) {
            this._hasFetchedStats = false;
            this._setRefreshButtonBusy(false);
            this._updateLabel(STATUS_NO_DEVICES);
            this._updateViewDisplay();
            return;
        }

        if (!this._hasFetchedStats) {
            this._updateLabel(STATUS_CONNECTING);
        }

        if (this._inFlight) {
            return;
        }

        this._inFlight = true;
        this._setRefreshButtonBusy(true);

        const fetchPromises = this._devices.map(device => this._fetchDeviceStats(device));

        Promise.all(fetchPromises).finally(() => {
            this._inFlight = false;
            this._setRefreshButtonBusy(false);
            this._hasFetchedStats = true;
            this._updateUI();
        });
    }

    _fetchDeviceStats(device) {
        return new Promise((resolve) => {
            if (!device.ip || device.ip === '') {
                resolve(null);
                return;
            }

            const url = `http://${device.ip}/api/system/info`;
            const message = Soup.Message.new('GET', url);

            this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const status = message.get_status();
                        if (status !== Soup.Status.OK) {
                            throw new Error(`HTTP ${status}: ${message.get_reason_phrase()}`);
                        }

                        const decoder = new TextDecoder('utf-8');
                        const response = decoder.decode(bytes.get_data());
                        const stats = JSON.parse(response);
                        this._deviceStats.set(device.id, stats);
                        resolve(stats);
                    } catch (e) {
                        if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            resolve(null);
                            return;
                        }
                        this._deviceStats.delete(device.id);
                        resolve(null);
                    }
                }
            );
        });
    }

    _updateUI() {
        this._updatePanelDisplay();
        this._updateViewDisplay();
        this._updateWebUIButtonState();
    }

    _updatePanelDisplay() {
        const panelMode = this._settings.get_string('panel-display-mode');

        if (this._devices.length === 0) {
            this._updateLabel(STATUS_NO_DEVICES);
            return;
        }

        if (this._devices.length === 1 || panelMode === 'selected') {
            this._updatePanelForDevice(this._selectedDeviceId || this._devices[0].id);
        } else if (panelMode === 'aggregate') {
            this._updatePanelAggregate();
        } else { // 'auto'
            if (this._devices.length === 1) {
                this._updatePanelForDevice(this._devices[0].id);
            } else {
                this._updatePanelAggregate();
            }
        }
    }

    _updatePanelForDevice(deviceId) {
        const device = this._devices.find(d => d.id === deviceId);
        if (!device) {
            this._updateLabel(STATUS_NO_DEVICES);
            return;
        }

        const stats = this._deviceStats.get(deviceId);
        if (!stats) {
            const label = this._devices.length > 1
                ? `${device.nickname || device.ip || 'Device'}: ${STATUS_CONNECTING}`
                : STATUS_CONNECTING;
            this._updateLabel(label);
            return;
        }

        const labelParts = [];
        const prefix = this._devices.length > 1 ? `${device.nickname || device.ip}: ` : '';

        if (this._settings.get_boolean('show-hashrate')) {
            const hashrate = this._formatHashrate(this._toNumber(stats.hashRate, 0));
            labelParts.push(hashrate);
        }

        if (this._settings.get_boolean('show-temperature')) {
            const asicTemp = Math.round(this._toNumber(stats.temp, 0));
            labelParts.push(`${asicTemp}°C`);
        }

        if (this._settings.get_boolean('show-vrm-temp')) {
            const vrmTemp = Math.round(this._toNumber(stats.vrTemp, 0));
            labelParts.push(`VRM:${vrmTemp}°C`);
        }

        if (this._settings.get_boolean('show-power')) {
            const power = this._toNumber(stats.power, 0).toFixed(1);
            labelParts.push(`${power}W`);
        }

        if (this._settings.get_boolean('show-efficiency')) {
            let efficiency = this._toNumber(stats.efficiency, NaN);
            if (!Number.isFinite(efficiency)) {
                const hr = this._toNumber(stats.hashRate, 0);
                const pwr = this._toNumber(stats.power, 0);
                if (pwr > 0 && hr > 0) {
                    efficiency = hr / pwr;
                }
            }
            if (Number.isFinite(efficiency)) {
                labelParts.push(`${efficiency.toFixed(1)}GH/W`);
            }
        }

        if (this._settings.get_boolean('show-fan-rpm')) {
            const fanRpm = this._toNumber(stats.fanrpm, 0);
            if (fanRpm > 0) {
                labelParts.push(`${fanRpm}RPM`);
            }
        }

        if (this._settings.get_boolean('show-frequency')) {
            const frequency = this._toNumber(stats.frequency, 0);
            if (frequency > 0) {
                labelParts.push(`${frequency}MHz`);
            }
        }

        if (this._settings.get_boolean('show-shares')) {
            const shares = this._toNumber(stats.sharesAccepted, 0);
            labelParts.push(`${shares}sh`);
        }

        if (this._settings.get_boolean('show-uptime')) {
            const uptimeSeconds = this._toNumber(stats.uptimeSeconds, 0);
            if (uptimeSeconds > 0) {
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
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

        const labelText = labelParts.length > 0
            ? prefix + labelParts.join(separator)
            : prefix + 'Bitaxe';

        this._updateLabel(labelText);
    }

    _updatePanelAggregate() {
        const labelParts = [];
        let totalHashrate = 0;
        let totalPower = 0;
        let avgTemp = 0;
        let tempCount = 0;
        let onlineCount = 0;

        for (const device of this._devices) {
            const stats = this._deviceStats.get(device.id);
            if (stats) {
                totalHashrate += this._toNumber(stats.hashRate, 0);
                totalPower += this._toNumber(stats.power, 0);
                const temp = this._toNumber(stats.temp, 0);
                if (temp > 0) {
                    avgTemp += temp;
                    tempCount++;
                }
                onlineCount++;
            }
        }

        const prefix = `[${onlineCount}/${this._devices.length}] `;

        if (this._settings.get_boolean('show-hashrate')) {
            labelParts.push(this._formatHashrate(totalHashrate));
        }

        if (this._settings.get_boolean('show-temperature') && tempCount > 0) {
            const temp = Math.round(avgTemp / tempCount);
            labelParts.push(`${temp}°C`);
        }

        if (this._settings.get_boolean('show-power')) {
            labelParts.push(`${totalPower.toFixed(1)}W`);
        }

        if (this._settings.get_boolean('show-efficiency')) {
            if (totalPower > 0 && totalHashrate > 0) {
                const efficiency = totalHashrate / totalPower;
                labelParts.push(`${efficiency.toFixed(1)}GH/W`);
            }
        }

        let separator = this._settings.get_string('custom-separator');
        if (!separator || separator === '') {
            separator = this._settings.get_string('panel-separator');
        }
        separator = ` ${separator} `;

        const labelText = labelParts.length > 0
            ? prefix + labelParts.join(separator)
            : prefix + 'Bitaxe Farm';

        this._updateLabel(labelText);
    }

    _formatTimeNow() {
        const now = GLib.DateTime.new_now_local();
        return now.format('%H:%M:%S') || '--:--:--';
    }

    _formatHashrate(hashrate) {
        if (!Number.isFinite(hashrate) || hashrate === 0) {
            return '0 GH/s';
        }

        const unit = this._settings.get_string('hashrate-unit');

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
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

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

        if (value >= 1024 * 1024) {
            return `${(value / (1024 * 1024)).toFixed(2)} MB`;
        } else if (value >= 1024) {
            return `${(value / 1024).toFixed(2)} KB`;
        }
        return `${Math.round(value)} B`;
    }

    _toNumber(value, fallback) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
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

    _updateVoltageRails(stats) {
        this._clearVoltageRails();

        if (!stats) {
            return;
        }

        let rails = null;
        for (const key of ['voltageRails', 'voltage_rails', 'voltages', 'voltageMap']) {
            if (typeof stats[key] === 'object' && stats[key] !== null) {
                rails = stats[key];
                break;
            }
        }

        if (!rails) {
            return;
        }

        const entries = Object.entries(rails)
            .map(([railName, value]) => [String(railName), value])
            .sort((a, b) => a[0].localeCompare(b[0]));

        if (entries.length === 0) {
            return;
        }

        this._railsHeader.visible = true;
        this._voltageRailsBox.visible = true;

        for (const [railName, value] of entries) {
            const key = `rail:${railName}`;
            const row = this._createStatRow({
                key,
                label: `${railName} Rail`,
            });
            this._voltageRailsBox.add_child(row);
            this._voltageRailRows.set(key, row);
            const voltageValue = this._formatVoltageValue(this._toNumber(value, NaN));
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
        const label = this._statValueLabels.get(key);
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
        const actors = [];
        const header = this._createSectionHeader(title);
        column.add_child(header);
        actors.push(header);
        const isLeftColumn = column === this._leftColumn;

        for (const entry of entries) {
            const row = this._createStatRow(entry, {isLeftColumn});
            column.add_child(row);
            actors.push(row);
        }

        return actors;
    }

    _createStatRow(entry, options = {}) {
        const isLeftColumn = Boolean(options.isLeftColumn);
        const row = new St.BoxLayout({
            style_class: 'bitaxe-stat-row',
            x_expand: true,
        });
        if (isLeftColumn) {
            row.add_style_class_name('bitaxe-stat-row-left');
        }
        if (entry.sparkline) {
            row.add_style_class_name('bitaxe-stat-row-sparkline');
        }

        const label = new St.Label({
            text: entry.label,
            style_class: 'bitaxe-stat-label',
            x_align: Clutter.ActorAlign.START,
        });

        const value = new St.Label({
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
                // Store the cell for later population
                this._sparklineCells.set(entry.sparkline, sparklineCell);
            } else {
                sparklineCell.add_style_class_name('bitaxe-sparkline-cell-empty');
            }
            row.add_child(sparklineCell);
        } else if (entry.sparkline) {
            const sparklineCell = new St.BoxLayout({
                style_class: 'bitaxe-sparkline-cell',
                x_align: Clutter.ActorAlign.CENTER,
            });
            // Store the cell for later population
            this._sparklineCells.set(entry.sparkline, sparklineCell);
            row.add_child(sparklineCell);
        }
        row.add_child(value);

        this._statValueLabels.set(entry.key, value);

        return row;
    }

    _ensureDeviceSparkline(deviceId, key) {
        if (!deviceId || deviceId === 'farm' || deviceId === 'auto') {
            return null;
        }

        let deviceSparklines = this._deviceSparklines.get(deviceId);
        if (!deviceSparklines) {
            deviceSparklines = new Map();
            this._deviceSparklines.set(deviceId, deviceSparklines);
        }

        let sparkline = deviceSparklines.get(key);
        if (!sparkline) {
            sparkline = new Sparkline({
                styleClass: `bitaxe-sparkline bitaxe-sparkline-${key}`,
                windowSeconds: this._sparklineWindowSeconds,
                maxPoints: SPARKLINE_MAX_POINTS_HARD_CAP,
            });
            sparkline.actor.visible = this._settings.get_boolean('show-sparklines');
            deviceSparklines.set(key, sparkline);
        }
        return sparkline;
    }

    _populateSparklineCells(deviceId) {
        if (!deviceId || deviceId === 'farm' || deviceId === 'auto') {
            return;
        }

        // If sparklines for this device are already displayed, nothing to do
        if (this._currentSparklineDeviceId === deviceId) {
            return;
        }

        // Remove previous sparklines from cells (without destroying them)
        for (const [sparklineKey, cell] of this._sparklineCells.entries()) {
            // Remove all children but don't destroy them
            while (cell.get_n_children() > 0) {
                const child = cell.get_first_child();
                cell.remove_child(child);
            }

            // Create/get sparkline for this device
            const sparkline = this._ensureDeviceSparkline(deviceId, sparklineKey);
            if (sparkline) {
                cell.add_child(sparkline.actor);
            }
        }

        this._currentSparklineDeviceId = deviceId;
    }

    _pushDeviceSparkline(deviceId, key, value) {
        const deviceSparklines = this._deviceSparklines.get(deviceId);
        if (!deviceSparklines) {
            return;
        }
        const sparkline = deviceSparklines.get(key);
        if (!sparkline) {
            return;
        }
        sparkline.push(value);
    }

    _updateSparklineVisibility() {
        const visible = this._settings.get_boolean('show-sparklines');
        for (const deviceSparklines of this._deviceSparklines.values()) {
            for (const sparkline of deviceSparklines.values()) {
                sparkline.actor.visible = visible;
            }
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
        for (const deviceSparklines of this._deviceSparklines.values()) {
            for (const sparkline of deviceSparklines.values()) {
                sparkline.setWindowSeconds(this._sparklineWindowSeconds);
            }
        }
    }

    _getSparklineWindowSeconds() {
        const minutes = Math.max(1, this._settings.get_int('sparkline-window-minutes') || SPARKLINE_WINDOW_DEFAULT_MINUTES);
        return minutes * 60;
    }

    _updateSparklineTheme() {
        if (!this._singleDeviceContainer) {
            return;
        }

        // Remove all existing theme classes
        const themeClasses = [
            'bitaxe-sparkline-theme-colorful',
            'bitaxe-sparkline-theme-monochrome',
            'bitaxe-sparkline-theme-blue',
            'bitaxe-sparkline-theme-green',
            'bitaxe-sparkline-theme-amber',
            'bitaxe-sparkline-theme-purple',
            'bitaxe-sparkline-theme-red',
            'bitaxe-sparkline-theme-cyan',
            'bitaxe-sparkline-theme-orange',
            'bitaxe-sparkline-theme-pink',
            'bitaxe-sparkline-theme-lime',
            'bitaxe-sparkline-theme-teal',
        ];
        for (const themeClass of themeClasses) {
            if (this._singleDeviceContainer.has_style_class_name(themeClass)) {
                this._singleDeviceContainer.remove_style_class_name(themeClass);
            }
        }

        // Add the new theme class
        const theme = this._settings.get_string('sparkline-theme');
        const themeClass = `bitaxe-sparkline-theme-${theme}`;
        this._singleDeviceContainer.add_style_class_name(themeClass);

        // Force sparklines to repaint to apply new colors
        for (const deviceSparklines of this._deviceSparklines.values()) {
            for (const sparkline of deviceSparklines.values()) {
                sparkline.actor.queue_repaint();
            }
        }
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
                this._inFlight = false;
            }
            this._setRefreshButtonBusy(false);
            this._setStatValue('updatedLast', 'Paused');
            this._updateLabel('Paused');
        } else {
            this._fetchAllDevices();
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
        if (this._devices.length === 0) {
            return null;
        }

        let device;
        if (this._currentView === 'farm' || this._currentView === 'auto') {
            device = this._devices[0];
        } else {
            device = this._devices.find(d => d.id === this._currentView) || this._devices[0];
        }

        if (!device || !device.ip || device.ip === '') {
            return null;
        }

        const configured = device.ip.trim();
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
            for (const [key, row] of this._voltageRailRows.entries()) {
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
    }

    _formatStatsForSharing() {
        if (this._currentView === 'farm') {
            return this._formatFarmStatsForSharing();
        }

        const device = this._devices.find(d => d.id === this._currentView);
        if (!device) {
            return {
                text: 'No device selected',
                json: '{}',
            };
        }

        const stats = this._deviceStats.get(device.id);
        if (!stats) {
            return {
                text: 'No stats available. Please wait for data to be fetched.',
                json: '{}',
            };
        }

        return this._formatDeviceStatsForSharing(device, stats);
    }

    _formatDeviceStatsForSharing(device, stats) {
        const lines = [];
        lines.push(`=== ${device.nickname || device.ip || 'Bitaxe'} Stats ===`);

        const model = stats.ASICModel || 'Unknown';
        const version = stats.version || 'Unknown';
        lines.push(`Model: ${model} (v${version})`);

        const hashrate = this._formatHashrate(this._toNumber(stats.hashRate, 0));
        const hashrate1m = this._formatHashrate(this._toNumber(stats.hashRate_1m, 0));
        const hashrate10m = this._formatHashrate(this._toNumber(stats.hashRate_10m, 0));
        const hashrate1h = this._formatHashrate(this._toNumber(stats.hashRate_1h, 0));
        lines.push(`Hashrate: ${hashrate} (1m: ${hashrate1m}, 10m: ${hashrate10m}, 1h: ${hashrate1h})`);

        const asicTemp = Math.round(this._toNumber(stats.temp, 0));
        const vrmTemp = Math.round(this._toNumber(stats.vrTemp, 0));
        lines.push(`Temp: ASIC ${asicTemp}°C | VRM ${vrmTemp}°C`);

        const power = this._toNumber(stats.power, 0).toFixed(2);
        let efficiency = this._toNumber(stats.efficiency, NaN);
        if (!Number.isFinite(efficiency)) {
            const hr = this._toNumber(stats.hashRate, 0);
            const pwr = this._toNumber(stats.power, 0);
            if (pwr > 0 && hr > 0) {
                efficiency = hr / pwr;
            }
        }
        const effStr = Number.isFinite(efficiency) ? `${efficiency.toFixed(2)} GH/W` : '--';
        lines.push(`Power: ${power}W | Efficiency: ${effStr}`);

        const frequency = this._toNumber(stats.frequency, 0);
        if (frequency > 0) {
            lines.push(`Frequency: ${frequency} MHz`);
        }

        const sharesAccepted = this._toNumber(stats.sharesAccepted, 0);
        const sharesRejected = this._toNumber(stats.sharesRejected, 0);
        const errorPercentage = this._toNumber(stats.errorPercentage, 0).toFixed(2);
        lines.push(`Shares: ${sharesAccepted} accepted | ${sharesRejected} rejected (${errorPercentage}% error)`);

        const bestDiff = this._toNumber(stats.bestDiff, 0);
        const bestSessionDiff = this._toNumber(stats.bestSessionDiff, 0);
        if (bestDiff > 0) {
            lines.push(`Best Diff: All-Time ${this._formatDifficulty(bestDiff)} | Session ${this._formatDifficulty(bestSessionDiff)}`);
        }

        const pool = stats.stratumURL || 'Not connected';
        lines.push(`Pool: ${pool}`);

        const uptime = this._formatUptime(stats.uptimeSeconds);
        lines.push(`Uptime: ${uptime}`);

        const textOutput = lines.join('\n');
        const jsonOutput = JSON.stringify(stats, null, 2);

        return {
            text: textOutput,
            json: jsonOutput,
        };
    }

    _formatFarmStatsForSharing() {
        const lines = [];
        lines.push('=== Bitaxe Farm Stats ===');
        lines.push(`Devices: ${this._devices.length} (${this._deviceStats.size} online)`);
        lines.push('');

        let totalHashrate = 0;
        let totalPower = 0;
        let totalShares = 0;

        for (const device of this._devices) {
            const stats = this._deviceStats.get(device.id);
            if (stats) {
                totalHashrate += this._toNumber(stats.hashRate, 0);
                totalPower += this._toNumber(stats.power, 0);
                totalShares += this._toNumber(stats.sharesAccepted, 0);
            }

            const deviceName = device.nickname || device.ip || 'Device';
            lines.push(`--- ${deviceName} ---`);

            if (!stats) {
                lines.push('  Status: Offline');
                lines.push('');
                continue;
            }

            lines.push(`  Hashrate: ${this._formatHashrate(this._toNumber(stats.hashRate, 0))}`);
            lines.push(`  Temp: ${Math.round(this._toNumber(stats.temp, 0))}°C`);
            lines.push(`  Power: ${this._toNumber(stats.power, 0).toFixed(2)}W`);

            const hr = this._toNumber(stats.hashRate, 0);
            const pwr = this._toNumber(stats.power, 0);
            if (pwr > 0 && hr > 0) {
                const eff = hr / pwr;
                lines.push(`  Efficiency: ${eff.toFixed(2)} GH/W`);
            }

            lines.push(`  Shares: ${this._toNumber(stats.sharesAccepted, 0)}`);
            lines.push('');
        }

        lines.push('=== Farm Totals ===');
        lines.push(`Total Hashrate: ${this._formatHashrate(totalHashrate)}`);
        lines.push(`Total Power: ${totalPower.toFixed(2)}W`);
        if (totalPower > 0 && totalHashrate > 0) {
            const farmEff = totalHashrate / totalPower;
            lines.push(`Average Efficiency: ${farmEff.toFixed(2)} GH/W`);
        }
        lines.push(`Total Shares: ${totalShares}`);

        const textOutput = lines.join('\n');
        const jsonOutput = JSON.stringify({
            devices: this._devices.map(d => ({
                id: d.id,
                nickname: d.nickname,
                ip: d.ip,
                stats: this._deviceStats.get(d.id) || null,
            })),
        }, null, 2);

        return {
            text: textOutput,
            json: jsonOutput,
        };
    }

    _copyStatsToClipboard() {
        const formatted = this._formatStatsForSharing();
        const clipboardText = formatted.text;

        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, clipboardText);
        clipboard.set_text(St.ClipboardType.PRIMARY, clipboardText);

        if (this._copyStatsButton) {
            const originalLabel = this._copyStatsButton.label;
            this._copyStatsButton.label = 'Copied!';

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                if (this._copyStatsButton) {
                    this._copyStatsButton.label = originalLabel;
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._devicesChangedDebounceId) {
            GLib.source_remove(this._devicesChangedDebounceId);
            this._devicesChangedDebounceId = null;
        }

        if (this._settingsChangedIds) {
            for (const id of this._settingsChangedIds) {
                this._settings.disconnect(id);
            }
            this._settingsChangedIds = null;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._httpSession) {
            try {
                this._httpSession.abort();
            } catch (e) {
                // Session may already be aborted, ignore
            }
            this._httpSession = null;
        }

        if (this._deviceSparklines) {
            this._deviceSparklines.clear();
            this._deviceSparklines = null;
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
