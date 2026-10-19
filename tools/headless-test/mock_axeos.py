#!/usr/bin/env python3
"""Mock AxeOS devices for the headless shell test: a healthy Gamma on port 8801
and a block-finding Gamma on 8802. Trigger files and identify.log live in MOCK_OUT."""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.environ.get("MOCK_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)


def base_info(suffix):
    return {
        "power": 20.9, "voltage": 5156.25, "current": 14547.0,
        "temp": 58.0, "vrTemp": 72, "coreVoltageActual": 1095,
        "actualFrequency": 600, "expectedHashrate": 1200.0,
        "fanspeed": 60, "fanrpm": 3360, "hashRate": 1221.7,
        "hashRate_1m": 1202.3, "hashRate_10m": 1218.9, "hashRate_1h": 1224.4,
        "errorPercentage": 0.21, "sharesAccepted": 67857, "sharesRejected": 185,
        "bestDiff": 102220000, "bestSessionDiff": 4210000,
        "poolDifficulty": 2000, "responseTime": 41.2,
        "blockFound": 0, "showNewBlock": False,
        "blockHeight": 912345, "networkDifficulty": 129900000000000,
        "coinbaseValueTotalSatoshis": 313791204, "coinbaseValueUserSatoshis": 0,
        "freeHeap": 172540, "uptimeSeconds": 478380,
        "wifiStatus": "Connected!", "wifiRSSI": -55, "ssid": "Mock-WiFi",
        "ipv4": "127.0.0.1", "hostname": "bitaxe" + suffix,
        "version": "v2.15.0", "axeOSVersion": "v2.15.0",
        "boardVersion": "602", "ASICModel": "BM1370",
        "stratumURL": "solo.atlaspool.io", "stratumPort": 3333,
        "stratumUser": "bc1qmock.bitaxe" + suffix,
        "fallbackStratumURL": "ausolo.ckpool.org", "fallbackStratumPort": 3333,
        "isUsingFallbackStratum": False, "frequency": 600, "coreVoltage": 1100,
        "temptarget": 60, "overclockEnabled": 1, "autofanspeed": 1,
        "overheat_mode": 0,
    }


def triggered(name):
    return os.path.exists(os.path.join(OUT, name))


class State:
    identify = {}
    lock = threading.Lock()


def make_handler(port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def _send_json(self, obj):
            body = json.dumps(obj).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != "/api/system/info":
                self.send_error(404)
                return
            if port == 8801:
                info = base_info("-1")
                if triggered("trigger-best"):
                    info["bestDiff"] = 3460000000
                    info["bestSessionDiff"] = 3460000000
            else:
                info = base_info("-2")
                info.update({
                    "hashRate": 1187.2, "temp": 61.0, "power": 21.3,
                    "showNewBlock": True, "blockFound": 1,
                    "bestDiff": 187000000000000, "sharesAccepted": 91320,
                })
                if triggered("trigger-block"):
                    info["blockFound"] = 2
            self._send_json(info)

        def do_POST(self):
            if self.path != "/api/system/identify":
                self.send_error(404)
                return
            with State.lock:
                on = not State.identify.get(port, False)
                State.identify[port] = on
            with open(os.path.join(OUT, "identify.log"), "a") as f:
                f.write(f"{port} identify -> {'on' if on else 'off'}\n")
            if on:
                self._send_json({"message": 'The device says "Hi!" for 30 seconds.'})
            else:
                self._send_json({"message": 'The device no longer says "Hi!".'})

    return Handler


def serve(port):
    ThreadingHTTPServer(("127.0.0.1", port), make_handler(port)).serve_forever()


if __name__ == "__main__":
    for port in (8801, 8802):
        threading.Thread(target=serve, args=(port,), daemon=True).start()
    threading.Event().wait()
