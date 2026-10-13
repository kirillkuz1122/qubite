const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');

// Copy only sources before config.js can auto-load private root/back .env files.
// Running this file directly is safe too; no dependency on the outer harness isolation.
async function startFixture(options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qubite-auth-baseline-'));
    const source = path.resolve(__dirname, '../..');
    const code = path.join(directory, 'code', 'legacy', 'qubite-v1');
    fs.mkdirSync(path.join(code, 'back'), { recursive: true });
    fs.copyFileSync(path.join(source, 'back/server.js'), path.join(code, 'back/server.js'));
    const sourceFilter = filename => {
        const stat = fs.lstatSync(filename);
        if (stat.isSymbolicLink()) return false;
        return stat.isDirectory() || (!path.basename(filename).includes('.env') &&
            ['.js', '.cjs', '.json', '.html', '.css', '.svg', '.txt'].includes(path.extname(filename)));
    };
    for (const folder of ['back/src', 'back/public', 'front']) {
        fs.cpSync(path.join(source, folder), path.join(code, folder), { recursive: true, filter: sourceFilter });
    }
    for (const file of fs.readdirSync(source).filter(name => name.endsWith('.html'))) {
        fs.copyFileSync(path.join(source, file), path.join(code, file));
    }
    fs.symlinkSync(path.join(source, 'back/node_modules'), path.join(code, 'back/node_modules'), 'dir');
    const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'NODE_OPTIONS'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, {
        HOME: directory, DATABASE_PATH: path.join(directory, 'state.sqlite'),
        QUBITE_AUTH_FIXTURE_ROOT: directory, QUBITE_PROCESS_ROLE: 'auth',
        NODE_ENV: 'production', HOST: '127.0.0.1', AUTH_PORT: '0', APP_BASE_URL: 'https://auth.test',
        SEED_DEMO_DATA: 'false', TELEGRAM_ENABLED: 'false', EMAIL_DELIVERY_MODE: 'disabled',
        TURNSTILE_DEV_BYPASS: 'false', TURNSTILE_SITE_KEY: 'fixture-site', TURNSTILE_SECRET_KEY: 'fixture-secret',
        OAUTH_GOOGLE_ENABLED: 'true', GOOGLE_CLIENT_ID: 'fixture-google-client', GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
        OAUTH_YANDEX_ENABLED: 'true', YANDEX_CLIENT_ID: 'fixture-yandex-client', YANDEX_CLIENT_SECRET: 'fixture-yandex-secret',
        OAUTH_VK_ENABLED: 'true', VK_APP_ID: 'fixture-vk-client', VK_CLIENT_SECRET: 'fixture-vk-secret',
        OAUTH_TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '123456:fixture-only-bot-token',
        INITIAL_OWNER_EMAIL: 'owner@example.test',
    }, options);
    const child = fork(path.join(code, 'back/server.js'), [], {
        cwd: code, env, execArgv: ['--require', path.join(__dirname, 'fixtures/auth-server.cjs')],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    // Drain logs without printing OTPs or synthetic OAuth data in TAP output.
    child.stdout.resume(); child.stderr.resume();
    const pending = new Map();
    let sequence = 0;
    let requestSequence = 0;
    let startupTimer;
    const ready = new Promise((resolve, reject) => {
        startupTimer = setTimeout(() => reject(new Error('Auth server startup timed out')), 15000);
        child.once('exit', () => reject(new Error('Auth server exited before ready')));
        child.on('message', msg => {
            if (msg.kind === 'ready') resolve(msg.port);
            const waiter = pending.get(msg.id);
            if (waiter) {
                clearTimeout(waiter.timer); pending.delete(msg.id);
                msg.error ? waiter.reject(new Error(msg.error)) : waiter.resolve(msg.result);
            }
        });
    });
    async function stop() {
        clearTimeout(startupTimer);
        for (const waiter of pending.values()) {
            clearTimeout(waiter.timer); waiter.reject(new Error('Fixture stopped'));
        }
        pending.clear();
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
    let port;
    try { port = await ready; clearTimeout(startupTimer); } catch (error) { await stop(); throw error; }
    function rpc(kind, data = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('Fixture RPC timed out')); }, 5000);
            pending.set(id, { resolve, reject, timer }); child.send({ id, kind, ...data });
        });
    }
    async function request(route, { method = 'GET', body, cookie, headers = {} } = {}) {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        return new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: route, method,
                headers: { host: 'auth.test', origin: 'https://auth.test', 'user-agent': `fixture-device-${++requestSequence}`,
                    ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers },
            }, res => {
                let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
                res.on('end', () => {
                    let json; try { json = JSON.parse(text); } catch {}
                    resolve({ status: res.statusCode, headers: res.headers, json, text,
                        cookie: res.headers['set-cookie']?.find(c => c.startsWith('qb_session='))?.split(';')[0] });
                });
            });
            req.setTimeout(8000, () => req.destroy(new Error('Fixture HTTP timed out')));
            req.on('error', reject); req.end(payload);
        });
    }
    return { directory, request, stop, tournamentWorkspace: () => rpc('tournamentWorkspace'),
        sql: (sql, params) => rpc('sql', { sql, params }),
        state: patch => rpc('state', { patch }) };
}
const captcha = { turnstileToken: 'fixture-captcha' };
const password = 'FixturePass123';
let fixture;
test.beforeEach(async () => { fixture = await startFixture(); });
test.afterEach(async () => { await fixture?.stop(); fixture = null; });
async function register(login = 'fixtureuser', email = `${login}@example.test`) {
    const response = await fixture.request('/api/auth/register', { method: 'POST', body: { login, email, password, ...captcha } });
    assert.equal(response.status, 201, response.text); return response;
}
async function login(identifier, value = password) {
    return fixture.request('/api/auth/login', { method: 'POST', body: { login: identifier, password: value, ...captcha } });
}
test('same device password login replaces its previous session while another device stays authenticated', async () => {
    const otherDevice = await register();
    const signIn = () => fixture.request('/api/auth/login', { method: 'POST',
        headers: { 'user-agent': 'fixed-fixture-device' }, body: { login: 'fixtureuser', password, ...captcha } });
    const first = await signIn(); const second = await signIn();
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal((await fixture.request('/api/auth/me', { cookie: first.cookie })).json.authenticated, false);
    assert.equal((await fixture.request('/api/auth/me', { cookie: second.cookie })).json.authenticated, true);
    assert.equal((await fixture.request('/api/auth/me', { cookie: otherDevice.cookie })).json.authenticated, true);
});
async function codeFor(email) {
    const state = await fixture.state();
    const mail = state.mails.filter(m => m.to === email).at(-1);
    assert.ok(mail, 'Mock delivery captured'); return mail.text.match(/Код: (\d{8})/)[1];
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const oauthError = res => new URL(res.headers.location, 'https://auth.test').searchParams.get('oauthError');

// AUTH-005 boundary: these are module invitations, not a new platform login.
async function codeTournament(mode = 'shared') {
    await fixture.tournamentWorkspace();
    const now = new Date().toISOString();
    const start = new Date(Date.now() + 86400000).toISOString();
    const end = new Date(Date.now() + 172800000).toISOString();
    await fixture.sql(`INSERT INTO tournaments
        (slug,title,description,status,time_label,icon,action_label,action_type,category,start_at,end_at,
         access_scope,access_code,code_mode,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ['fixture-code-' + mode, 'Fixture invitation', 'Synthetic tournament', 'published', 'Soon', 'flag',
            'Join', 'join', 'other', start, end, 'code', mode === 'shared' ? 'SHARED42' : null, mode, now, now]);
    return (await fixture.sql('SELECT id FROM tournaments WHERE slug=?', ['fixture-code-' + mode]))[0].id;
}
async function tournamentAccount(name, verified = true) {
    const account = await register(name);
    if (verified) await fixture.sql('UPDATE users SET email_verified_at=? WHERE id=?',
        [new Date().toISOString(), account.json.user.id]);
    return account;
}
async function tournamentIdentitySnapshot() {
    return {
        users: await fixture.sql('SELECT id,role,email_verified_at FROM users ORDER BY id'),
        sessions: await fixture.sql('SELECT id,user_id FROM sessions ORDER BY id'),
    };
}

test('AUTH-005 shared tournament invitation requires the right code and preserves the authenticated account', async () => {
    const account = await tournamentAccount('sharedparticipant');
    const id = await codeTournament();
    const before = await tournamentIdentitySnapshot();
    const join = accessCode => fixture.request(`/api/tournaments/${id}/join`,
        { method: 'POST', cookie: account.cookie, body: { accessCode } });
    for (const code of ['', 'WRONG42']) {
        assert.equal((await join(code)).status, 403);
        assert.equal((await fixture.sql('SELECT count(*) AS n FROM tournament_entries'))[0].n, 0);
    }
    const response = await join('shared-42');
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.success, true);
    assert.equal(response.cookie, undefined);
    assert.deepEqual(await tournamentIdentitySnapshot(), before);
    assert.deepEqual((await fixture.sql('SELECT user_id FROM tournament_entries')), [{ user_id: account.json.user.id }]);
});

test('AUTH-005 personal tournament invitation remains bound to its roster participant', async () => {
    const account = await tournamentAccount('rosterparticipant');
    const stranger = await tournamentAccount('rosterstranger');
    const id = await codeTournament('personal');
    const now = new Date().toISOString();
    await fixture.sql(`INSERT INTO tournament_roster_entries
        (tournament_id,user_id,login,email,invite_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
        [id, account.json.user.id, 'rosterparticipant', 'rosterparticipant@example.test', 'PERSONAL42', now, now]);
    const before = await tournamentIdentitySnapshot();
    const join = (cookie, accessCode) => fixture.request(`/api/tournaments/${id}/join`,
        { method: 'POST', cookie, body: { accessCode } });
    assert.equal((await join(account.cookie, 'WRONG42')).status, 403);
    assert.equal((await join(stranger.cookie, 'PERSONAL42')).status, 403);
    assert.equal((await fixture.sql('SELECT count(*) AS n FROM tournament_entries'))[0].n, 0);
    const response = await join(account.cookie, 'personal-42');
    assert.equal(response.status, 200, response.text);
    assert.equal(response.cookie, undefined);
    assert.deepEqual(await tournamentIdentitySnapshot(), before);
    assert.deepEqual((await fixture.sql('SELECT user_id FROM tournament_entries')), [{ user_id: account.json.user.id }]);
});

test('AUTH-005 tournament code alone does not replace authentication or email verification at module join', async () => {
    const account = await tournamentAccount('unverifiedparticipant', false);
    const id = await codeTournament();
    const before = await tournamentIdentitySnapshot();
    for (const [cookie, status] of [[undefined, 401], [account.cookie, 403]]) {
        const response = await fixture.request(`/api/tournaments/${id}/join`,
            { method: 'POST', cookie, body: { accessCode: 'SHARED42' } });
        assert.equal(response.status, status, response.text);
        assert.equal(response.cookie, undefined);
    }
    assert.deepEqual(await tournamentIdentitySnapshot(), before);
    assert.equal((await fixture.sql('SELECT count(*) AS n FROM tournament_entries'))[0].n, 0);
});

test('register/login use real SQLite and password hashes, secure cookie and email verification', async () => {
    const registration = await register();
    assert.equal(registration.json.user.role, 'user');
    assert.equal(registration.json.emailVerificationRequired, true);
    const header = registration.headers['set-cookie'][0];
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(header.includes(flag), flag);
    const user = (await fixture.sql('SELECT * FROM users WHERE id = ?', [registration.json.user.id]))[0];
    assert.notEqual(user.password_hash, password); assert.ok(user.password_salt);
    assert.equal(registration.json.user.password_hash, undefined);
    const token = registration.cookie.split('=')[1];
    assert.equal((await fixture.sql('SELECT token_hash FROM sessions WHERE user_id = ?', [user.id]))[0].token_hash, digest(token));
    const code = await codeFor('fixtureuser@example.test');
    const verified = await fixture.request('/api/auth/email/verification/verify', {
        method: 'POST', cookie: registration.cookie, body: { flowToken: registration.json.authChallenge.flowToken, code },
    });
    assert.equal(verified.status, 200);
    assert.ok((await fixture.sql('SELECT email_verified_at FROM users WHERE id = ?', [user.id]))[0].email_verified_at);
    assert.equal((await login('FIXTUREUSER')).status, 200);
    assert.equal((await login('FIXTUREUSER@EXAMPLE.TEST')).status, 200);
    const me = await fixture.request('/api/auth/me', { cookie: registration.cookie });
    assert.equal(me.json.authenticated, true); assert.equal(me.json.user.id, user.id);
});

test('register validates fields, normalized duplicates and ignores supplied privileged role', async () => {
    const first = await fixture.request('/api/auth/register', { method: 'POST', body: {
        login: 'alice', email: 'alice@example.test', password, role: 'owner', ...captcha,
    } });
    assert.equal(first.status, 201); assert.equal(first.json.user.role, 'user');
    assert.equal((await registerDuplicate('ALICE', 'other@example.test')).status, 409);
    assert.equal((await registerDuplicate('other', 'ALICE@EXAMPLE.TEST')).status, 409);
    for (const body of [
        { login: '!', email: 'invalid1@example.test', password },
        { login: 'invalid2', email: 'not-an-email', password },
        { login: 'invalid3', email: 'invalid3@example.test', password: 'weak' },
    ]) {
        assert.equal((await fixture.request('/api/auth/register', { method: 'POST', body: { ...body, ...captcha } })).status, 400);
    }
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM users'))[0].n, 1);
});
async function registerDuplicate(login, email) {
    return fixture.request('/api/auth/register', { method: 'POST', body: { login, email, password, ...captcha } });
}

test('real CAPTCHA middleware rejects missing/invalid transport tokens before account creation', async () => {
    for (const turnstileToken of ['', 'invalid-captcha']) {
        const res = await fixture.request('/api/auth/register', { method: 'POST', body: {
            login: 'captchauser', email: 'captcha@example.test', password, turnstileToken,
        } });
        assert.equal(res.status, 400); assert.equal(res.json.field, 'turnstileToken');
    }
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM users'))[0].n, 0);
    assert.equal((await fixture.state()).calls.length, 1, 'Missing token does not call CAPTCHA provider');
});

test('cookie same-origin guard rejects Host/Origin/Fetch-Site mismatch without creating sessions', async () => {
    for (const headers of [
        { host: 'foreign.test' }, { origin: 'https://foreign.test' }, { origin: 'invalid-url' },
        { origin: '', 'sec-fetch-site': 'cross-site' },
    ]) {
        const res = await fixture.request('/api/auth/login', { method: 'POST', headers,
            body: { login: 'guarduser', password, ...captcha } });
        assert.equal(res.status, 403); assert.equal(res.json.code, 'origin_mismatch'); assert.equal(res.cookie, undefined);
    }
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, 0);
    assert.equal((await fixture.state()).calls.length, 0);
});

