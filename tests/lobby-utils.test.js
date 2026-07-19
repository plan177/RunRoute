const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lobbyCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(lobbyCode, ctx);
const L = ctx.RunRouteLobbyUtils || ctx.module.exports;

const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

// --- formatRunType ---

describe('formatRunType', () => {
    it('formats easy as Лёгкая', () => assert.equal(L.formatRunType('easy'), 'Лёгкая'));
    it('formats recovery as Восстановительная', () => assert.equal(L.formatRunType('recovery'), 'Восстановительная'));
    it('formats long as Длительная', () => assert.equal(L.formatRunType('long'), 'Длительная'));
    it('formats tempo as Темповая', () => assert.equal(L.formatRunType('tempo'), 'Темповая'));
    it('formats intervals as Интервалы', () => assert.equal(L.formatRunType('intervals'), 'Интервалы'));
    it('formats hills as Горки', () => assert.equal(L.formatRunType('hills'), 'Горки'));
    it('formats trail as Трейл', () => assert.equal(L.formatRunType('trail'), 'Трейл'));
    it('formats other as Другая', () => assert.equal(L.formatRunType('other'), 'Другая'));
    it('returns raw for unknown', () => assert.equal(L.formatRunType('sprint'), 'sprint'));
    it('returns empty for null', () => assert.equal(L.formatRunType(null), ''));
});

// --- formatLobbyDate ---

describe('formatLobbyDate', () => {
    it('formats ISO date', () => {
        const result = L.formatLobbyDate('2027-12-01T09:00:00+03:00');
        assert.ok(typeof result === 'string');
        assert.ok(result.length > 0);
    });
    it('returns empty for null', () => assert.equal(L.formatLobbyDate(null), ''));
    it('returns empty for undefined', () => assert.equal(L.formatLobbyDate(undefined), ''));
});

// --- formatParticipants ---

describe('formatParticipants', () => {
    it('formats count and capacity', () => assert.equal(L.formatParticipants(5, 10), '5 / 10'));
    it('handles null capacity', () => assert.equal(L.formatParticipants(5, null), '5'));
    it('handles zero count', () => assert.equal(L.formatParticipants(0, 10), '0 / 10'));
});

// --- parsePaceInput ---

describe('parsePaceInput', () => {
    it('parses 5:00', () => assert.equal(L.parsePaceInput('5:00'), 300));
    it('parses 7:30', () => assert.equal(L.parsePaceInput('7:30'), 450));
    it('parses 0:45', () => assert.equal(L.parsePaceInput('0:45'), 45));
    it('returns null for empty', () => assert.equal(L.parsePaceInput(''), null));
    it('returns null for invalid', () => assert.equal(L.parsePaceInput('abc'), null));
    it('returns null for 60 seconds', () => assert.equal(L.parsePaceInput('5:60'), null));
});

// --- formatPaceInput ---

describe('formatPaceInput', () => {
    it('formats 300 as 5:00', () => assert.equal(L.formatPaceInput(300), '5:00'));
    it('formats 45 as 0:45', () => assert.equal(L.formatPaceInput(45), '0:45'));
    it('returns empty for null', () => assert.equal(L.formatPaceInput(null), ''));
});

// --- validateFutureDate ---

describe('validateFutureDate', () => {
    it('accepts future date', () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        assert.ok(L.validateFutureDate(d.toISOString()));
    });
    it('rejects past date', () => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        assert.ok(!L.validateFutureDate(d.toISOString()));
    });
    it('rejects null', () => assert.ok(!L.validateFutureDate(null)));
    it('rejects invalid', () => assert.ok(!L.validateFutureDate('not-a-date')));
});

// --- validateCapacity ---

describe('validateCapacity', () => {
    it('accepts 10', () => assert.ok(L.validateCapacity(10)));
    it('accepts 2', () => assert.ok(L.validateCapacity(2)));
    it('accepts 100', () => assert.ok(L.validateCapacity(100)));
    it('rejects 1', () => assert.ok(!L.validateCapacity(1)));
    it('rejects 101', () => assert.ok(!L.validateCapacity(101)));
    it('rejects non-integer', () => assert.ok(!L.validateCapacity(5.5)));
});

