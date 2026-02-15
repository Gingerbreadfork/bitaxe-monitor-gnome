import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function generateId() {
    return `device-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

const DeviceRow = GObject.registerClass(
class DeviceRow extends Adw.ExpanderRow {
    _init(device, onUpdate, onDelete) {
        super._init({
            title: device.nickname || device.ip || 'Unnamed Device',
            subtitle: device.ip || 'No IP configured',
        });

        this._device = device;
        this._onUpdate = onUpdate;
        this._onDelete = onDelete;

        const nicknameRow = new Adw.EntryRow({
            title: 'Nickname',
        });
        nicknameRow.set_text(device.nickname || '');
        nicknameRow.connect('changed', (widget) => {
            this._device.nickname = widget.get_text();
            this.set_title(this._device.nickname || this._device.ip || 'Unnamed Device');
            this._onUpdate();
        });
        this.add_row(nicknameRow);

        const ipRow = new Adw.EntryRow({
            title: 'IP Address or Hostname',
        });
        ipRow.set_text(device.ip || '');
        ipRow.connect('changed', (widget) => {
            this._device.ip = widget.get_text();
            this.set_subtitle(this._device.ip || 'No IP configured');
            this._onUpdate();
        });
        this.add_row(ipRow);

        const deleteButton = new Gtk.Button({
            label: 'Delete Device',
            css_classes: ['destructive-action'],
            halign: Gtk.Align.END,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        deleteButton.connect('clicked', () => {
            this._onDelete(this._device.id);
        });
        this.add_row(deleteButton);
    }

    getDevice() {
        return this._device;
    }
});

export default class BitaxeMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Migrate old single IP to devices list if needed
        this._migrateSettings(settings);

        window._settings = settings;

        // Devices Page
        const devicesPage = new Adw.PreferencesPage({
            title: 'Devices',
            icon_name: 'network-server-symbolic',
        });
        window.add(devicesPage);

        const devicesGroup = new Adw.PreferencesGroup({
            title: 'Bitaxe Devices',
            description: 'Add and manage your Bitaxe devices',
        });
        devicesPage.add(devicesGroup);

        // Device list container
        const devicesListBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });

        const devicesFrame = new Gtk.Frame({
            child: devicesListBox,
            margin_bottom: 12,
        });
        devicesGroup.add(devicesFrame);

        const addDeviceButton = new Gtk.Button({
            label: 'Add Device',
            halign: Gtk.Align.START,
            css_classes: ['suggested-action'],
        });
        devicesGroup.add(addDeviceButton);

        const loadDevices = () => {
            // Clear existing rows
            let child = devicesListBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                devicesListBox.remove(child);
                child = next;
            }

            const devicesJson = settings.get_string('devices-json');
            let devices = [];
            try {
                devices = JSON.parse(devicesJson);
            } catch (e) {
                devices = [];
            }

            if (devices.length === 0) {
                const placeholder = new Gtk.Label({
                    label: 'No devices configured. Click "Add Device" to get started.',
                    margin_top: 24,
                    margin_bottom: 24,
                    css_classes: ['dim-label'],
                });
                devicesListBox.append(placeholder);
                return;
            }

            const saveDevices = () => {
                const currentDevices = [];
                let child = devicesListBox.get_first_child();
                while (child) {
                    if (child instanceof DeviceRow) {
                        currentDevices.push(child.getDevice());
                    }
                    child = child.get_next_sibling();
                }
                settings.set_string('devices-json', JSON.stringify(currentDevices));
            };

            devices.forEach(device => {
                const row = new DeviceRow(
                    device,
                    saveDevices,
                    (id) => {
                        // Find and remove the row
                        let child = devicesListBox.get_first_child();
                        while (child) {
                            if (child instanceof DeviceRow && child.getDevice().id === id) {
                                devicesListBox.remove(child);
                                saveDevices();
                                loadDevices(); // Reload to update placeholder if needed
                                break;
                            }
                            child = child.get_next_sibling();
                        }
                    }
                );
                devicesListBox.append(row);
            });
        };

        addDeviceButton.connect('clicked', () => {
            const devicesJson = settings.get_string('devices-json');
            let devices = [];
            try {
                devices = JSON.parse(devicesJson);
            } catch (e) {
                devices = [];
            }

            const newDevice = {
                id: generateId(),
                nickname: `Bitaxe ${devices.length + 1}`,
                ip: '',
            };
            devices.push(newDevice);
            settings.set_string('devices-json', JSON.stringify(devices));
            loadDevices();
        });

        loadDevices();

        // Multi-device settings group
        const multiDeviceGroup = new Adw.PreferencesGroup({
            title: 'Multi-Device Settings',
            description: 'Configure behavior when multiple devices are added',
        });
        devicesPage.add(multiDeviceGroup);

        this._addComboRow(
            settings,
            multiDeviceGroup,
            'default-view',
            'Default View',
            'What to show when opening the popup',
            ['Auto (Farm if 2+ devices, otherwise single)', 'Always Farm View', 'Always Single Device'],
            ['auto', 'farm', 'single']
        );

        this._addComboRow(
            settings,
            multiDeviceGroup,
            'panel-display-mode',
            'Panel Display',
            'What to show on the panel with multiple devices',
            ['Auto (Selected device or first)', 'Selected Device Only', 'Aggregate (Total)'],
            ['auto', 'selected', 'aggregate']
        );

        const scrollDeviceListRow = new Adw.SwitchRow({
            title: 'Always Scroll Device List',
            subtitle: 'Use scrollable device list even with fewer than 8 devices',
        });
        scrollDeviceListRow.set_active(settings.get_boolean('always-scroll-device-list'));
        scrollDeviceListRow.connect('notify::active', (widget) => {
            settings.set_boolean('always-scroll-device-list', widget.get_active());
        });
        multiDeviceGroup.add(scrollDeviceListRow);

        const farmColumnsRow = new Adw.SpinRow({
            title: 'Farm View Columns',
            subtitle: 'Number of columns to display devices in farm view',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 4,
                step_increment: 1,
            }),
        });
        farmColumnsRow.set_value(settings.get_int('farm-view-columns'));
        farmColumnsRow.connect('notify::value', (widget) => {
            settings.set_int('farm-view-columns', Math.round(widget.get_value()));
        });
        multiDeviceGroup.add(farmColumnsRow);

        // Farm View Stats Settings
        const farmStatsGroup = new Adw.PreferencesGroup({
            title: 'Farm View Stats',
            description: 'Choose which stats to display for each device in farm view',
        });
        devicesPage.add(farmStatsGroup);

        const addFarmSwitchRow = (key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle});
            row.set_active(settings.get_boolean(key));
            row.connect('notify::active', (widget) => {
                settings.set_boolean(key, widget.get_active());
            });
            farmStatsGroup.add(row);
        };

        addFarmSwitchRow('farm-show-hashrate', 'Show Hashrate', 'Display hashrate for each device');
        addFarmSwitchRow('farm-show-asic-temp', 'Show ASIC Temperature', 'Display ASIC temperature for each device');
        addFarmSwitchRow('farm-show-vrm-temp', 'Show VRM Temperature', 'Display VRM temperature for each device');
        addFarmSwitchRow('farm-show-power', 'Show Power', 'Display power consumption for each device');
        addFarmSwitchRow('farm-show-voltage', 'Show Voltage', 'Display voltage for each device');
        addFarmSwitchRow('farm-show-efficiency', 'Show Efficiency', 'Display mining efficiency for each device');
        addFarmSwitchRow('farm-show-shares', 'Show Shares', 'Display accepted shares for each device');
        addFarmSwitchRow('farm-show-error-rate', 'Show Error Rate', 'Display error rate percentage for each device');
        addFarmSwitchRow('farm-show-best-diff', 'Show Best Difficulty', 'Display best difficulty for each device');
        addFarmSwitchRow('farm-show-fan', 'Show Fan RPM', 'Display fan speed for each device');
        addFarmSwitchRow('farm-show-frequency', 'Show Frequency', 'Display ASIC frequency for each device');
        addFarmSwitchRow('farm-show-pool', 'Show Pool', 'Display mining pool for each device');
        addFarmSwitchRow('farm-show-uptime', 'Show Uptime', 'Display device uptime for each device');
        addFarmSwitchRow('farm-show-model', 'Show Model', 'Display ASIC model for each device');

        // Display Settings Page
        const displayPage = new Adw.PreferencesPage({
            title: 'Display',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        window.add(displayPage);

        const connectionGroup = new Adw.PreferencesGroup({
            title: 'Connection Settings',
        });
        displayPage.add(connectionGroup);

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval',
            subtitle: 'How often to fetch stats (seconds)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
            }),
        });
        refreshRow.set_value(settings.get_int('refresh-interval'));
        refreshRow.connect('notify::value', (widget) => {
            settings.set_int('refresh-interval', widget.get_value());
        });
        connectionGroup.add(refreshRow);

        const panelGroup = new Adw.PreferencesGroup({
            title: 'Panel Display',
            description: 'Choose what to show on the panel',
        });
        displayPage.add(panelGroup);

        const addSwitchRow = (group, key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle});
            row.set_active(settings.get_boolean(key));
            row.connect('notify::active', (widget) => {
                settings.set_boolean(key, widget.get_active());
            });
            group.add(row);
        };

        addSwitchRow(panelGroup, 'show-hashrate', 'Show Hashrate', 'Display current hashrate on the panel');
        addSwitchRow(panelGroup, 'show-temperature', 'Show Temperature', 'Display ASIC temperature on the panel');
        addSwitchRow(panelGroup, 'show-power', 'Show Power', 'Display power consumption on the panel');
        addSwitchRow(panelGroup, 'show-vrm-temp', 'Show VRM Temperature', 'Display VRM temperature on the panel');
        addSwitchRow(panelGroup, 'show-efficiency', 'Show Efficiency', 'Display mining efficiency (GH/W) on the panel');
        addSwitchRow(panelGroup, 'show-fan-rpm', 'Show Fan RPM', 'Display fan speed on the panel');
        addSwitchRow(panelGroup, 'show-frequency', 'Show Frequency', 'Display ASIC frequency on the panel');
        addSwitchRow(panelGroup, 'show-shares', 'Show Shares', 'Display accepted shares count on the panel');
        addSwitchRow(panelGroup, 'show-uptime', 'Show Uptime', 'Display device uptime on the panel');

        const popupGroup = new Adw.PreferencesGroup({
            title: 'Popup Settings',
            description: 'Customize the stats popup menu',
        });
        displayPage.add(popupGroup);

        addSwitchRow(popupGroup, 'show-sparklines', 'Show Sparklines', 'Display inline history sparklines in the popup');

        const sparklineWindowRow = new Adw.SpinRow({
            title: 'Sparkline Window',
            subtitle: 'How much history to show in sparklines (minutes)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
            }),
        });
        sparklineWindowRow.set_value(settings.get_int('sparkline-window-minutes'));
        sparklineWindowRow.connect('notify::value', (widget) => {
            settings.set_int('sparkline-window-minutes', Math.round(widget.get_value()));
        });
        popupGroup.add(sparklineWindowRow);

        this._addComboRow(
            settings,
            popupGroup,
            'sparkline-theme',
            'Sparkline Theme',
            'Color theme for sparkline graphs',
            ['Colorful (Default)', 'Monochrome', 'Blue', 'Green', 'Amber', 'Purple', 'Red', 'Cyan', 'Orange', 'Pink', 'Lime', 'Teal'],
            ['colorful', 'monochrome', 'blue', 'green', 'amber', 'purple', 'red', 'cyan', 'orange', 'pink', 'lime', 'teal']
        );

        addSwitchRow(popupGroup, 'show-network-info', 'Show Network Info', 'Display IP, SSID, RSSI, and heap info in the popup');

        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Customize the panel display appearance',
        });
        displayPage.add(appearanceGroup);

        this._addComboRow(
            settings,
            appearanceGroup,
            'panel-separator',
            'Panel Separator',
            'Character to separate items on the panel',
            ['| (Pipe)', '→ (Arrow)', '• (Bullet)', '- (Dash)', '/ (Slash)', '  (Space)'],
            ['|', '→', '•', '-', '/', ' ']
        );

        const customSeparatorRow = new Adw.EntryRow({
            title: 'Custom Separator',
        });
        customSeparatorRow.set_tooltip_text('Override with custom text (leave empty to use selector above)');
        customSeparatorRow.set_text(settings.get_string('custom-separator'));
        customSeparatorRow.connect('changed', (widget) => {
            settings.set_string('custom-separator', widget.get_text());
        });
        appearanceGroup.add(customSeparatorRow);

        this._addComboRow(
            settings,
            appearanceGroup,
            'hashrate-unit',
            'Hashrate Unit',
            'Display unit for hashrate values',
            ['Auto (GH/s or TH/s)', 'Always GH/s', 'Always TH/s'],
            ['auto', 'GH/s', 'TH/s']
        );

        // About Page
        const aboutPage = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);

        const aboutGroup = new Adw.PreferencesGroup({
            title: 'About',
        });
        aboutPage.add(aboutGroup);

        const aboutRow = new Adw.ActionRow({
            title: 'Bitaxe Monitor',
            subtitle: 'Monitor your Bitaxe mining stats\nSupports single and multi-device farms',
        });
        aboutGroup.add(aboutRow);
    }

    _addComboRow(settings, group, key, title, subtitle, labels, values) {
        const row = new Adw.ComboRow({title, subtitle});
        const model = new Gtk.StringList();
        for (const label of labels) {
            model.append(label);
        }
        row.set_model(model);

        const currentValue = settings.get_string(key);
        const currentIndex = values.indexOf(currentValue);
        if (currentIndex >= 0) {
            row.set_selected(currentIndex);
        }

        row.connect('notify::selected', (widget) => {
            const selectedIndex = widget.get_selected();
            settings.set_string(key, values[selectedIndex]);
        });
        group.add(row);
    }

    _migrateSettings(settings) {
        const devicesJson = settings.get_string('devices-json');
        const oldIp = settings.get_string('bitaxe-ip');

        // If devices list is empty but old IP exists, migrate it
        if (devicesJson === '[]' && oldIp && oldIp !== '') {
            const device = {
                id: generateId(),
                nickname: 'My Bitaxe',
                ip: oldIp,
            };
            settings.set_string('devices-json', JSON.stringify([device]));
            settings.set_string('selected-device-id', device.id);
            console.log('[bitaxe-monitor] Migrated single IP to devices list');
        }
    }
}