test('logout revokes current token and clears cookie; logout-all keeps current but revokes other sessions', async () => {
    const registered = await register();
    const second = await login('fixtureuser');
    const third = await login('fixtureuser');
    assert.equal(second.status, 200); assert.equal(third.status, 200);
    const all = await fixture.request('/api/auth/logout-all', { method: 'POST', cookie: third.cookie, body: {} });
    assert.equal(all.status, 200);
    assert.equal((await fixture.request('/api/auth/me', { cookie: registered.cookie })).json.authenticated, false);
    assert.equal((await fixture.request('/api/auth/me', { cookie: second.cookie })).json.authenticated, false);
    assert.equal((await fixture.request('/api/auth/me', { cookie: third.cookie })).json.authenticated, true);
    const logout = await fixture.request('/api/auth/logout', { method: 'POST', cookie: third.cookie, body: {} });
    assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
    assert.equal((await fixture.request('/api/auth/me', { cookie: third.cookie })).json.authenticated, false);
    assert.equal((await fixture.request('/api/auth/logout-all', { method: 'POST', body: {}, cookie: third.cookie })).status, 401);
});

test('session deletion is owner-scoped, including rejection of another account session', async () => {
    const alice = await register('alice'); const bob = await register('bob');
    const aliceLogin = await login('alice');
    const bobSession = (await fixture.sql('SELECT id FROM sessions WHERE user_id = ?', [bob.json.user.id]))[0].id;
    assert.equal((await fixture.request(`/api/auth/sessions/${bobSession}`, { method: 'DELETE', cookie: alice.cookie })).status, 404);
    assert.equal((await fixture.request('/api/auth/me', { cookie: bob.cookie })).json.authenticated, true);
    const secondSession = (await fixture.sql('SELECT id FROM sessions WHERE token_hash = ?', [digest(aliceLogin.cookie.split('=')[1])]))[0].id;
    assert.equal((await fixture.request(`/api/auth/sessions/${secondSession}`, { method: 'DELETE', cookie: alice.cookie })).status, 200);
    assert.equal((await fixture.request('/api/auth/me', { cookie: aliceLogin.cookie })).json.authenticated, false);
    assert.equal((await fixture.request('/api/auth/sessions/NaN', { method: 'DELETE', cookie: alice.cookie })).status, 400);
});

