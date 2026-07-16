const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Load public-profile-utils.js
const utilsCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'public-profile-utils.js'), 'utf-8');
const utilsCtx = { window: {}, module: { exports: {} } };
const vm = require('node:vm');
vm.createContext(utilsCtx);
vm.runInContext(utilsCode, utilsCtx);
const utils = utilsCtx.module.exports;

// Read production files for regression checks
const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

// --- Pure function tests ---

describe('buildPublicProfileUrl', () => {
    it('builds correct URL', () => {
        assert.equal(utils.buildPublicProfileUrl('abc-123'), '/api/users/abc-123/profile');
    });
});

describe('buildFollowRequestUrl', () => {
    it('builds correct URL', () => {
        assert.equal(utils.buildFollowRequestUrl('abc-123'), '/api/users/abc-123/follow');
    });
});

describe('buildNotificationsRequestUrl', () => {
    it('builds correct URL', () => {
        assert.equal(utils.buildNotificationsRequestUrl('abc-123'), '/api/users/abc-123/follow/notifications');
    });
});

describe('getFollowMethod', () => {
    it('returns DELETE when already following', () => {
        assert.equal(utils.getFollowMethod(true), 'DELETE');
    });
    it('returns POST when not following', () => {
        assert.equal(utils.getFollowMethod(false), 'POST');
    });
});

describe('applyFollowResponse', () => {
    it('repeated follow preserves false from API response', () => {
        const result = utils.applyFollowResponse(
            { isFollowing: false, followersCount: 3 },
            { is_following: true, run_notifications_enabled: false, followers_count: 4 }
        );
        assert.equal(result.isFollowing, true);
        assert.equal(result.runNotificationsEnabled, false);
        assert.equal(result.followersCount, 4);
    });

    it('successful follow updates is_following and followers_count', () => {
        const result = utils.applyFollowResponse(
            { isFollowing: false, followersCount: 0 },
            { is_following: true, run_notifications_enabled: true, followers_count: 1 }
        );
        assert.equal(result.isFollowing, true);
        assert.equal(result.followersCount, 1);
    });

    it('successful unfollow sets notifications to null', () => {
        const result = utils.applyFollowResponse(
            { isFollowing: true, followersCount: 5 },
            { is_following: false, run_notifications_enabled: null, followers_count: 4 }
        );
        assert.equal(result.isFollowing, false);
        assert.equal(result.runNotificationsEnabled, null);
        assert.equal(result.followersCount, 4);
    });

    it('falls back to previous state when response lacks is_following', () => {
        const result = utils.applyFollowResponse(
            { isFollowing: true, followersCount: 5 },
            { run_notifications_enabled: true, followers_count: 5 }
        );
        assert.equal(result.isFollowing, false); // !previousState.isFollowing
    });

    it('preserves previous followersCount when response lacks it', () => {
        const result = utils.applyFollowResponse(
            { isFollowing: false, followersCount: 10 },
            { is_following: true }
        );
        assert.equal(result.followersCount, 10);
    });
});

describe('applyNotificationResponse', () => {
    it('uses value from response', () => {
        assert.equal(utils.applyNotificationResponse(true, { run_notifications_enabled: false }), false);
    });

    it('falls back to previous value when response lacks field', () => {
        assert.equal(utils.applyNotificationResponse(true, {}), true);
    });

    it('falls back to previous value when response field is null', () => {
        assert.equal(utils.applyNotificationResponse(false, { run_notifications_enabled: null }), false);
    });
});

describe('getPublicProfileActionError', () => {
    it('returns profile not found for 404', () => {
        assert.equal(utils.getPublicProfileActionError(404, ''), 'Профиль больше недоступен');
    });

    it('returns service unavailable for 500', () => {
        assert.equal(utils.getPublicProfileActionError(500, ''), 'Сервис временно недоступен');
    });

    it('returns service unavailable for 502', () => {
        assert.equal(utils.getPublicProfileActionError(502, ''), 'Сервис временно недоступен');
    });

    it('uses detail for 400', () => {
        assert.equal(utils.getPublicProfileActionError(400, 'Cannot follow yourself'), 'Cannot follow yourself');
    });

    it('returns fallback when no detail', () => {
        assert.equal(utils.getPublicProfileActionError(422, ''), 'Не удалось изменить подписку');
    });
});

