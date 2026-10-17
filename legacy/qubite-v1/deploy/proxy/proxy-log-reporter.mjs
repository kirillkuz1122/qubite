#!/usr/bin/env node

// Tails Caddy JSON access log, extracts CONNECT proxy events,
// and reports them to the master Qubite API as server-side traffic logs.
//
// Systemd runs this as a long-running service.
// Environment variables:
//   CADDY_ACCESS_LOG    - path to the Caddy JSON access log
//   QUBITE_TRAFFIC_URL  - master API endpoint for node traffic
//   PROXY_NODE_TOKEN    - node auth token
//   REPORT_INTERVAL_MS  - how often to flush batch (default 10000)

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import readline from "node:readline";

const logPath = process.env.CADDY_ACCESS_LOG || "/var/log/caddy/proxy-access.log";
const trafficUrl =
  process.env.QUBITE_TRAFFIC_URL || "http://127.0.0.1:3000/api/proxy/node/traffic";
const nodeToken = process.env.PROXY_NODE_TOKEN || process.env.PROXY_SYNC_TOKEN || "";
const reportIntervalMs = Number(process.env.REPORT_INTERVAL_MS || 10000);

if (!nodeToken) {
  console.error("PROXY_NODE_TOKEN is required.");
  process.exit(1);
}

// --- Pending events buffer ---

const pendingEvents = new Map(); // key: "username:host" -> aggregated event

function addEvent(username, host, port, bytesUp, bytesDown) {
  const key = `${username}:${host}`;
  const existing = pendingEvents.get(key);
  if (existing) {
    existing.requestCount += 1;
    existing.bytesUp += bytesUp;
    existing.bytesDown += bytesDown;
  } else {
    pendingEvents.set(key, {
      username,
      destinationHost: host,
      destinationPort: port,
      requestCount: 1,
      bytesUp,
      bytesDown,
    });
  }
}

// --- Log line parser ---

function parseLogLine(line) {
  try {
    const entry = JSON.parse(line);
    // Caddy JSON log fields: request.method, request.host, request.uri,
    // request.headers, resp_headers, status, size, duration
    const method = entry.request?.method || "";
    if (method !== "CONNECT") return null;

    const uri = entry.request?.uri || entry.request?.host || "";
    const [host, portStr] = uri.split(":");
    if (!host) return null;
    const port = Number(portStr || 443);

    // Extract proxy username from request headers (Proxy-Authorization)
    let username = "";
    const proxyAuth = entry.request?.headers?.["Proxy-Authorization"]?.[0]
      || entry.request?.headers?.["proxy-authorization"]?.[0]
      || "";
    if (proxyAuth.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(proxyAuth.slice(6), "base64").toString("utf8");
        username = decoded.split(":")[0] || "";
      } catch (_) {}
    }

    // Some Caddy builds log the user in a different field
    if (!username) {
      username = entry.user_id || entry.request?.headers?.["X-Forwarded-User"]?.[0] || "";
    }

    if (!username) return null;

    const bytesUp = Number(entry.request?.body_size || 0);
    const bytesDown = Number(entry.size || entry.resp_headers?.["Content-Length"]?.[0] || 0);

    return { username, host, port, bytesUp, bytesDown };
  } catch (_) {
    return null;
  }
}

// --- HTTP reporter ---

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nodeToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { responseBody += chunk; });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Report failed: ${response.statusCode} ${responseBody}`));
            return;
          }
          resolve(responseBody);
        });
      },
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function flushEvents() {
  if (pendingEvents.size === 0) return;
  const events = Array.from(pendingEvents.values());
  pendingEvents.clear();
  try {
    const result = await postJson(trafficUrl, { events });
    console.log(`Reported ${events.length} events: ${result}`);
  } catch (error) {
    console.error(`Failed to report events: ${error.message}`);
    // Re-add events on failure for next attempt
    for (const event of events) {
      addEvent(event.username, event.destinationHost, event.destinationPort, event.bytesUp, event.bytesDown);
    }
  }
}

// --- Log tailing ---

let currentSize = 0;

function tailLog() {
  if (!fs.existsSync(logPath)) {
    console.log(`Waiting for log file: ${logPath}`);
    setTimeout(tailLog, 5000);
    return;
  }

  const stat = fs.statSync(logPath);
  currentSize = stat.size;

  const stream = fs.createReadStream(logPath, {
    start: currentSize,
    encoding: "utf8",
  });

  const watcher = fs.watch(logPath, (eventType) => {
    if (eventType === "rename") {
      // Log was rotated
      watcher.close();
      stream.destroy();
      currentSize = 0;
      setTimeout(tailLog, 1000);
    }
  });

  // Use watchFile for size changes
  const checkInterval = setInterval(() => {
    try {
      const newStat = fs.statSync(logPath);
      if (newStat.size < currentSize) {
        // File was truncated/rotated
        clearInterval(checkInterval);
        watcher.close();
        stream.destroy();
        currentSize = 0;
        setTimeout(tailLog, 1000);
      }
    } catch (_) {
      // File might be gone during rotation
    }
  }, 2000);

  // Process new lines
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const event = parseLogLine(line);
    if (event) {
      addEvent(event.username, event.host, event.port, event.bytesUp, event.bytesDown);
    }
  });

  // Continuously read new data
  const readNewData = () => {
    try {
      const newStat = fs.statSync(logPath);
      if (newStat.size > currentSize) {
        const newStream = fs.createReadStream(logPath, {
          start: currentSize,
          encoding: "utf8",
        });
        const newRl = readline.createInterface({ input: newStream, crlfDelay: Infinity });
        newRl.on("line", (line) => {
          const event = parseLogLine(line);
          if (event) {
            addEvent(event.username, event.host, event.port, event.bytesUp, event.bytesDown);
          }
        });
        newRl.on("close", () => {
          currentSize = newStat.size;
        });
      }
    } catch (_) {}
  };

  setInterval(readNewData, 3000);
}

// --- Main ---

console.log(`Proxy log reporter started.`);
console.log(`  Log: ${logPath}`);
console.log(`  API: ${trafficUrl}`);
console.log(`  Interval: ${reportIntervalMs}ms`);

tailLog();
setInterval(flushEvents, reportIntervalMs);

// Flush on exit
process.on("SIGTERM", async () => {
  await flushEvents();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await flushEvents();
  process.exit(0);
});
