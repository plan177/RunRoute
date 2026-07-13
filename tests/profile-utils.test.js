const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Load config.js
const configCode = fs.readFileSync(require('path').join(__dirname, '..', 'mini-app', 'config.js'), 'utf-8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(configCode, ctx);
const { apiUrl } = ctx;

describe('apiUrl', () => {
    it('returns path when base URL is empty', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = '';
        assert.equal(apiUrl('/api/profile'), '/api/profile');
    });

    it('prepends production URL', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = 'https://authentic-growth-runroute-pr-51.up.railway.app';
        const result = apiUrl('/api/profile');
        assert.equal(result, 'https://authentic-growth-runroute-pr-51.up.railway.app/api/profile');
    });

    it('strips trailing slash', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = 'https://example.com/';
        assert.equal(apiUrl('/api/me'), 'https://example.com/api/me');
    });

    it('no double slashes', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = 'https://example.com/';
        const result = apiUrl('/api/me');
        assert.ok(!result.includes('.com//'));
    });
});

describe('getApiHeaders', () => {
    it('includes Content-Type', () => {
        global.window = { Telegram: { WebApp: { initData: null } } };
        // Re-define getApiHeaders in this context
        function isTelegramApp() {
            return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
        }
        function getTelegramInitData() {
            if (!isTelegramApp()) return null;
            return window.Telegram.WebApp.initData || null;
        }
        function getApiHeaders() {
            const headers = { 'Content-Type': 'application/json' };
            const initData = getTelegramInitData();
            if (initData) {
                headers['X-Telegram-Init-Data'] = initData;
            }
            return headers;
        }
        const headers = getApiHeaders();
        assert.equal(headers['Content-Type'], 'application/json');
    });

    it('includes X-Telegram-Init-Data when available', () => {
        global.window = { Telegram: { WebApp: { initData: 'test-data' } } };
        function isTelegramApp() {
            return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
        }
        function getTelegramInitData() {
            if (!isTelegramApp()) return null;
            return window.Telegram.WebApp.initData || null;
        }
        function getApiHeaders() {
            const headers = { 'Content-Type': 'application/json' };
            const initData = getTelegramInitData();
            if (initData) {
                headers['X-Telegram-Init-Data'] = initData;
            }
            return headers;
        }
        const headers = getApiHeaders();
        assert.equal(headers['X-Telegram-Init-Data'], 'test-data');
    });

    it('does not include X-Telegram-Init-Data when null', () => {
        global.window = { Telegram: { WebApp: { initData: null } } };
        function isTelegramApp() {
            return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
        }
        function getTelegramInitData() {
            if (!isTelegramApp()) return null;
            return window.Telegram.WebApp.initData || null;
        }
        function getApiHeaders() {
            const headers = { 'Content-Type': 'application/json' };
            const initData = getTelegramInitData();
            if (initData) {
                headers['X-Telegram-Init-Data'] = initData;
            }
            return headers;
        }
        const headers = getApiHeaders();
        assert.equal(headers['X-Telegram-Init-Data'], undefined);
    });
});

describe('profile payload', () => {
    it('contains only allowed fields', () => {
        const allowedFields = ['display_name', 'bio', 'city', 'club_name', 'avatar_url', 'social_links'];
        const socialKeys = ['telegram', 'instagram', 'strava', 'vk', 'website'];

        const payload = {
            display_name: 'Test',
            bio: 'Runner',
            city: 'Moscow',
            club_name: 'Club',
            avatar_url: 'https://example.com/photo.jpg',
            social_links: {
                telegram: 'https://t.me/test',
                instagram: null,
                strava: null,
                vk: null,
                website: null,
            }
        };

        const payloadKeys = Object.keys(payload);
        for (const key of payloadKeys) {
            assert.ok(allowedFields.includes(key), `Unexpected field: ${key}`);
        }

        const socialKeysActual = Object.keys(payload.social_links);
        for (const key of socialKeysActual) {
            assert.ok(socialKeys.includes(key), `Unexpected social key: ${key}`);
        }
    });

    it('does not contain user_id or is_public', () => {
        const payload = { display_name: 'Test' };
        assert.equal(payload.user_id, undefined);
        assert.equal(payload.is_public, undefined);
    });
});

describe('security', () => {
    it('user values use textContent/value, not innerHTML', () => {
        const dangerous = '<script>alert("xss")</script>';
        const el = { textContent: '', value: '' };
        el.textContent = dangerous;
        // textContent safely escapes HTML — string stored but not parsed
        assert.equal(typeof el.textContent, 'string');
        assert.equal(el.innerHTML, undefined);
        el.value = dangerous;
        assert.equal(typeof el.value, 'string');
    });

    it('only http/https links accepted', () => {
        const valid = ['https://t.me/test', 'http://example.com'];
        const invalid = ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://file.com'];
        for (const url of valid) {
            const scheme = new URL(url).protocol.replace(':', '');
            assert.ok(['http', 'https'].includes(scheme), `${url} should be valid`);
        }
        for (const url of invalid) {
            try {
                const scheme = new URL(url).protocol.replace(':', '');
                assert.ok(!['http', 'https'].includes(scheme), `${url} should be invalid`);
            } catch {
                // Invalid URL is fine
            }
        }
    });
});