test('expired session and blocked/deleted user cannot access protected APIs or create password sessions', async () => {
    const user = await register();
    await fixture.sql("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?", [user.json.user.id]);
    const expired = await fixture.request('/api/auth/me', { cookie: user.cookie });
    assert.equal(expired.json.authenticated, false); assert.ok(expired.headers['set-cookie']);
    assert.equal((await fixture.request('/api/auth/logout-all', { method: 'POST', body: {}, cookie: user.cookie })).status, 401);
    const active = await login('fixtureuser');
    for (const status of ['blocked', 'deleted']) {
        await fixture.sql('UPDATE users SET status = ? WHERE id = ?', [status, user.json.user.id]);
        const rejected = await login('fixtureuser'); assert.equal(rejected.status, 403); assert.equal(rejected.cookie, undefined);
        assert.equal((await fixture.request('/api/auth/me', { cookie: active.cookie })).json.authenticated, false);
    }
});

test('unknown/tampered cookies yield anonymous state and never trust supplied user/role headers', async () => {
    for (const cookie of ['qb_session=unknown', 'qb_session=', 'foreign=value']) {
        const me = await fixture.request('/api/auth/me', { cookie, headers: { 'x-qubite-user': '1', 'x-user-role': 'owner' } });
        assert.equal(me.status, 200); assert.equal(me.json.authenticated, false);
        assert.equal((await fixture.request('/api/auth/logout-all', { method: 'POST', body: {}, cookie })).status, 401);
    }
});