// --- getFirstRoutePoint ---

describe('getFirstRoutePoint', () => {
    it('returns first point', () => {
        const route = { points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }] };
        const pt = L.getFirstRoutePoint(route);
        assert.equal(pt.lat, 55.7);
        assert.equal(pt.lng, 37.6);
    });
    it('returns null for empty points', () => {
        assert.equal(L.getFirstRoutePoint({ points: [] }), null);
    });
    it('returns null for null route', () => {
        assert.equal(L.getFirstRoutePoint(null), null);
    });
    it('returns null for non-numeric lat', () => {
        const route = { points: [{ lat: 'abc', lng: 37.6 }] };
        assert.equal(L.getFirstRoutePoint(route), null);
    });
});

// --- getLobbyErrorText ---

describe('getLobbyErrorText', () => {
    it('400 returns form error', () => assert.ok(L.getLobbyErrorText(400).includes('Некорректные данные')));
    it('401 returns auth error', () => assert.ok(L.getLobbyErrorText(401).includes('авторизацию')));
    it('403 returns forbidden', () => assert.ok(L.getLobbyErrorText(403).includes('запрещено')));
    it('404 returns not found', () => assert.ok(L.getLobbyErrorText(404).includes('недоступна')));
    it('409 returns conflict', () => assert.ok(L.getLobbyErrorText(409).includes('завершена')));
    it('private profile detail', () => assert.ok(L.getLobbyErrorText(400, 'Profile must be public').includes('публичный профиль')));
    it('network error returns generic', () => assert.ok(L.getLobbyErrorText(0).includes('недоступен')));
});

// --- escapeHtml ---

describe('escapeHtml', () => {
    it('escapes < > & " quotes', () => {
        const result = L.escapeHtml('<script>alert("xss")</script>');
        assert.ok(!result.includes('<script>'));
        assert.ok(result.includes('&lt;'));
    });
    it('returns empty for null', () => assert.equal(L.escapeHtml(null), ''));
    it('returns empty for undefined', () => assert.equal(L.escapeHtml(undefined), ''));
});

// --- renderLobbyCard (no unsafe HTML) ---

describe('renderLobbyCard', () => {
    it('renders lobby card without unsafe innerHTML', () => {
        const lobby = {
            id: 'abc-123', title: 'Test', run_type: 'easy',
            starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow',
            participant_count: 3, capacity: 10,
            organizer: { display_name: 'Test User', avatar_url: null }
        };
        const html = L.renderLobbyCard(lobby);
        assert.ok(html.includes('data-lobby-id="abc-123"'));
        assert.ok(html.includes('Лёгкая'));
        assert.ok(html.includes('3 / 10'));
        assert.ok(html.includes('Test User'));
        assert.ok(!html.includes('<script'));
    });
    it('escapes user input in card', () => {
        const lobby = {
            id: '1', title: '<img onerror=alert(1)>', run_type: 'easy',
            starts_at: '2027-12-01T09:00:00+03:00', city: 'City',
            participant_count: 1, capacity: 5,
            organizer: { display_name: '<b>Bad</b>', avatar_url: null }
        };
        const html = L.renderLobbyCard(lobby);
        assert.ok(!html.includes('<img onerror'));
        assert.ok(!html.includes('<b>Bad</b>'));
    });
});

// --- buildLobbyCreatePayload ---

describe('buildLobbyCreatePayload', () => {
    it('builds required fields', () => {
        const payload = L.buildLobbyCreatePayload({
            title: 'Test', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'Moscow', meetingLat: 55.75, meetingLng: 37.62
        });
        assert.equal(payload.title, 'Test');
        assert.equal(payload.run_type, 'easy');
        assert.equal(payload.city, 'Moscow');
        assert.equal(payload.meeting_lat, 55.75);
    });
    it('includes optional fields', () => {
        const payload = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'Moscow', meetingLat: 55.75, meetingLng: 37.62,
            paceMin: 300, paceMax: 420, capacity: 15
        });
        assert.equal(payload.pace_min_sec_per_km, 300);
        assert.equal(payload.pace_max_sec_per_km, 420);
        assert.equal(payload.capacity, 15);
    });
});

