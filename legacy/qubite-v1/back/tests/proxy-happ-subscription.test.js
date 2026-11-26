const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "qubite-happ-"));
process.env.DATABASE_PATH = path.join(stateDir, "subscriptions.sqlite");
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

const db = require("../src/db");
const { hashOpaqueToken } = require("../src/security");
const { registerProxyRoutes } = require("../src/proxy/routes");

test("subscription activates Happ tunnel routing and preserves VLESS delivery formats", async () => {
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
    await db.upsertProxyServer({
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

    let subscriptionHandler;
    registerProxyRoutes({
        get(route, ...handlers) {
            if (route === "/api/proxy/subscription/:token") subscriptionHandler = handlers.at(-1);
        },
        use() {},
        post() {},
        patch() {},
        delete() {},
    }, { cleanText: String, hashOpaqueToken });

    async function request(format, requestedToken = token) {
        const headers = new Map();
        let status = 200;
        let body;
        const res = {
            setHeader(name, value) { headers.set(name.toLowerCase(), value); },
            status(code) { status = code; return this; },
            type() { return this; },
            send(text) { body = text; },
        };
        await subscriptionHandler({ params: { token: requestedToken }, query: { format } }, res, (error) => {
            throw error;
        });
        return { headers, status, body };
    }

    const plain = await request("");
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

    const encoded = await request("base64");
    assert.equal(encoded.headers.get("routing"), routing);
    assert.equal(Buffer.from(encoded.body, "base64").toString("utf8"), plain.body);

    const rejected = await request("", "unknown-test-token");
    assert.equal(rejected.status, 404);
    assert.equal(rejected.headers.has("routing"), false);
});
