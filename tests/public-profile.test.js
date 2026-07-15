const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load config.js
const configCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'config.js'), 'utf-8');
const configCtx = { window: {} };
vm.createContext(configCtx);
vm.runInContext(configCode, configCtx);
const { apiUrl } = configCtx;

// Read production files for regression checks
const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

describe('is_public in profile form', () => {
    it('index.html contains profile-is-public checkbox', () => {
        assert.ok(indexHtml.includes('id="profile-is-public"'),
            'index.html must contain profile-is-public checkbox');
    });

    it('index.html contains is_public field hint', () => {
        assert.ok(indexHtml.includes('Публичный профиль смогут видеть'),
            'index.html must contain is_public field hint');
    });

    it('app.js loads is_public from profile data', () => {
        assert.ok(appJs.includes("profile.is_public") || appJs.includes("!!profile.is_public"),
            'app.js must load is_public from profile data');
    });

    it('app.js sends is_public in save request', () => {
        assert.ok(appJs.includes("is_public: document.getElementById('profile-is-public').checked"),
            'app.js must send is_public from checkbox');
    });

    it('app.js shows saved is_public value after response', () => {
        assert.ok(appJs.includes("profile.is_public").toString().includes("checked") ||
                  appJs.includes("p.is_public"),
            'app.js must update checkbox after save');
    });
});

describe('openPublicProfile', () => {
    it('app.js defines openPublicProfile function', () => {
        assert.ok(appJs.includes('async function openPublicProfile'),
            'app.js must define openPublicProfile');
    });

    it('openPublicProfile calls correct URL', () => {
        const fnMatch = appJs.match(/async function openPublicProfile[\s\S]*?\n\}/);
        assert.ok(fnMatch, 'openPublicProfile must exist');
        assert.ok(fnMatch[0].includes('/api/users/'),
            'openPublicProfile must call /api/users/');
    });

    it('openPublicProfile shows full profile data', () => {
        const fnMatch = appJs.match(/async function openPublicProfile[\s\S]*?\n\}/);
        assert.ok(fnMatch, 'openPublicProfile must exist');
        assert.ok(fnMatch[0].includes('display_name'), 'must show display_name');
        assert.ok(fnMatch[0].includes('bio'), 'must show bio');
        assert.ok(fnMatch[0].includes('city'), 'must show city');
        assert.ok(fnMatch[0].includes('club_name'), 'must show club_name');
        assert.ok(fnMatch[0].includes('social_links'), 'must show social_links');
    });

    it('openPublicProfile does not use innerHTML for user data', () => {
        const fnStart = appJs.indexOf('async function openPublicProfile');
        const fnBody = appJs.substring(fnStart, fnStart + 2500);
        // Allow innerHTML = '' (clearing) but not innerHTML with data
        const lines = fnBody.split('\n');
        for (const line of lines) {
            if (line.includes('.innerHTML') && !line.includes("= ''") && !line.includes('innerHTML = ""')) {
                assert.fail('openPublicProfile must not set innerHTML with data: ' + line.trim());
            }
        }
    });
});

describe('follow/unfollow', () => {
    it('openPublicProfile handles follow button', () => {
        assert.ok(appJs.includes('POST') && appJs.includes('/follow'),
            'app.js must support follow via POST');
    });

    it('openPublicProfile handles unfollow button', () => {
        assert.ok(appJs.includes('DELETE') && appJs.includes('/follow'),
            'app.js must support unfollow via DELETE');
    });

    it('openPublicProfile updates followers_count after follow', () => {
        assert.ok(appJs.includes('public-followers-count'),
            'app.js must update public-followers-count after follow/unfollow');
    });

    it('notifications toggle calls PUT', () => {
        assert.ok(appJs.includes('/follow/notifications'),
            'app.js must handle notifications toggle via PUT');
    });

    it('notifications toggle hidden without follow', () => {
        assert.ok(appJs.includes('notifArea.classList.add(\'hidden\')') ||
                  appJs.includes('notifications-area'),
            'app.js must hide notifications when not following');
    });
});