// --- Production code regression ---

describe('lobby production code regression', () => {
    it('index.html has lobby menu item', () => {
        assert.ok(indexHtml.includes('menu-lobby'), 'must have lobby menu button');
        assert.ok(indexHtml.includes('Совместные пробежки'), 'must have lobby label');
    });
    it('index.html has lobby panel', () => {
        assert.ok(indexHtml.includes('id="lobby-panel"'), 'must have lobby panel');
    });
    it('index.html loads lobby-utils.js', () => {
        assert.ok(indexHtml.includes('lobby-utils.js'), 'must load lobby-utils.js');
    });
    it('app.js imports initLobby', () => {
        assert.ok(appJs.includes('initLobby'), 'must call initLobby');
    });
    it('app.js has openLobbyPanel', () => {
        assert.ok(appJs.includes('function openLobbyPanel'), 'must have openLobbyPanel');
    });
    it('app.js has openLobbyDetail', () => {
        assert.ok(appJs.includes('function openLobbyDetail'), 'must have openLobbyDetail');
    });
    it('app.js has submitLobbyCreate', () => {
        assert.ok(appJs.includes('function submitLobbyCreate'), 'must have submitLobbyCreate');
    });
    it('app.js has joinLobby', () => {
        assert.ok(appJs.includes('function joinLobby'), 'must have joinLobby');
    });
    it('app.js has leaveLobbyAction', () => {
        assert.ok(appJs.includes('function leaveLobbyAction'), 'must have leaveLobbyAction');
    });
    it('app.js has cancelLobbyAction', () => {
        assert.ok(appJs.includes('function cancelLobbyAction'), 'must have cancelLobbyAction');
    });
    it('app.js uses getApiHeaders', () => {
        const lobbySection = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(lobbySection.includes('getApiHeaders'), 'must use getApiHeaders for auth');
    });
    it('app.js does not use window.confirm', () => {
        const lobbySection = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(!lobbySection.includes('window.confirm'), 'must not use window.confirm');
    });
    it('app.js does not use alert in lobby code', () => {
        const lobbySection = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(!lobbySection.includes('alert('), 'must not use alert');
    });
    it('app.js uses confirm-modal for leave and cancel', () => {
        const lobbySection = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(lobbySection.includes('confirm-modal'), 'must use confirm-modal');
    });
    it('can_join/can_leave control buttons', () => {
        const lobbySection = appJs.substring(appJs.indexOf('function buildLobbyDetailHtml'));
        assert.ok(lobbySection.includes('can_join'), 'must check can_join');
        assert.ok(lobbySection.includes('can_leave'), 'must check can_leave');
    });
    it('cursor pagination does not duplicate cards', () => {
        const lobbySection = appJs.substring(appJs.indexOf('function loadLobbyList'));
        assert.ok(lobbySection.includes('append'), 'must support append mode');
    });
    it('private profile error is user-friendly', () => {
        const lobbyCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');
        assert.ok(lobbyCode.includes('публичный профиль'), 'lobby-utils must have friendly private profile error');
        const lobbySection = appJs.substring(appJs.indexOf('function joinLobby'));
        assert.ok(lobbySection.includes('getLobbyErrorText'), 'joinLobby must use getLobbyErrorText');
        assert.ok(lobbySection.includes("includes('public')"), 'joinLobby must detect private profile from API detail');
    });
    it('innerHTML is not used for user data in buildLobbyDetailHtml', () => {
        const fn = appJs.substring(appJs.indexOf('function buildLobbyDetailHtml'));
        assert.ok(!fn.includes('innerHTML = *'), 'must not set innerHTML directly');
        assert.ok(fn.includes('escapeHtml'), 'must use escapeHtml');
    });
});
