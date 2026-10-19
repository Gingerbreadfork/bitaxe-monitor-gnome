#!/bin/bash
# Runs the working tree in a headless GNOME Shell against mock devices and
# writes screenshots and logs to tools/headless-test/out/. Usage is in README.md.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/out"
UUID="bitaxe-monitor@gingerbreadfork.github.io"

if [ -z "${HEADLESS_TEST_INNER:-}" ]; then
    rm -rf "$OUT"
    mkdir -p "$OUT/xdg-config" "$OUT/xdg-data/gnome-shell/extensions" "$OUT/shots"
    ln -s "$ROOT" "$OUT/xdg-data/gnome-shell/extensions/$UUID"
    glib-compile-schemas "$ROOT/schemas/"
    exec env HEADLESS_TEST_INNER=1 \
        XDG_CONFIG_HOME="$OUT/xdg-config" \
        XDG_DATA_HOME="$OUT/xdg-data" \
        GSETTINGS_BACKEND=keyfile \
        GTK_A11Y=none \
        timeout 200 dbus-run-session -- bash "$0"
fi

MONITOR="${MONITOR:-1920x1080}"
if [ -z "${DEVICES_JSON:-}" ]; then
    DEVICES_JSON='[{"id":"dev-1","nickname":"Garage Gamma","ip":"127.0.0.1:8801"},{"id":"dev-2","nickname":"Office Gamma","ip":"127.0.0.1:8802"},{"id":"dev-3","nickname":"Shed Ultra With A Very Long Nickname","ip":"127.0.0.1:8803"}]'
fi

MOCK_OUT="$OUT" python3 "$HERE/mock_axeos.py" &
MOCK=$!

gsettings set org.gnome.shell enabled-extensions "['$UUID']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '99'
GS="gsettings --schemadir $ROOT/schemas"
$GS set org.gnome.shell.extensions.bitaxe-monitor devices-json "$DEVICES_JSON"
$GS set org.gnome.shell.extensions.bitaxe-monitor selected-device-id 'dev-1'
$GS set org.gnome.shell.extensions.bitaxe-monitor farm-view-columns 3
$GS set org.gnome.shell.extensions.bitaxe-monitor notify-on-best-diff true

gnome-shell --headless --virtual-monitor "$MONITOR" --wayland --no-x11 --unsafe-mode --wayland-display bitaxe-test > "$OUT/shell.log" 2>&1 &
SHELL_PID=$!

ev() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1" | tee -a "$OUT/evals.log"
}

shot() {
    ev "(() => { const Gio = imports.gi.Gio; const Shell = imports.gi.Shell; const s = new Shell.Screenshot(); const f = Gio.File.new_for_path('$OUT/shots/$1.png'); const st = f.replace(null, false, Gio.FileCreateFlags.NONE, null); s.screenshot(false, st, (o, r) => { try { s.screenshot_finish(r); } catch (e) { log('shot failed ' + e); } st.close(null); }); return 'shot $1'; })()" > /dev/null
    sleep 1.5
}

dismiss_banner() {
    ev "(() => { const n = Main.messageTray._notification; if (n) { n.destroy(); } return 'dismissed'; })()" > /dev/null
    sleep 1
}

note_count() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "globalThis._notes.length" | sed -nE "s/.*'([0-9]+)'.*/\1/p"
}

wait_for_note() {
    local before="$1" now
    for _ in $(seq 1 40); do
        now="$(note_count)"
        if [ "${before:-0}" -lt "${now:-0}" ]; then
            sleep 2
            return
        fi
        sleep 0.5
    done
    echo "no notification arrived within 20s" | tee -a "$OUT/evals.log"
}

for _ in $(seq 1 60); do
    if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

IND="Main.panel.statusArea['$UUID']"
sleep 9
ev "(() => { globalThis._notes = []; const hook = source => source.connect('notification-added', (s, n) => globalThis._notes.push((n.title || '') + ' | ' + (n.body || n.bannerBodyText || ''))); Main.messageTray.getSources().forEach(hook); Main.messageTray.connect('source-added', (t, s) => hook(s)); return 'hooked'; })()"
ev "$IND ? 'indicator present' : 'indicator missing'"
shot 01-panel-closed

ev "$IND.menu.open(); 'opened'" > /dev/null
sleep 1.5
shot 02-farm-view

ev "(() => { const out = []; for (const id of ['dev-1', 'dev-2']) { const e = $IND._farmCards.get(id); const h = e.card.get_child().get_first_child(); const b = h.get_children().find(c => c.label === '👋'); out.push(id + ': ' + (b ? 'has identify' : 'no identify')); if (b) { b.emit('clicked', 1); } } return out.join(', '); })()"
sleep 2.5
shot 03-farm-identify-tick

ev "$IND._switchToView('dev-1'); 'single'" > /dev/null
sleep 1.5
shot 04-single-view

ev "$IND._switchToView('dev-2'); 'single 2'" > /dev/null
sleep 1.5
shot 05-single-view-block-device
ev "(() => { const sv = $IND._singleDeviceScrollView; return 'single view: viewport ' + sv.height + 'px, content ' + $IND._singleDeviceContainer.height + 'px'; })()"

ev "$IND.menu.close(); 'closed'" > /dev/null
sleep 1
NOTES_BEFORE="$(note_count)"
touch "$OUT/trigger-best"
wait_for_note "$NOTES_BEFORE"
shot 06-best-share-alert
dismiss_banner

NOTES_BEFORE="$(note_count)"
touch "$OUT/trigger-block"
wait_for_note "$NOTES_BEFORE"
shot 07-block-found-alert
dismiss_banner
ev "'notifications: ' + globalThis._notes.join(' ;; ')"

ev "$IND._switchToView('farm'); $IND.menu.open(); 'farm again'" > /dev/null
sleep 1.5
shot 08-farm-after-block

ev "$IND.menu.close(); 'closed'" > /dev/null
gnome-extensions prefs "$UUID" >/dev/null 2>&1 &
sleep 5
shot 09-prefs

kill "$SHELL_PID" "$MOCK" 2>/dev/null
wait 2>/dev/null

echo
echo "identify requests:"
cat "$OUT/identify.log" 2>/dev/null || echo "  none"
echo
echo "extension errors and criticals in shell.log:"
grep -E 'bitaxe|JS ERROR|CRITICAL' "$OUT/shell.log" | grep -vE 'Unset XDG|gvfs|fusermount' || echo "  none"
echo
echo "screenshots in $OUT/shots"
