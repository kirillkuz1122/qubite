import grp
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.request import Request, urlopen


STATE_DIR = Path("/etc/qubite-vpn")
CERT_DIR = Path("/etc/letsencrypt/live/qubite-vpn-us")
SING_BOX = "/usr/local/bin/sing-box"
UNIT = "qubite-vpn-us.service"
API = "http://127.0.0.1:9130/api/proxy"


def install_if_changed(target, content, group_id, validate=None):
    if target.exists() and target.read_bytes() == content:
        return False
    with tempfile.NamedTemporaryFile(dir=STATE_DIR, delete=False) as temporary:
        temporary.write(content)
        name = Path(temporary.name)
    try:
        if validate:
            validate(name)
        os.chown(name, 0, group_id)
        name.chmod(0o640)
        os.replace(name, target)
    finally:
        name.unlink(missing_ok=True)
    return True


def main():
    state = json.loads((STATE_DIR / "node.json").read_text())
    headers = {"Authorization": "Bearer " + state["token"]}
    hysteria_port = state.get("hysteria2Port")
    query = "?hysteria2=1" if hysteria_port else ""
    with urlopen(Request(API + "/sync/credentials" + query, headers=headers), timeout=8) as response:
        payload = json.load(response)
    if payload.get("domain") != state["domain"] or not isinstance(payload.get("realityUsers"), list):
        raise RuntimeError("Wrong node or invalid response from the Qubite VPN API")
    if hysteria_port and not isinstance(payload.get("hysteria2Users"), list):
        raise RuntimeError("Missing Hysteria 2 credentials from the Qubite VPN API")

    users = [{"name": str(index), "uuid": user["uuid"], "flow": "xtls-rprx-vision"}
             for index, user in enumerate(payload["realityUsers"])]
    staging = Path("/root/qubite-migration/vpn-stage-uuid")
    if staging.is_file():
        users.append({"name": "migration-check", "uuid": staging.read_text().strip(), "flow": "xtls-rprx-vision"})
    listen = "::" if state.get("listenIpv6") else "0.0.0.0"
    config = {
        "log": {"level": "warn"},
        "dns": {"servers": [{"type": "udp", "tag": "resolver", "server": "1.1.1.1"}], "final": "resolver"},
        "inbounds": [{
            "type": "vless", "tag": "us-ingress", "listen": listen, "listen_port": state["port"],
            "users": users,
            "tls": {"enabled": True, "server_name": state["sni"], "reality": {
                "enabled": True, "handshake": {"server": state["sni"], "server_port": 443},
                "private_key": state["private"], "short_id": [state["shortId"]],
            }},
        }],
        "outbounds": [{"type": "direct", "tag": "direct"}],
        "route": {
            "default_domain_resolver": "resolver",
            "rules": [{"ip_is_private": True, "action": "reject"}],
            "final": "direct",
        },
    }
    group_id = grp.getgrnam("qubite-vpn").gr_gid
    cert_changed = False
    hysteria_users = payload.get("hysteria2Users", [])
    if hysteria_port and hysteria_users:
        cert = STATE_DIR / "hysteria2.crt"
        key = STATE_DIR / "hysteria2.key"
        cert_changed = install_if_changed(cert, (CERT_DIR / "fullchain.pem").read_bytes(), group_id)
        key_changed = install_if_changed(key, (CERT_DIR / "privkey.pem").read_bytes(), group_id)
        cert_changed = cert_changed or key_changed
        config["inbounds"].append({
            "type": "hysteria2", "tag": "us-hysteria2", "listen": listen, "listen_port": hysteria_port,
            "users": [{"name": str(index), "password": user["password"]}
                      for index, user in enumerate(hysteria_users)],
            "ignore_client_bandwidth": True,
            "tls": {"enabled": True, "certificate_path": str(cert), "key_path": str(key)},
        })

    content = (json.dumps(config, sort_keys=True, indent=2) + "\n").encode()
    config_changed = install_if_changed(
        STATE_DIR / "sing-box.json", content, group_id,
        validate=lambda path: subprocess.run([SING_BOX, "check", "-c", str(path)], check=True),
    )
    subprocess.run(["systemctl", "restart" if config_changed or cert_changed else "start", UNIT], check=True)
    subprocess.run(["systemctl", "is-active", "--quiet", UNIT], check=True)

    body = json.dumps({
        "health": "online",
        "reality": {"publicKey": state["public"], "shortId": state["shortId"], "targetSni": state["sni"]},
        "hysteria2": {"port": hysteria_port} if hysteria_port and hysteria_users else None,
    }).encode()
    with urlopen(Request(API + "/node/heartbeat", data=body, headers={**headers, "Content-Type": "application/json"}), timeout=8) as response:
        if not json.load(response).get("ok"):
            raise RuntimeError("Qubite rejected VPN heartbeat")
    print(f'Qubite credentials synchronized: {len(payload["realityUsers"])} VLESS, {len(hysteria_users)} Hysteria 2.')


if __name__ == "__main__":
    main()