test('legacy defect: malformed percent-encoded cookie returns 500 rather than client error', async () => {
    const res = await fixture.request('/api/auth/me', { cookie: 'qb_session=%E0%A4%A' });
    assert.equal(res.status, 500); assert.equal(res.json.user, undefined);
    assert.equal((await fixture.request('/api/auth/me')).status, 200, 'Server survives malformed request');
});

test('incorrect credentials and repeated attempts are rate-limited by real auth guard', async () => {
    for (let i = 0; i < 5; i++) {
        const rejected = await login('unknown', 'WrongPass123');
        assert.equal(rejected.status, 401); assert.equal(rejected.cookie, undefined);
    }
    const limited = await login('unknown', 'WrongPass123');
    assert.equal(limited.status, 429); assert.equal(limited.json.code, 'rate_limited');
    assert.ok(Number(limited.headers['retry-after']) > 0);
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, 0);
});

test('password reset requires mail challenge, replaces password, revokes sessions and cannot replay', async () => {
    const registered = await register(); const oldLogin = await login('fixtureuser');
    const forgot = await fixture.request('/api/auth/password/forgot', { method: 'POST', body: { email: 'fixtureuser@example.test', ...captcha } });
    assert.equal(forgot.status, 200); assert.equal(forgot.json.devCode, undefined);
    const verified = await fixture.request('/api/auth/password/forgot/verify', { method: 'POST', body: {
        flowToken: forgot.json.flowToken, code: await codeFor('fixtureuser@example.test'),
    } });
    assert.equal(verified.status, 200); assert.ok(verified.json.resetToken);
    const reset = () => fixture.request('/api/auth/password/reset', { method: 'POST', body: {
        resetToken: verified.json.resetToken, newPassword: 'ReplacementPass456',
    } });
    assert.equal((await reset()).status, 200); assert.equal((await reset()).status, 400);
    assert.equal((await fixture.request('/api/auth/me', { cookie: registered.cookie })).json.authenticated, false);
    assert.equal((await fixture.request('/api/auth/me', { cookie: oldLogin.cookie })).json.authenticated, false);
    assert.equal((await login('fixtureuser')).status, 401);
    assert.equal((await login('fixtureuser', 'ReplacementPass456')).status, 200);
});

