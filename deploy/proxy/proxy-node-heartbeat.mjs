#!/usr/bin/env node

import http from "node:http";
import https from "node:https";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const heartbeatUrl =
  process.env.QUBITE_PROXY_HEARTBEAT_URL ||
  "http://127.0.0.1:3000/api/proxy/node/heartbeat";
const nodeToken = process.env.PROXY_NODE_TOKEN || process.env.PROXY_SYNC_TOKEN || "";
const realityPublicKey = process.env.REALITY_PUBLIC_KEY || "";
const realityShortId = process.env.REALITY_SHORT_ID || "";
const realityTargetSni = process.env.REALITY_TARGET_SNI || "www.microsoft.com";

if (!nodeToken) {
  console.error("PROXY_NODE_TOKEN is required.");
  process.exit(1);
}

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
        timeout: 5000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Heartbeat failed: ${response.statusCode} ${responseBody}`));
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

function readDiskUsedPercent() {
  try {
    const output = execFileSync("df", ["-P", "/"], { encoding: "utf8" });
    const line = output.trim().split("\n")[1] || "";
    const percent = line.split(/\s+/)[4] || "0%";
    return Number(percent.replace("%", "")) || 0;
  } catch (error) {
    return 0;
  }
}

function isCaddyActive() {
  try {
    execFileSync("systemctl", ["is-active", "--quiet", "caddy-naive.service"]);
    return true;
  } catch (error) {
    return false;
  }
}

function readActiveConnections() {
  try {
    const data = fs.readFileSync("/proc/net/tcp", "utf8");
    return Math.max(data.trim().split("\n").length - 1, 0);
  } catch (error) {
    return 0;
  }
}

await postJson(heartbeatUrl, {
  health: isCaddyActive() ? "online" : "degraded",
  activeConnections: readActiveConnections(),
  cpuLoad: os.loadavg()[0] || 0,
  memoryUsedMb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
  memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
  diskUsedPercent: readDiskUsedPercent(),
  uptimeSeconds: Math.round(os.uptime()),
  caddyActive: isCaddyActive(),
  reality: realityPublicKey && realityShortId
    ? {
        publicKey: realityPublicKey,
        shortId: realityShortId,
        targetSni: realityTargetSni,
      }
    : undefined,
});
