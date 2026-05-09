(function () {
    'use strict';

    let vpnState = 'stopped';
    let selectedServerId = '';
    let pollTimer = null;
    let uptimeTimer = null;
    let uptimeSeconds = 0;
    let currentUser = null;
    let verifyFlowToken = '';

    const $loginScreen = document.getElementById('loginScreen');
    const $registerScreen = document.getElementById('registerScreen');
    const $verifyScreen = document.getElementById('verifyScreen');
    const $vpnScreen = document.getElementById('vpnScreen');

    const $loginForm = document.getElementById('loginForm');
    const $loginInput = document.getElementById('loginInput');
    const $passwordInput = document.getElementById('passwordInput');
    const $togglePassword = document.getElementById('togglePassword');
    const $loginError = document.getElementById('loginError');
    const $loginBtn = document.getElementById('loginBtn');
    const $loginBtnText = document.getElementById('loginBtnText');
    const $loginSpinner = document.getElementById('loginSpinner');
    const $goToRegister = document.getElementById('goToRegister');

    const $registerForm = document.getElementById('registerForm');
    const $regLogin = document.getElementById('regLogin');
    const $regEmail = document.getElementById('regEmail');
    const $regPassword = document.getElementById('regPassword');
    const $toggleRegPassword = document.getElementById('toggleRegPassword');
    const $registerError = document.getElementById('registerError');
    const $registerBtn = document.getElementById('registerBtn');
    const $registerBtnText = document.getElementById('registerBtnText');
    const $registerSpinner = document.getElementById('registerSpinner');
    const $goToLogin = document.getElementById('goToLogin');

    const $verifyForm = document.getElementById('verifyForm');
    const $verifyCode = document.getElementById('verifyCode');
    const $verifyHint = document.getElementById('verifyHint');
    const $verifyError = document.getElementById('verifyError');
    const $verifyBtn = document.getElementById('verifyBtn');
    const $verifyBtnText = document.getElementById('verifyBtnText');
    const $verifySpinner = document.getElementById('verifySpinner');
    const $resendCode = document.getElementById('resendCode');

    const $userBadge = document.getElementById('userBadge');
    const $logoutBtn = document.getElementById('logoutBtn');
    const $connectBtn = document.getElementById('connectBtn');
    const $statusRing = document.getElementById('statusRing');
    const $statusText = document.getElementById('statusText');
    const $statusSub = document.getElementById('statusSub');
    const $playIcon = document.getElementById('playIcon');
    const $stopIcon = document.getElementById('stopIcon');
    const $serverCard = document.getElementById('serverCard');
    const $serverName = document.getElementById('serverName');
    const $serverRegion = document.getElementById('serverRegion');
    const $statsSection = document.getElementById('statsSection');
    const $uptimeValue = document.getElementById('uptimeValue');
    const $serverValue = document.getElementById('serverValue');
    const $errorSection = document.getElementById('errorSection');
    const $errorText = document.getElementById('errorText');
    const $serverModal = document.getElementById('serverModal');
    const $modalOverlay = document.getElementById('modalOverlay');
    const $closeModal = document.getElementById('closeModal');
    const $serverList = document.getElementById('serverList');

    checkAuth();

    // === Screens ===
    function hideAll() {
        $loginScreen.hidden = true;
        $registerScreen.hidden = true;
        $verifyScreen.hidden = true;
        $vpnScreen.hidden = true;
    }
    function showLogin() {
        hideAll(); $loginScreen.hidden = false;
        stopPolling(); stopUptime();
    }
    function showRegister() {
        hideAll(); $registerScreen.hidden = false;
        stopPolling(); stopUptime();
    }
    function showVerify(email) {
        hideAll(); $verifyScreen.hidden = false;
        stopPolling();
        $verifyHint.textContent = email
            ? 'Мы отправили код на ' + email + '. Введи его ниже.'
            : 'Мы отправили код на твой email. Введи его ниже.';
        $verifyCode.value = '';
        $verifyError.hidden = true;
        $verifyCode.focus();
    }
    function showVPN() {
        hideAll(); $vpnScreen.hidden = false;
        if (currentUser) $userBadge.textContent = '@' + currentUser.login;
        startPolling();
    }

    // === Auth check ===
    async function checkAuth() {
        try {
            const r = await fetch('/api/auth/status');
            const d = await r.json();
            if (d.authenticated && d.user) { currentUser = d.user; showVPN(); }
            else showLogin();
        } catch { showLogin(); }
    }

    // === Login ===
    $togglePassword.addEventListener('click', function () {
        $passwordInput.type = $passwordInput.type === 'password' ? 'text' : 'password';
    });
    $goToRegister.addEventListener('click', function (e) { e.preventDefault(); $loginError.hidden = true; showRegister(); });

    $loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        $loginError.hidden = true;
        setLoading($loginBtn, $loginBtnText, $loginSpinner, true, 'Вход...');
        try {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login: $loginInput.value.trim(), password: $passwordInput.value }),
            });
            const d = await r.json();
            if (d.requiresTwoFactor) { showErr($loginError, 'Требуется 2FA. Пока не поддерживается.'); return; }
            if (d.error) { showErr($loginError, d.error); return; }
            if (d.authenticated && d.user) { currentUser = d.user; $passwordInput.value = ''; showVPN(); }
            else showErr($loginError, 'Неизвестная ошибка');
        } catch { showErr($loginError, 'Не удалось подключиться к серверу'); }
        finally { setLoading($loginBtn, $loginBtnText, $loginSpinner, false, 'Войти'); }
    });

    // === Register ===
    $toggleRegPassword.addEventListener('click', function () {
        $regPassword.type = $regPassword.type === 'password' ? 'text' : 'password';
    });
    $goToLogin.addEventListener('click', function (e) { e.preventDefault(); $registerError.hidden = true; showLogin(); });

    $registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        $registerError.hidden = true;
        setLoading($registerBtn, $registerBtnText, $registerSpinner, true, 'Создание...');
        try {
            var email = $regEmail.value.trim();
            const r = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login: $regLogin.value.trim(), email: email, password: $regPassword.value }),
            });
            const d = await r.json();
            if (d.error) { showErr($registerError, d.error); return; }
            if (d.authenticated && d.user) {
                currentUser = d.user;
                $regPassword.value = '';
                if (d.emailVerificationRequired && d.challenge) {
                    verifyFlowToken = d.challenge.flowToken;
                    showVerify(email);
                } else { showVPN(); }
            } else showErr($registerError, 'Неизвестная ошибка');
        } catch { showErr($registerError, 'Не удалось подключиться к серверу'); }
        finally { setLoading($registerBtn, $registerBtnText, $registerSpinner, false, 'Создать аккаунт'); }
    });

    // === Email verify ===
    $verifyForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        $verifyError.hidden = true;
        setLoading($verifyBtn, $verifyBtnText, $verifySpinner, true, 'Проверка...');
        try {
            const r = await fetch('/api/auth/email/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ flowToken: verifyFlowToken, code: $verifyCode.value.trim() }),
            });
            const d = await r.json();
            if (d.error) { showErr($verifyError, d.error); return; }
            if (d.success) { if (d.user) currentUser = d.user; showVPN(); }
            else showErr($verifyError, 'Неверный код');
        } catch { showErr($verifyError, 'Не удалось подключиться к серверу'); }
        finally { setLoading($verifyBtn, $verifyBtnText, $verifySpinner, false, 'Подтвердить'); }
    });

    $resendCode.addEventListener('click', async function (e) {
        e.preventDefault();
        if (!verifyFlowToken) return;
        try {
            const r = await fetch('/api/auth/challenges/resend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ flowToken: verifyFlowToken }),
            });
            const d = await r.json();
            if (d.error) showErr($verifyError, d.error);
            else $verifyHint.textContent = 'Код отправлен повторно. Проверь почту.';
        } catch { showErr($verifyError, 'Не удалось отправить код'); }
    });

    // === Logout ===
    $logoutBtn.addEventListener('click', async function () {
        try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
        currentUser = null;
        verifyFlowToken = '';
        showLogin();
    });

    // === VPN polling ===
    function startPolling() { pollStatus(); pollTimer = setInterval(pollStatus, 2000); }
    function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

    async function pollStatus() {
        try {
            const r = await fetch('/api/status');
            const d = await r.json();
            if (d.authenticated === false) { currentUser = null; showLogin(); return; }
            updateVPN(d);
        } catch {}
    }

    function updateVPN(d) {
        var state = d.state || 'stopped';
        vpnState = state;
        $statusRing.className = 'status-ring';
        $playIcon.hidden = true;
        $stopIcon.hidden = true;
        $errorSection.hidden = true;
        $statsSection.hidden = true;

        if (state === 'stopped') {
            $playIcon.hidden = false;
            $statusText.textContent = 'Отключен';
            $statusSub.textContent = '';
            stopUptime();
        } else if (state === 'starting') {
            $statusRing.classList.add('connecting');
            $playIcon.hidden = false;
            $statusText.textContent = 'Подключение...';
        } else if (state === 'running') {
            $statusRing.classList.add('connected');
            $stopIcon.hidden = false;
            $statusText.textContent = 'Подключен';
            $statsSection.hidden = false;
            if (d.server) {
                $serverValue.textContent = d.server.name || d.server.domain || '-';
                $statusSub.textContent = d.server.region || '';
            }
            if (d.uptime !== undefined) {
                uptimeSeconds = d.uptime;
                $uptimeValue.textContent = fmt(uptimeSeconds);
                if (!uptimeTimer) startUptime();
            }
        } else if (state === 'stopping') {
            $statusRing.classList.add('connecting');
            $stopIcon.hidden = false;
            $statusText.textContent = 'Отключение...';
        } else if (state === 'error') {
            $statusRing.classList.add('error');
            $playIcon.hidden = false;
            $statusText.textContent = 'Ошибка';
            $errorSection.hidden = false;
            $errorText.textContent = d.error || 'Unknown error';
            if (!d.singboxOk) $errorText.textContent += '\nsing-box: ' + (d.singboxPath || 'not found');
            stopUptime();
        }
    }

    // === Connect / Disconnect ===
    $connectBtn.addEventListener('click', function () {
        if (vpnState === 'running') disconnect();
        else if (vpnState === 'stopped' || vpnState === 'error') connect();
    });

    async function connect() {
        $statusRing.className = 'status-ring connecting';
        $statusText.textContent = 'Подключение...';
        $errorSection.hidden = true;
        try {
            const r = await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId: selectedServerId }),
            });
            const d = await r.json();
            if (d.error) {
                $statusRing.className = 'status-ring error';
                $statusText.textContent = 'Ошибка';
                $errorSection.hidden = false;
                $errorText.textContent = d.error;
            }
        } catch (err) {
            $statusRing.className = 'status-ring error';
            $statusText.textContent = 'Ошибка';
            $errorSection.hidden = false;
            $errorText.textContent = err.message || 'Connection failed';
        }
    }

    async function disconnect() {
        $statusText.textContent = 'Отключение...';
        try { await fetch('/api/disconnect', { method: 'POST' }); } catch {}
    }

    // === Servers ===
    $serverCard.addEventListener('click', showServers);
    $closeModal.addEventListener('click', hideServers);
    $modalOverlay.addEventListener('click', hideServers);

    async function showServers() {
        $serverModal.hidden = false;
        $serverList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2)">Загрузка...</div>';
        try {
            const r = await fetch('/api/servers');
            const d = await r.json();
            if (d.error) { $serverList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red)">' + esc(d.error) + '</div>'; return; }
            renderServers(d.servers || []);
        } catch { $serverList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red)">Ошибка загрузки</div>'; }
    }
    function hideServers() { $serverModal.hidden = true; }

    function renderServers(servers) {
        if (!servers.length) { $serverList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2)">Нет серверов</div>'; return; }
        var html = '<div class="server-item' + (!selectedServerId ? ' active' : '') + '" data-id="" data-name="Автовыбор" data-region="Лучший сервер">';
        html += '<span class="health-dot green"></span><div class="server-item-info"><div class="server-item-name">Автовыбор</div><div class="server-item-region">Лучший сервер</div></div></div>';
        for (var i = 0; i < servers.length; i++) {
            var s = servers[i], a = s.id === selectedServerId ? ' active' : '';
            var hc = s.health === 'healthy' ? 'green' : s.health === 'degraded' ? 'yellow' : s.health === 'down' ? 'red' : 'gray';
            html += '<div class="server-item' + a + '" data-id="' + s.id + '" data-name="' + esc(s.name) + '" data-region="' + esc(s.region) + '">';
            html += '<span class="health-dot ' + hc + '"></span><div class="server-item-info"><div class="server-item-name">' + esc(s.name) + '</div><div class="server-item-region">' + esc(s.region) + '</div></div></div>';
        }
        $serverList.innerHTML = html;
        $serverList.querySelectorAll('.server-item').forEach(function (el) {
            el.addEventListener('click', function () {
                selectedServerId = el.dataset.id;
                $serverName.textContent = el.dataset.name;
                $serverRegion.textContent = el.dataset.region;
                hideServers();
            });
        });
    }

    // === Helpers ===
    function startUptime() { stopUptime(); uptimeTimer = setInterval(function () { uptimeSeconds++; $uptimeValue.textContent = fmt(uptimeSeconds); }, 1000); }
    function stopUptime() { if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = null; } uptimeSeconds = 0; $uptimeValue.textContent = '00:00:00'; }
    function fmt(s) { return String(Math.floor(s/3600)).padStart(2,'0') + ':' + String(Math.floor((s%3600)/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); }
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function showErr(el, msg) { el.textContent = msg; el.hidden = false; }
    function setLoading(btn, txt, spin, on, label) { btn.disabled = on; txt.textContent = label; spin.hidden = !on; }
})();