test('reset rejects wrong code, wrong purpose, expired challenge and forged/expired reset ticket', async () => {
    const registered = await register();
    const wrongPurpose = await fixture.request('/api/auth/password/forgot/verify', { method: 'POST', body: {
        flowToken: registered.json.authChallenge.flowToken, code: await codeFor('fixtureuser@example.test'),
    } });
    assert.equal(wrongPurpose.status, 400);
    const forgot = await fixture.request('/api/auth/password/forgot', { method: 'POST', body: { email: 'fixtureuser@example.test', ...captcha } });
    const actual = await codeFor('fixtureuser@example.test');
    const wrong = actual === '00000000' ? '11111111' : '00000000';
    assert.equal((await fixture.request('/api/auth/password/forgot/verify', { method: 'POST', body: { flowToken: forgot.json.flowToken, code: wrong } })).status, 400);
    await fixture.sql("UPDATE auth_challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE purpose = 'password_reset'");
    assert.equal((await fixture.request('/api/auth/password/forgot/verify', { method: 'POST', body: { flowToken: forgot.json.flowToken, code: actual } })).status, 400);
    for (const resetToken of ['forged-reset-token', 'expired-reset-token']) {
        if (resetToken.startsWith('expired')) await fixture.sql(
            "INSERT INTO password_reset_tickets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, '2000-01-01T00:00:00.000Z', datetime('now'))", [registered.json.user.id, digest(resetToken)]);
        assert.equal((await fixture.request('/api/auth/password/reset', { method: 'POST', body: { resetToken, newPassword: 'ReplacementPass456' } })).status, 400);
    }
    assert.equal((await login('fixtureuser')).status, 200);
});

