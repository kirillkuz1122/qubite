# Qubite Proxy App API

This document is the contract for the desktop/mobile client app.

All endpoints use the normal Qubite web session cookie. The app logs in through
the existing auth API first, then calls the proxy API.

## 1. Register Device

```http
POST /api/proxy/devices/register
Content-Type: application/json
```

```json
{
  "deviceId": "stable-device-id-generated-by-app",
  "deviceName": "Kirill Laptop",
  "platform": "windows",
  "appVersion": "0.1.0",
  "fingerprint": "non-secret stable fingerprint",
  "publicKey": "optional-device-public-key"
}
```

Response:

```json
{
  "device": {
    "id": "PD-...",
    "name": "Kirill Laptop",
    "platform": "windows",
    "appVersion": "0.1.0",
    "status": "active",
    "lastSeenAt": "...",
    "createdAt": "...",
    "updatedAt": "...",
    "revokedAt": null
  }
}
```

The app should persist the returned `device.id` and use it as `deviceId` for
future calls.

## 2. List Servers

```http
GET /api/proxy/servers
```

```json
{
  "servers": [
    {
      "id": "PS-...",
      "name": "Qubite Proxy",
      "domain": "proxy.qubiteapp.online",
      "url": "https://proxy.qubiteapp.online",
      "region": "eu-test",
      "priority": 10,
      "weight": 100,
      "health": "unknown",
      "updatedAt": "..."
    }
  ]
}
```

Client selection rule:

```text
1. Prefer lower priority.
2. Within the same priority, choose by weight.
3. If a server fails, try the next server and send heartbeat telemetry.
```

## 3. Start Proxy Session

```http
POST /api/proxy/session/start
Content-Type: application/json
```

```json
{
  "deviceId": "PD-...",
  "serverId": "PS-..."
}
```

Response:

```json
{
  "session": {
    "id": "PXS-...",
    "server": {
      "domain": "proxy.qubiteapp.online",
      "url": "https://proxy.qubiteapp.online",
      "region": "eu-test"
    },
    "credential": {
      "type": "basic",
      "username": "qb_1_...",
      "password": "short-lived-secret",
      "expiresAt": "...",
      "refreshAfter": "..."
    },
    "transport": {
      "protocol": "naive",
      "port": 443,
      "host": "proxy.qubiteapp.online"
    }
  },
  "routingProfile": {
    "version": 1,
    "defaultAction": "proxy",
    "rules": []
  }
}
```

The app must not display the raw proxy password to the user.

## 4. Refresh Session

```http
POST /api/proxy/session/refresh
Content-Type: application/json
```

```json
{
  "sessionId": "PXS-..."
}
```

Refresh before `credential.refreshAfter`. The old secret is replaced by a new
secret and should be discarded immediately.

## 5. Stop Session

```http
POST /api/proxy/session/stop
Content-Type: application/json
```

```json
{
  "sessionId": "PXS-..."
}
```

## 6. Routing Profile

```http
GET /api/proxy/routing-profile
```

The app should apply `direct` rules before proxying. Local networks and Russian
domains are direct by default.

## 7. Heartbeat

```http
POST /api/proxy/events/heartbeat
Content-Type: application/json
```

```json
{
  "deviceId": "PD-...",
  "active": true,
  "appVersion": "0.1.0"
}
```

Send this periodically while the app is running. It gives the backend enough
signal to revoke stale devices later.

## 8. Traffic Telemetry

```http
POST /api/proxy/events/traffic
Content-Type: application/json
```

```json
{
  "deviceId": "PD-...",
  "sessionId": "PXS-...",
  "appVersion": "0.1.0",
  "events": [
    {
      "destinationHost": "example.com",
      "destinationPort": 443,
      "action": "proxy",
      "transport": "https",
      "requestCount": 12,
      "bytesUp": 12000,
      "bytesDown": 86000
    }
  ]
}
```

The app must send host/domain-level telemetry only. Do not send full HTTPS URLs,
query strings, request bodies, headers, or payload content.

If owner enabled no-log mode for the user, the API returns:

```json
{
  "saved": false,
  "privacy": "no_logs"
}
```

In that mode Qubite does not store proxy traffic logs or proxy user events.
