const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "qubite-happ-"));
process.env.DATABASE_PATH = path.join(stateDir, "subscriptions.sqlite");
process.env.PROXY_CREDENTIAL_ENCRYPTION_KEY = "happ-test-credential-key";
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

const db = require("../src/db");
const { hashOpaqueToken } = require("../src/security");
const { registerProxyRoutes } = require("../src/proxy/routes");

test("Happ subscription shares VLESS and provisioned Hysteria 2 with tunnel DNS", async () => {
    await db.initializeDatabase({ seedDemoData: false });
    await db.updateSystemSetting("proxy_naive_enabled", false);
    const user = await db.createUser({
        uid: "U-TEST-VPN",
        login: "happ-test",
        loginNormalized: "happ-test",
        email: "happ@example.test",
        emailNormalized: "happ@example.test",
        passwordHash: "test",
        passwordSalt: "test",
    });
    const token = "fixture-subscription-token";
    await db.createProxySubscription({ userId: user.id, tokenHash: hashOpaqueToken(token) });
    const nodeToken = "fixture-vpn-node-token";
    const server = await db.upsertProxyServer({
        name: "Qubite US",
        publicDomain: "vpn.example.test",
        ipv4Address: "192.0.2.10",
        ipv6Address: "2001:db8::10",
        supportsIpv4: true,
        supportsIpv6: true,
        metadata: { reality: {
            publicKey: "fixture-key",
            shortId: "01234567",
            targetSni: "tls.example.test",
            defaultProfile: true,
            port: 24443,
        } },
    });
    await db.setProxyServerNodeToken(server.uid, hashOpaqueToken(nodeToken));

    let subscriptionHandler;
    let syncHandler;
    let heartbeatHandler;
    registerProxyRoutes({
        get(route, ...handlers) {
            if (route === "/api/proxy/subscription/:token") subscriptionHandler = handlers.at(-1);
            if (route === "/api/proxy/sync/credentials") syncHandler = handlers.at(-1);
        },
        post(route, ...handlers) {
            if (route === "/api/proxy/node/heartbeat") heartbeatHandler = handlers.at(-1);
        },
        use() {},
        patch() {},
        delete() {},
    }, {
        cleanText: (value) => String(value ?? ""),
        hashOpaqueToken,
        sendError: (res, status, message) => res.status(status).json({ message }),
    });

    async function request(handler, req) {
        const headers = new Map();
        let status = 200;
        let body;
        const res = {
            setHeader(name, value) { headers.set(name.toLowerCase(), value); },
            status(code) { status = code; return this; },
            type() { return this; },
            send(text) { body = text; },
            json(value) { body = value; },
        };
        await handler(req, res, (error) => {
            throw error;
        });
        return { headers, status, body };
    }
    const subscription = (format = "", requestedToken = token) => request(subscriptionHandler, {
        params: { token: requestedToken }, query: { format },
    });
    const headers = { authorization: `Bearer ${nodeToken}` };
    const sync = (query, authHeaders = headers) => request(syncHandler, { headers: authHeaders, query });
    const heartbeat = (hysteria2) => request(heartbeatHandler, { headers, body: { hysteria2 } });

    const plain = await subscription();
    assert.equal(plain.headers.get("profile-title"), "Qubite VPN");
    assert.equal(plain.headers.get("profile-update-interval"), "12");
    assert.equal(plain.headers.get("cache-control"), "no-store");
    const routing = plain.headers.get("routing");
    const prefix = "happ://routing/onadd/";
    assert(routing.startsWith(prefix));
    const profile = JSON.parse(Buffer.from(routing.slice(prefix.length), "base64").toString("utf8"));
    assert.equal(profile.GlobalProxy, "true");
    assert.equal(profile.RemoteDNSType, "DoH");
    assert.equal(profile.RemoteDNSDomain, "https://1.1.1.1/dns-query");
    assert(profile.ProxyIp.includes("1.1.1.1/32"));
    assert.deepEqual(profile.DirectSites, []);
    assert.deepEqual(profile.DirectIp, []);
    const profiles = plain.body.trim().split("\n").map((uri) => new URL(uri));
    assert.deepEqual(profiles.map((profile) => profile.hostname), ["vpn.example.test", "192.0.2.10", "[2001:db8::10]"]);
    assert(profiles.every((profile) => profile.protocol === "vless:" && profile.port === "24443"));

    const denied = await sync({ hysteria2: "1" }, {});
    assert.equal(denied.status, 401);
    assert.equal((await sync({})).body.hysteria2Users, undefined);
    const credential = (await sync({ hysteria2: "1" })).body.hysteria2Users[0].password;
    assert.match(credential, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await heartbeat({ port: 65536 })).status, 400);
    assert.equal((await heartbeat({ port: 24443 })).body.ok, true);

    const enabled = await subscription();
    assert(enabled.body.startsWith(plain.body));
    const hysteria2 = new URL(enabled.body.slice(plain.body.length).trim());
    assert.equal(hysteria2.protocol, "hy2:");
    assert.equal(hysteria2.hostname, "vpn.example.test");
    assert.equal(hysteria2.port, "24443");
    assert.equal(hysteria2.hash, "#qubite-us-hy2");
    assert.equal(hysteria2.username, credential);
    assert.equal(hysteria2.searchParams.has("insecure"), false);

    const encoded = await subscription("base64");
    assert.equal(encoded.headers.get("routing"), routing);
    assert.equal(Buffer.from(encoded.body, "base64").toString("utf8"), enabled.body);

    assert.equal((await heartbeat(null)).body.ok, true);
    assert.equal((await subscription()).body, plain.body);

    const rejected = await subscription("", "unknown-test-token");
    assert.equal(rejected.status, 404);
    assert.equal(rejected.headers.has("routing"), false);
});