test('unknown email reset uses generic response but cannot issue a reset ticket or session', async () => {
    const forgot = await fixture.request('/api/auth/password/forgot', { method: 'POST',
        body: { email: 'absent@example.test', ...captcha } });
    assert.equal(forgot.status, 200); assert.ok(forgot.json.flowToken); assert.equal(forgot.json.devCode, undefined);
    // Legacy deliberately creates/delivers a challenge even without an account.
    // Correct possession of that code still must not grant reset authority.
    const verified = await fixture.request('/api/auth/password/forgot/verify', { method: 'POST',
        body: { flowToken: forgot.json.flowToken, code: await codeFor('absent@example.test') } });
    assert.equal(verified.status, 400); assert.equal(verified.json.resetToken, undefined);
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM password_reset_tickets'))[0].n, 0);
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, 0);
});

test('email challenge is account-bound and owner bootstrap occurs only after its email verification', async () => {
    const owner = await register('owneruser', 'owner@example.test'); const other = await register('otheruser');
    assert.equal(owner.json.user.role, 'user');
    const body = { flowToken: owner.json.authChallenge.flowToken, code: await codeFor('owner@example.test') };
    assert.equal((await fixture.request('/api/auth/email/verification/verify', { method: 'POST', cookie: other.cookie, body })).status, 403);
    const verified = await fixture.request('/api/auth/email/verification/verify', { method: 'POST', cookie: owner.cookie, body });
    assert.equal(verified.status, 200); assert.equal(verified.json.user.role, 'owner');
    assert.equal((await fixture.request('/api/auth/email/verification/verify', { method: 'POST', cookie: owner.cookie, body })).status, 400);
    assert.equal((await fixture.sql("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'"))[0].n, 1);
});

test('email 2FA password login creates no session until verified and code cannot replay', async () => {
    const user = await register();
    await fixture.sql('UPDATE users SET email_2fa_enabled = 1 WHERE id = ?', [user.json.user.id]);
    const count = (await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n;
    const challenge = await login('fixtureuser');
    assert.equal(challenge.status, 200); assert.equal(challenge.json.requiresTwoFactor, true); assert.equal(challenge.cookie, undefined);
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, count);
    const body = { flowToken: challenge.json.flowToken, code: await codeFor('fixtureuser@example.test') };
    const verified = await fixture.request('/api/auth/2fa/login/verify', { method: 'POST', body });
    assert.equal(verified.status, 200); assert.ok(verified.cookie);
    assert.equal((await fixture.request('/api/auth/2fa/login/verify', { method: 'POST', body })).status, 400);
});

async function startOAuth(provider) {
    const res = await fixture.request(`/api/auth/oauth/${provider}/start`);
    assert.equal(res.status, 302, res.text);
    return { url: new URL(res.headers.location), state: new URL(res.headers.location).searchParams.get('state') };
}
async function finishOAuth(provider, state, extra = {}) {
    const query = new URLSearchParams({ code: 'fixture-authorization-code', state, ...extra });
    return fixture.request(`/api/auth/oauth/${provider}/callback?${query}`);
}

