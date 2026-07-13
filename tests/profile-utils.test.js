const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load config.js
const configCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'config.js'), 'utf-8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(configCode, ctx);
const { apiUrl } = ctx;

// Read production files for regression checks
const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

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

describe('production code regression', () => {
    it('app.js does not reference removed feedback-btn element', () => {
        assert.ok(!appJs.includes("getElementById('feedback-btn')"),
            "app.js must not reference getElementById('feedback-btn')");
        assert.ok(!appJs.includes('getElementById("feedback-btn")'),
            'app.js must not reference getElementById("feedback-btn")');
    });

    it('index.html contains menu-feedback button', () => {
        assert.ok(indexHtml.includes('menu-feedback'),
            'index.html must contain menu-feedback button');
    });

    it('app.js handles menu-feedback click', () => {
        assert.ok(appJs.includes("getElementById('menu-feedback')") ||
                  appJs.includes('menu-feedback'),
            'app.js must handle menu-feedback');
    });

    it('app.js calls openFeedbackModal from menu', () => {
        assert.ok(appJs.includes('openFeedbackModal'),
            'app.js must define and call openFeedbackModal');
    });

    it('initFeedback does not depend on feedback-btn', () => {
        const initFeedbackMatch = appJs.match(/function initFeedback\(\)\s*\{[\s\S]*?\n\}/);
        assert.ok(initFeedbackMatch, 'initFeedback function must exist');
        assert.ok(!initFeedbackMatch[0].includes('feedback-btn'),
            'initFeedback must not reference feedback-btn');
    });

    it('DOMContentLoaded calls initFeedback, initMenu, initProfile', () => {
        assert.ok(appJs.includes('initFeedback()'), 'DOMContentLoaded must call initFeedback');
        assert.ok(appJs.includes('initMenu()'), 'DOMContentLoaded must call initMenu');
        assert.ok(appJs.includes('initProfile()'), 'DOMContentLoaded must call initProfile');
    });

    it('DOMContentLoaded calls initInsertMode, initGPS, loadCurrentUser', () => {
        assert.ok(appJs.includes('initInsertMode()'), 'DOMContentLoaded must call initInsertMode');
        assert.ok(appJs.includes('initGPS()'), 'DOMContentLoaded must call initGPS');
        assert.ok(appJs.includes('loadCurrentUser()'), 'DOMContentLoaded must call loadCurrentUser');
    });

    it('calendar button is disabled', () => {
        assert.ok(indexHtml.includes('menu-calendar') && indexHtml.includes('disabled'),
            'calendar menu item must be disabled');
    });

    it('profile requests use apiUrl', () => {
        assert.ok(appJs.includes("apiUrl('/api/profile')"),
            'profile requests must use apiUrl');
    });

    it('profile requests use getApiHeaders', () => {
        assert.ok(appJs.includes("headers: getApiHeaders()"),
            'profile requests must use getApiHeaders');
    });

    it('profile flow uses value/textContent, not innerHTML', () => {
        const profileSection = appJs.substring(
            appJs.indexOf('function openProfileModal'),
            appJs.indexOf('// === Init all')
        );
        assert.ok(!profileSection.includes('.innerHTML'),
            'profile flow must not use innerHTML');
    });

    it('outside Telegram openProfileModal does not call fetch', () => {
        const profileSection = appJs.substring(
            appJs.indexOf('function openProfileModal'),
            appJs.indexOf('function loadProfileData')
        );
        assert.ok(profileSection.includes('isTelegramApp()'),
            'openProfileModal must check isTelegramApp');
        const returnIdx = profileSection.indexOf('return', profileSection.indexOf('if (!isTelegramApp'));
        assert.ok(returnIdx > 0,
            'openProfileModal must return early when not in Telegram');
    });

    it('feedback modal uses apiUrl for /api/feedback', () => {
        assert.ok(appJs.includes("apiUrl('/api/feedback')"),
            'feedback must use apiUrl');
    });

    it('feedback modal uses getApiHeaders', () => {
        // openFeedbackModal is defined before initFeedback in the file
        const feedbackStart = appJs.indexOf('function openFeedbackModal');
        const feedbackEnd = appJs.indexOf('function loadCurrentUser');
        const feedbackSection = appJs.substring(feedbackStart, feedbackEnd);
        assert.ok(feedbackSection.includes('getApiHeaders()'),
            'feedback must use getApiHeaders');
    });
});