describe('getNotificationActionError', () => {
    it('uses detail when present', () => {
        assert.equal(utils.getNotificationActionError('Follow not found'), 'Follow not found');
    });

    it('returns fallback when no detail', () => {
        assert.equal(utils.getNotificationActionError(''), 'Не удалось изменить настройку');
    });
});

describe('getNetworkError', () => {
    it('returns network error message', () => {
        assert.equal(utils.getNetworkError(), 'Не удалось подключиться к серверу');
    });
});

describe('shouldShowNotifications', () => {
    it('returns true when following and value present', () => {
        assert.equal(utils.shouldShowNotifications(true, true), true);
    });

    it('returns true when following and value is false', () => {
        assert.equal(utils.shouldShowNotifications(true, false), true);
    });

    it('returns false when not following', () => {
        assert.equal(utils.shouldShowNotifications(false, true), false);
    });

    it('returns false when value is null', () => {
        assert.equal(utils.shouldShowNotifications(true, null), false);
    });

    it('returns false when value is undefined', () => {
        assert.equal(utils.shouldShowNotifications(true, undefined), false);
    });
});

describe('buildFollowersCountText / buildFollowingCountText', () => {
    it('returns count when present', () => {
        assert.equal(utils.buildFollowersCountText(5), 5);
    });

    it('returns 0 when null', () => {
        assert.equal(utils.buildFollowersCountText(null), 0);
    });

    it('returns 0 when undefined', () => {
        assert.equal(utils.buildFollowingCountText(undefined), 0);
    });
});

// --- Regression / integration tests on production code ---

describe('public profile counters', () => {
    it('public profile counters are non-interactive divs, not buttons', () => {
        assert.ok(!indexHtml.includes('public-followers-btn'),
            'public profile must not have clickable followers button');
        assert.ok(!indexHtml.includes('public-following-btn'),
            'public profile must not have clickable following button');
    });

    it('public profile counters display text only', () => {
        assert.ok(indexHtml.includes('public-followers-count'),
            'public profile must display followers count');
        assert.ok(indexHtml.includes('public-following-count'),
            'public profile must display following count');
    });

    it('own profile still has clickable buttons', () => {
        assert.ok(indexHtml.includes('profile-followers-btn'),
            'own profile must have followers button');
        assert.ok(indexHtml.includes('profile-following-btn'),
            'own profile must have following button');
    });
});

describe('error handling in updatePublicFollowUI', () => {
    it('updatePublicFollowUI exists', () => {
        assert.ok(appJs.includes('function updatePublicFollowUI'),
            'app.js must define updatePublicFollowUI');
    });

    it('follow handler shows errors in status element', () => {
        const fnStart = appJs.indexOf('function updatePublicFollowUI');
        const fnBody = appJs.substring(fnStart, fnStart + 3000);
        assert.ok(fnBody.includes('public-profile-status'),
            'must show errors in public-profile-status');
    });

    it('follow handler has disabled check before request', () => {
        const fnStart = appJs.indexOf('function updatePublicFollowUI');
        const fnBody = appJs.substring(fnStart, fnStart + 3000);
        assert.ok(fnBody.includes('followBtn.disabled = true'),
            'must disable follow button during request');
    });

    it('notification toggle has disabled check', () => {
        const fnStart = appJs.indexOf('function updatePublicFollowUI');
        const fnBody = appJs.substring(fnStart, fnStart + 3000);
        assert.ok(fnBody.includes('notifToggle.disabled = true'),
            'must disable notification toggle during request');
    });

    it('notification handler checks resp.ok', () => {
        const fnStart = appJs.indexOf('function updatePublicFollowUI');
        const fnBody = appJs.substring(fnStart, fnStart + 5000);
        const notifSection = fnBody.substring(fnBody.indexOf('notifToggle.onchange'));
        assert.ok(notifSection.includes('resp.ok'),
            'notification handler must check resp.ok');
    });

    it('notification handler reverts on error', () => {
        const fnStart = appJs.indexOf('function updatePublicFollowUI');
        const fnBody = appJs.substring(fnStart, fnStart + 5000);
        const notifSection = fnBody.substring(fnBody.indexOf('notifToggle.onchange'));
        assert.ok(notifSection.includes('prevChecked'),
            'notification handler must revert to previous value on error');
    });

    it('notification handler uses response value', () => {
        const fnStart = appJs.indexOf('function updatePublicFollowUI');
        const fnBody = appJs.substring(fnStart, fnStart + 5000);
        const notifSection = fnBody.substring(fnBody.indexOf('notifToggle.onchange'));
        assert.ok(notifSection.includes('result.run_notifications_enabled'),
            'notification handler must use value from API response');
    });
});