test('Google and Yandex real OAuth routes use mocked transport, persist subject and consume state', async () => {
    for (const provider of ['google', 'yandex']) {
        const started = await startOAuth(provider); assert.ok(started.state);
        const row = (await fixture.sql('SELECT * FROM oauth_states WHERE state_hash = ?', [digest(started.state)]))[0];
        assert.equal(row.provider, provider); assert.equal(row.state_hash, digest(started.state));
        const callback = await finishOAuth(provider, started.state);
        assert.equal(callback.status, 302); assert.equal(oauthError(callback), null); assert.ok(callback.cookie);
        assert.equal((await fixture.request('/api/auth/me', { cookie: callback.cookie })).json.authenticated, true);
        const calls = (await fixture.state()).calls.length;
        const replay = await finishOAuth(provider, started.state);
        assert.equal(oauthError(replay), 'invalid_state'); assert.equal(replay.cookie, undefined);
        assert.equal((await fixture.state()).calls.length, calls);
        assert.ok((await fixture.sql('SELECT consumed_at FROM oauth_states WHERE id = ?', [row.id]))[0].consumed_at);
    }
});

test('OAuth missing/wrong/expired/provider-mismatched state is denied before provider transport', async () => {
    const started = await startOAuth('google');
    assert.equal(oauthError(await fixture.request('/api/auth/oauth/google/callback?code=fixture')), 'missing_code_or_state');
    assert.equal(oauthError(await finishOAuth('google', 'forged-state')), 'invalid_state');
    assert.equal(oauthError(await finishOAuth('yandex', started.state)), 'invalid_state');
    await fixture.sql("UPDATE oauth_states SET expires_at = '2000-01-01T00:00:00.000Z'");
    assert.equal(oauthError(await finishOAuth('google', started.state)), 'invalid_state');
    assert.equal((await fixture.state()).calls.length, 0);
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, 0);
});

test('VK PKCE verifier stays server-side, matches S256 challenge and is supplied only on token exchange', async () => {
    const started = await startOAuth('vk');
    assert.equal(started.url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(started.url.searchParams.get('code_verifier'), null);
    const row = (await fixture.sql('SELECT * FROM oauth_states WHERE state_hash = ?', [digest(started.state)]))[0];
    assert.ok(row.code_verifier);
    assert.equal(started.url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(row.code_verifier).digest('base64url'));
    const callback = await finishOAuth('vk', started.state, { device_id: 'fixture-device' });
    assert.equal(callback.status, 302); assert.equal(oauthError(callback), null); assert.ok(callback.cookie);
    const tokenCall = (await fixture.state()).calls.find(c => c.url === 'https://id.vk.ru/oauth2/auth');
    assert.equal(tokenCall.body.code_verifier, row.code_verifier); assert.equal(tokenCall.body.device_id, 'fixture-device');
    assert.equal(tokenCall.body.state, started.state);
    assert.equal((await fixture.request('/api/auth/me', { cookie: callback.cookie })).json.authenticated, true);
});

test('VK missing device/verifier and revoked runtime provider cannot exchange code', async () => {
    const started = await startOAuth('vk');
    assert.equal(oauthError(await finishOAuth('vk', started.state)), 'vk_missing_params');
    await fixture.sql('UPDATE oauth_states SET code_verifier = NULL');
    assert.equal(oauthError(await finishOAuth('vk', started.state, { device_id: 'fixture-device' })), 'missing_code_verifier');
    const second = await startOAuth('vk');
    await fixture.sql("UPDATE system_settings SET value = 'false' WHERE key = 'oauth_vk_enabled'");
    assert.equal((await fixture.request('/api/auth/oauth/vk/start')).status, 503);
    assert.equal(oauthError(await finishOAuth('vk', second.state, { device_id: 'fixture-device' })), 'provider_disabled');
    assert.equal((await fixture.state()).calls.length, 0);
});

test('OAuth token transport failure consumes state without issuing session, retry is denied', async () => {
    const started = await startOAuth('google'); await fixture.state({ tokenFailure: true });
    const failed = await finishOAuth('google', started.state);
    assert.equal(oauthError(failed), 'callback_failed'); assert.equal(failed.cookie, undefined);
    assert.equal(oauthError(await finishOAuth('google', started.state)), 'invalid_state');
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, 0);
});

