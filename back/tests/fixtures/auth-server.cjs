// Test-only preload: real server/routes/SQLite/hash/guards, mocked external transports.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const sqlite3 = require('sqlite3');
const root = process.cwd();
const fixtureRoot = process.env.QUBITE_AUTH_FIXTURE_ROOT;
if (!process.send || !fixtureRoot || !root.startsWith(fixtureRoot + path.sep) ||
    process.env.DATABASE_PATH !== path.join(fixtureRoot, 'state.sqlite') ||
    fs.existsSync(path.join(root, '.env')) || fs.existsSync(path.join(root, 'back/.env'))) {
    throw new Error('Auth fixture must run in a disposable source copy without env files');
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const options = net._normalizeArgs(args)[0];
    if (options.host && !['127.0.0.1', '::1', 'localhost'].includes(options.host)) {
        throw new Error('Auth fixture: external socket denied');
    }
    return originalConnect.apply(this, args);
};
const state = { mails: [], calls: [], profile: null, tokenFailure: false };
const emailPath = require.resolve(path.join(root, 'back/src/email.js'));
const email = require(emailPath);
require.cache[emailPath].exports = {
    ...email,
    async sendEmail(message) {
        state.mails.push({ to: message.to, text: message.text });
        return { delivered: true, mode: 'fixture' };
    },
};
const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json' },
});
global.fetch = async (input, options = {}) => {
    const url = String(input);
    const body = new URLSearchParams(String(options.body || ''));
    state.calls.push({ url, body: Object.fromEntries(body) });
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        return response({ success: body.get('response') === 'fixture-captcha', hostname: 'auth.test' });
    }
    if (url === 'https://oauth2.googleapis.com/token' || url === 'https://oauth.yandex.com/token' ||
        url === 'https://id.vk.ru/oauth2/auth') {
        return state.tokenFailure ? response({ error: 'fixture_exchange_failed' }, 400) :
            response({ access_token: 'fixture-access-token' });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return response(state.profile || { sub: 'fixture-google', email: 'oauth@example.test', email_verified: true, name: 'Fixture' });
    }
    if (url === 'https://login.yandex.ru/info?format=json') {
        return response(state.profile || { id: 'fixture-yandex', default_email: 'yandex@example.test', login: 'FixtureYandex' });
    }
    if (url === 'https://id.vk.ru/oauth2/user_info') {
        return response({ user: state.profile || { user_id: 'fixture-vk', email: 'vk@example.test', first_name: 'FixtureVK' } });
    }
    throw new Error('Auth fixture: unmocked fetch denied');
};
let connection;
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
    this.once('listening', () => {
        connection = new sqlite3.Database(process.env.DATABASE_PATH);
        connection.configure('busyTimeout', 5000);
        process.send({ kind: 'ready', port: this.address().port });
    });
    return listen.apply(this, args);
};
process.on('message', async message => {
    try {
        let result;
        if (message.kind === 'sql') {
            result = await new Promise((resolve, reject) => {
                connection.all(message.sql, message.params || [], (error, rows) => error ? reject(error) : resolve(rows));
            });
        } else if (message.kind === 'state') {
            Object.assign(state, message.patch || {});
            result = state;
        } else throw new Error('Unsupported fixture operation');
        process.send({ id: message.id, result });
    } catch (error) {
        process.send({ id: message.id, error: error.message });
    }
});