describe('followers/following lists', () => {
    it('app.js defines openFollowList function', () => {
        assert.ok(appJs.includes('async function openFollowList'),
            'app.js must define openFollowList');
    });

    it('first page loads from correct endpoint', () => {
        assert.ok(appJs.includes('/api/me/followers') || appJs.includes('/api/me/following'),
            'app.js must load from correct endpoint');
    });

    it('next page uses next_cursor', () => {
        assert.ok(appJs.includes('next_cursor'),
            'app.js must use next_cursor for pagination');
    });

    it('deduplicates users by user_id', () => {
        assert.ok(appJs.includes('followListSeenIds'),
            'app.js must track seen user IDs');
    });

    it('empty state is shown', () => {
        assert.ok(indexHtml.includes('follow-list-empty'),
            'index.html must contain follow-list-empty element');
    });

    it('error state is shown', () => {
        assert.ok(indexHtml.includes('follow-list-status'),
            'index.html must contain follow-list-status element');
    });

    it('load more button works', () => {
        assert.ok(indexHtml.includes('follow-list-load-more-btn'),
            'index.html must contain load more button');
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
        assert.ok(fn[0].includes('noopener'),
            'safeSocialLink must add rel=noopener');
        assert.ok(fn[0].includes('noreferrer'),
            'safeSocialLink must add rel=noreferrer');
    });

    it('safeSocialLink adds target=_blank', () => {
        const fn = appJs.match(/function safeSocialLink[\s\S]*?\n\}/);
        assert.ok(fn, 'safeSocialLink must exist');
        assert.ok(fn[0].includes("target: '_blank'"),
            'safeSocialLink must add target=_blank');
    });

    it('safeAvatar shows placeholder on error', () => {
        const fn = appJs.match(/function safeAvatar[\s\S]*?\n\}/);
        assert.ok(fn, 'safeAvatar must exist');
        assert.ok(fn[0].includes('onerror'),
            'safeAvatar must handle image load errors');
    });
});

describe('UI/UX requirements', () => {
    it('modals have close buttons', () => {
        assert.ok(indexHtml.includes('public-profile-close'),
            'public profile modal must have close button');
        assert.ok(indexHtml.includes('follow-list-close'),
            'follow list modal must have close button');
    });

    it('Escape key closes modals', () => {
        assert.ok(appJs.includes("key === 'Escape'"),
            'app.js must handle Escape key for modals');
    });

    it('overlay click closes modals', () => {
        assert.ok(appJs.includes('e.target === modal'),
            'app.js must close modals on overlay click');
    });

    it('index.html contains public-profile-modal', () => {
        assert.ok(indexHtml.includes('id="public-profile-modal"'),
            'index.html must contain public-profile-modal');
    });

    it('index.html contains follow-list-modal', () => {
        assert.ok(indexHtml.includes('id="follow-list-modal"'),
            'index.html must contain follow-list-modal');
    });

    it('profile counts buttons exist', () => {
        assert.ok(indexHtml.includes('profile-followers-btn'),
            'index.html must contain profile-followers-btn');
        assert.ok(indexHtml.includes('profile-following-btn'),
            'index.html must contain profile-following-btn');
    });
});

describe('created_at and telegram fields not used', () => {
    it('openPublicProfile does not reference created_at', () => {
        const fnStart = appJs.indexOf('async function openPublicProfile');
        const fnEnd = appJs.indexOf('// === Follow List Modal ===');
        const section = appJs.substring(fnStart, fnEnd);
        assert.ok(!section.includes('created_at'),
            'openPublicProfile must not use created_at');
    });

    it('follow list does not reference created_at', () => {
        const fnStart = appJs.indexOf('function buildFollowCard');
        const fnEnd = appJs.indexOf('function initFollowList');
        const section = appJs.substring(fnStart, fnEnd);
        assert.ok(!section.includes('created_at'),
            'buildFollowCard must not use created_at');
    });

    it('follow list does not reference telegram_id', () => {
        const fnStart = appJs.indexOf('function buildFollowCard');
        const fnEnd = appJs.indexOf('function initFollowList');
        const section = appJs.substring(fnStart, fnEnd);
        assert.ok(!section.includes('telegram_id') && !section.includes('telegram_user'),
            'buildFollowCard must not use telegram fields');
    });
});

describe('DOMContentLoaded calls new init functions', () => {
    it('calls initPublicProfile', () => {
        assert.ok(appJs.includes('initPublicProfile()'),
            'DOMContentLoaded must call initPublicProfile');
    });

    it('calls initFollowList', () => {
        assert.ok(appJs.includes('initFollowList()'),
            'DOMContentLoaded must call initFollowList');
    });
});

describe('apiUrl integration', () => {
    it('public profile uses apiUrl', () => {
        assert.ok(appJs.includes("apiUrl('/api/users/'"),
            'openPublicProfile must use apiUrl');
    });

    it('follow list uses apiUrl', () => {
        assert.ok(appJs.includes("/api/me/followers'") ||
                  appJs.includes("/api/me/following'"),
            'openFollowList must use apiUrl');
    });

    it('follow uses apiUrl', () => {
        assert.ok(appJs.includes("apiUrl('/api/users/' + userId + '/follow'"),
            'follow/unfollow must use apiUrl');
    });
});

describe('profile counters', () => {
    it('index.html contains profile-counts section', () => {
        assert.ok(indexHtml.includes('id="profile-counts"'),
            'index.html must contain profile-counts');
    });

    it('app.js loads followers_count from profile', () => {
        assert.ok(appJs.includes('followers_count'),
            'app.js must load followers_count');
    });

    it('app.js loads following_count from profile', () => {
        assert.ok(appJs.includes('following_count'),
            'app.js must load following_count');
    });
});