test('OAuth linked blocked account cannot receive new session', async () => {
    const account = await register();
    await fixture.sql("UPDATE users SET status = 'blocked' WHERE id = ?", [account.json.user.id]);
    await fixture.state({ profile: { sub: 'blocked-subject', email: 'fixtureuser@example.test', email_verified: true } });
    const started = await startOAuth('google');
    const rejected = await finishOAuth('google', started.state);
    assert.equal(oauthError(rejected), 'callback_failed'); assert.equal(rejected.cookie, undefined);
    assert.equal((await fixture.sql('SELECT COUNT(*) AS n FROM sessions'))[0].n, 1);
});

test('legacy defect: Google runtime disable blocks start but does not invalidate an outstanding callback', async () => {
    const started = await startOAuth('google');
    await fixture.sql("UPDATE system_settings SET value = 'false' WHERE key = 'oauth_google_enabled'");
    assert.equal((await fixture.request('/api/auth/oauth/google/start')).status, 503);
    const callback = await finishOAuth('google', started.state);
    assert.equal(oauthError(callback), null); assert.ok(callback.cookie);
    assert.equal((await fixture.request('/api/auth/me', { cookie: callback.cookie })).json.authenticated, true);
});

test('legacy defect: OAuth links an existing account by email even when provider email is unverified', async () => {
    const account = await register();
    await fixture.state({ profile: { sub: 'unverified-subject', email: 'fixtureuser@example.test', email_verified: false } });
    const started = await startOAuth('google'); const callback = await finishOAuth('google', started.state);
    assert.equal(oauthError(callback), null);
    const me = await fixture.request('/api/auth/me', { cookie: callback.cookie });
    assert.equal(me.json.user.id, account.json.user.id);
    assert.equal(me.json.user.role, 'user', 'Not implicitly promoted to owner');
});

function telegramQuery(state, overrides = {}) {
    const params = { id: '246810', first_name: 'Fixture', username: 'fixturetg', auth_date: String(Math.floor(Date.now() / 1000)), ...overrides };
    const string = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('\n');
    const secret = crypto.createHash('sha256').update('123456:fixture-only-bot-token').digest();
    return new URLSearchParams({ state, ...params, hash: crypto.createHmac('sha256', secret).update(string).digest('hex') });
}
test('relocated standalone site serves preserved pages and styles with its own runtime', async () => {
    const site = await startFixture({ QUBITE_PROCESS_ROLE: 'platform', PORT: '0' });
    try {
        for (const url of ['/', '/404.html', '/4041.html', '/privacy.html', '/terms.html',
                           '/acceptable-use.html', '/security.html', '/support.html',
                           '/front/css/styles.css', '/writing']) {
            const response = await site.request(url);
            assert.equal(response.status, 200, url);
        }
    } finally { await site.stop(); }
});
test('Telegram signed callback validates signature, freshness and one-use state without contacting Telegram', async () => {
    async function state() {
        const value = crypto.randomBytes(24).toString('hex');
        await fixture.sql("INSERT INTO oauth_states (provider,state_hash,expires_at,created_at) VALUES ('telegram',?,?,datetime('now'))", [digest(value), new Date(Date.now() + 60000).toISOString()]);
        return value;
    }
    const bad = telegramQuery(await state()); bad.set('hash', '0'.repeat(64));
    assert.equal(oauthError(await fixture.request(`/api/auth/oauth/telegram/callback?${bad}`)), 'invalid_signature');
    const expired = telegramQuery(await state(), { auth_date: '1' });
    assert.equal(oauthError(await fixture.request(`/api/auth/oauth/telegram/callback?${expired}`)), 'invalid_signature');
    const good = telegramQuery(await state());
    const callback = await fixture.request(`/api/auth/oauth/telegram/callback?${good}`);
    assert.equal(oauthError(callback), null); assert.ok(callback.cookie);
    assert.equal((await fixture.request('/api/auth/me', { cookie: callback.cookie })).json.authenticated, true);
    assert.equal(oauthError(await fixture.request(`/api/auth/oauth/telegram/callback?${good}`)), 'invalid_state');
    assert.equal((await fixture.state()).calls.length, 0);
});
