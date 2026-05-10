# Qubite Proxy Architecture

## Goal

`qubiteapp.ru` remains the product website and account/API backend.
`proxy.qubiteapp.online` is a separate proxy entrypoint that can keep working
when the website UI is in maintenance mode or the PM2 website process is stopped.

The first production target is a personal test proxy. The design deliberately
keeps the path open for multiple foreign VPS nodes and automatic client-side
server switching.

## Runtime Layout

```text
Client app
  -> logs in to https://qubiteapp.ru
  -> registers a device
  -> starts or refreshes a short-lived proxy session
  -> receives a NaiveProxy credential and routing profile

qubiteapp.ru
  -> Caddy frontend
  -> internal Nginx on 127.0.0.1:8080 and [::1]:8080
  -> Node/Express on 127.0.0.1:3000

proxy.qubiteapp.online
  -> Caddy + forwardproxy/naive module
  -> active credentials generated from Qubite proxy sessions
  -> unauthenticated browser requests redirect to https://qubiteapp.ru
```

## Independence From The Website

The proxy process must not be managed by PM2. It should be a separate systemd
service:

```text
pm2 qubiteapp        website/API process
caddy-naive.service proxy frontend and TLS process
nginx.service       internal website reverse proxy
```

If the website is disabled with PM2, existing proxy credentials keep working
until the Caddy credential file is reloaded or the credentials expire. New
logins and refreshes require the Qubite API to be online.

Maintenance mode should not block `/api/proxy/sync/credentials`, because the
local sync agent needs this endpoint even when the public website is closed.

## Credential Model

Credentials are not long-lived login/password pairs.

```text
user account -> registered device -> proxy session -> short-lived credential
```

Each app device gets a stable `deviceId` and sends a non-secret fingerprint.
Qubite stores only a hash of the fingerprint. A proxy session revokes previous
active sessions for the same device, so sharing one credential creates churn and
is easy to detect later.

The Caddy/NaiveProxy integration cannot call Qubite API for every CONNECT
request. For that reason Qubite stores active proxy passwords encrypted with
`PROXY_CREDENTIAL_ENCRYPTION_KEY`. A local sync agent uses `PROXY_SYNC_TOKEN` to
fetch active credentials and regenerate the Caddy `basic_auth` snippet.

Owner can disable NaiveProxy at runtime with
`system_settings.proxy_naive_enabled=false` from the web admin panel or
Telegram bot. In that mode Qubite stops issuing Naive sessions, hides Naive
servers from `/api/proxy/servers` and `normal` catalog entries, omits Naive
links from subscription output, and returns an empty `credentials` list to the
sync endpoint. VLESS Reality users and SNI routes are still returned.

Required production secrets:

```env
PROXY_PUBLIC_DOMAIN=proxy.qubiteapp.online
PROXY_CREDENTIAL_ENCRYPTION_KEY=<random 32+ byte secret>
PROXY_SYNC_TOKEN=<random 32+ byte secret>
```

## Split Tunneling

The client app is responsible for split tunneling. Qubite exposes a routing
profile that marks Russian TLDs, selected sensitive Russian services, and local
network CIDRs as `direct`.

Server-side blocking can be added later as defense in depth, but the client must
make the first routing decision before traffic enters the proxy.

## Logs And Privacy

Traffic telemetry is app-reported and domain-level:

```text
user -> device -> session -> server -> destination host -> bytes/request count
```

Qubite does not MITM HTTPS traffic and should not receive full URLs, request
bodies, headers, cookies, or query strings. Owner analytics use only host,
request count, bytes up/down, device, user, server, and timestamps.

Owner can enable `proxy_no_logs` for a user. When enabled, the backend skips new
proxy traffic logs and proxy user events for that user. Server-level heartbeat
metrics still exist because they are not tied to the protected user's browsing.

## Multi-Server Deployment

Every proxy node is represented by `proxy_servers`. The app should always call
`GET /api/proxy/servers` and use the returned priority/weight/health fields
instead of hardcoding one host.

If NaiveProxy is disabled by `proxy_naive_enabled`, `GET /api/proxy/servers`
returns no servers by design; VLESS-capable clients should read the catalog or
subscription instead.

For a new VPS, the target "fast deploy" flow is:

```bash
git clone <repo>
cd qubiteapp
sudo ./deploy/proxy/setup-proxy-node.sh
```

First add the new domain in the owner-only "Прокси" panel. It returns a
one-time node token. Paste that token into `setup-proxy-node.sh`; the child node
will then use the master API for credentials and heartbeat telemetry.

The master server uses a different script:

```bash
git clone <repo>
cd qubiteapp
sudo ./deploy/proxy/setup-master-server.sh
```

It installs the website runtime, internal Nginx, Caddy/NaiveProxy, and the local
credential sync timer.
