# Proxy Server Setup

Target domain:

```text
proxy.qubiteapp.online -> 193.233.91.128
```

Current server layout before proxy deployment:

```text
Nginx listens on 80/443
Nginx proxies Qubite to 127.0.0.1:3000
PM2 runs /var/www/qubiteapp/back/server.js
UFW allows 22, 80, 443
```

## Target Layout

Option B moves public TLS entrypoint to Caddy:

```text
public 80/443
  -> caddy-naive.service
     -> qubiteapp.ru reverse_proxy to 127.0.0.1:8080
     -> proxy.qubiteapp.online forward_proxy with NaiveProxy support

internal 127.0.0.1:8080
  -> nginx
     -> 127.0.0.1:3000 Node/PM2
```

This keeps the website available while making `proxy.qubiteapp.online` a
separate runtime path.

## Safe Deployment Checklist

For a full master server, run from the repository root:

```bash
sudo ./deploy/proxy/setup-master-server.sh
```

The script asks for:

- main website domain, for example `qubiteapp.ru`;
- extra website domains, comma separated;
- proxy domain on this master, for example `proxy.qubiteapp.online`;
- Node app port;
- proxy credential encryption key;
- local sync token.

For a child proxy-only server, first create the node in the owner panel, then
run:

```bash
sudo ./deploy/proxy/setup-proxy-node.sh
```

The child script asks for:

- proxy domain of this node;
- main website domain used for browser redirects;
- master API base URL;
- node token from the owner panel.

1. Backup Nginx and current PM2 state.

```bash
cp -a /etc/nginx /root/nginx-backup-$(date +%F-%H%M%S)
pm2 save
```

2. Install Go and build Caddy with the forwardproxy module.

3. Move Nginx from public 80/443 to internal `127.0.0.1:8080`.

4. Validate configs before reload.

```bash
nginx -t
caddy validate --config /etc/caddy/Caddyfile
```

5. Start Caddy and check both domains.

```bash
systemctl status caddy-naive
curl -I https://qubiteapp.ru
curl -I https://proxy.qubiteapp.online
```

Expected browser behavior:

```text
https://proxy.qubiteapp.online without proxy credentials redirects to https://qubiteapp.ru
NaiveProxy client with valid credentials gets CONNECT proxy access
```

## Required Qubite Env

```env
PROXY_PUBLIC_DOMAIN=proxy.qubiteapp.online
PROXY_SESSION_TTL_MS=1800000
PROXY_REFRESH_AFTER_MS=600000
PROXY_MAX_ACTIVE_DEVICES=3
PROXY_CREDENTIAL_ENCRYPTION_KEY=<random-secret>
PROXY_SYNC_TOKEN=<random-secret>
```

`PROXY_CREDENTIAL_ENCRYPTION_KEY` is used so Caddy credentials are not stored as
plain text in SQLite. `PROXY_SYNC_TOKEN` is used only by the local sync agent.

## Moving Domains Or Master Server

If the main website domain changes, update:

```env
APP_BASE_URL=https://new-main-domain.example
```

Then rerun `setup-master-server.sh` on the master and use the new main domain
when rerunning `setup-proxy-node.sh` on child nodes.

If only a child proxy domain changes:

1. update the node domain in the owner "Прокси" panel;
2. rerun `setup-proxy-node.sh` on that VPS with the new proxy domain;
3. make sure DNS points the new domain to the child VPS.

If the master API domain changes, rerun `setup-proxy-node.sh` on every child
node and enter the new `MASTER_API_BASE_URL`. Existing Caddy proxy traffic keeps
working only until the last synced credentials expire, so do this before moving
real users.

## Rollback

If Caddy fails, stop it and restore public Nginx:

```bash
systemctl stop caddy-naive
cp -a /root/nginx-backup-YYYY-MM-DD-HHMMSS/* /etc/nginx/
nginx -t
systemctl restart nginx
```
