import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class BitaxeMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const connectionGroup = new Adw.PreferencesGroup({
            title: 'Connection Settings',
            description: 'Configure your Bitaxe device connection',
        });
        page.add(connectionGroup);

        const ipRow = new Adw.EntryRow({
            title: 'Bitaxe IP Address',
        });
        ipRow.set_text(settings.get_string('bitaxe-ip'));
        ipRow.connect('changed', (widget) => {
            settings.set_string('bitaxe-ip', widget.get_text());
        });
        connectionGroup.add(ipRow);

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

        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display Settings',
            description: 'Choose what to show on the panel',
        });
        page.add(displayGroup);

        const addSwitchRow = (group, key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle});
            row.set_active(settings.get_boolean(key));
            row.connect('notify::active', (widget) => {
                settings.set_boolean(key, widget.get_active());
            });
            group.add(row);
        };

        addSwitchRow(displayGroup, 'show-hashrate', 'Show Hashrate', 'Display current hashrate on the panel');
        addSwitchRow(displayGroup, 'show-temperature', 'Show Temperature', 'Display ASIC temperature on the panel');
        addSwitchRow(displayGroup, 'show-power', 'Show Power', 'Display power consumption on the panel');
        addSwitchRow(displayGroup, 'show-vrm-temp', 'Show VRM Temperature', 'Display VRM temperature on the panel');
        addSwitchRow(displayGroup, 'show-efficiency', 'Show Efficiency', 'Display mining efficiency (GH/W) on the panel');
        addSwitchRow(displayGroup, 'show-fan-rpm', 'Show Fan RPM', 'Display fan speed on the panel');
        addSwitchRow(displayGroup, 'show-frequency', 'Show Frequency', 'Display ASIC frequency on the panel');
        addSwitchRow(displayGroup, 'show-shares', 'Show Shares', 'Display accepted shares count on the panel');
        addSwitchRow(displayGroup, 'show-uptime', 'Show Uptime', 'Display device uptime on the panel');

        const popupGroup = new Adw.PreferencesGroup({
            title: 'Popup Settings',
            description: 'Customize the stats popup menu',
        });
        page.add(popupGroup);
        addSwitchRow(popupGroup, 'show-sparklines', 'Show Sparklines', 'Display inline history sparklines in the popup (enabled by default)');
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
        addSwitchRow(popupGroup, 'show-network-info', 'Show Network Info', 'Display IP, SSID, RSSI, and heap info in the popup (great to disable for screenshots)');

        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance Settings',
            description: 'Customize the panel display appearance',
        });
        page.add(appearanceGroup);

        const addComboRow = (group, key, title, subtitle, labels, values) => {
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
        };

        addComboRow(
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

        addComboRow(
            appearanceGroup,
            'hashrate-unit',
            'Hashrate Unit',
            'Display unit for hashrate values',
            ['Auto (GH/s or TH/s)', 'Always GH/s', 'Always TH/s'],
            ['auto', 'GH/s', 'TH/s']
        );

        const aboutGroup = new Adw.PreferencesGroup({
            title: 'About',
        });
        page.add(aboutGroup);

        const aboutRow = new Adw.ActionRow({
            title: 'Bitaxe Monitor',
            subtitle: 'Monitor your Bitaxe mining stats',
        });
        aboutGroup.add(aboutRow);
    }
}