describe('follow error messages', () => {
    it('404 returns profile not found message', () => {
        assert.equal(utils.getPublicProfileActionError(404), 'Профиль больше недоступен');
    });

    it('500 returns service unavailable', () => {
        assert.equal(utils.getPublicProfileActionError(500), 'Сервис временно недоступен');
    });

    it('network error message exists', () => {
        assert.equal(utils.getNetworkError(), 'Не удалось подключиться к серверу');
    });
});

describe('DOMContentLoaded', () => {
    it('calls initPublicProfile', () => {
        assert.ok(appJs.includes('initPublicProfile()'),
            'DOMContentLoaded must call initPublicProfile');
    });

    it('calls initFollowList', () => {
        assert.ok(appJs.includes('initFollowList()'),
            'DOMContentLoaded must call initFollowList');
    });
});

describe('safe DOM rendering', () => {
    it('app.js defines safeSetText helper', () => {
        assert.ok(appJs.includes('function safeSetText'),
            'app.js must define safeSetText');
    });

    it('app.js defines safeCreateEl helper', () => {
        assert.ok(appJs.includes('function safeCreateEl'),
            'app.js must define safeCreateEl');
    });

    it('app.js defines safeAvatar helper', () => {
        assert.ok(appJs.includes('function safeAvatar'),
            'app.js must define safeAvatar');
    });

    it('app.js defines safeSocialLink helper', () => {
        assert.ok(appJs.includes('function safeSocialLink'),
            'app.js must define safeSocialLink');
    });

    it('safeSocialLink rejects non-http URLs', () => {
        const fn = appJs.match(/function safeSocialLink[\s\S]*?\n\}/);
        assert.ok(fn, 'safeSocialLink must exist');
        assert.ok(fn[0].includes("http:") && fn[0].includes("https:"),
            'safeSocialLink must check protocol');
    });

    it('safeSocialLink adds rel=noopener noreferrer', () => {
        const fn = appJs.match(/function safeSocialLink[\s\S]*?\n\}/);
        assert.ok(fn, 'safeSocialLink must exist');
        assert.ok(fn[0].includes('noopener'), 'must add rel=noopener');
        assert.ok(fn[0].includes('noreferrer'), 'must add rel=noreferrer');
    });

    it('safeAvatar shows placeholder on error', () => {
        const fn = appJs.match(/function safeAvatar[\s\S]*?\n\}/);
        assert.ok(fn, 'safeAvatar must exist');
        assert.ok(fn[0].includes('onerror'), 'must handle image load errors');
    });
});

describe('public-profile-utils.js module', () => {
    it('exports all required functions', () => {
        const required = [
            'buildPublicProfileUrl', 'buildFollowRequestUrl', 'buildNotificationsRequestUrl',
            'getFollowMethod', 'applyFollowResponse', 'applyNotificationResponse',
            'getPublicProfileActionError', 'getNotificationActionError', 'getNetworkError',
            'shouldShowNotifications', 'buildFollowersCountText', 'buildFollowingCountText',
        ];
        for (const fn of required) {
            assert.equal(typeof utils[fn], 'function', fn + ' must be exported');
        }
    });
});
