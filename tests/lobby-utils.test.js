const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// --- Minimal DOM mock for lobby-utils.js ---
function createMockDocument() {
    const elements = [];
    const doc = {
        createElement(tag) {
            const el = {
                tagName: tag.toUpperCase(),
                className: '',
                textContent: '',
                innerHTML: '',
                _attrs: {},
                _children: [],
                setAttribute(k, v) { this._attrs[k] = v; },
                getAttribute(k) { return this._attrs[k]; },
                appendChild(child) { this._children.push(child); return child; },
                replaceWith() {},
                addEventListener() {},
                dataset: {},
            };
            elements.push(el);
            return el;
        },
        _elements: elements,
    };
    return doc;
}

// Load lobby-utils.js with a mocked DOM context
const lobbyCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');
const mockDoc = createMockDocument();
const ctx = {
    module: { exports: {} },
    document: mockDoc,
    URL: URL,
    URLSearchParams: URLSearchParams,
    location: { href: 'http://localhost' },
};
vm.createContext(ctx);
vm.runInContext(lobbyCode, ctx);
const L = ctx.RunRouteLobbyUtils || ctx.module.exports;

const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');
const lobbyUtilsCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');

// --- formatRunType ---

describe('formatRunType', () => {
    it('formats all 8 types', () => {
        assert.equal(L.formatRunType('easy'), 'Лёгкая');
        assert.equal(L.formatRunType('recovery'), 'Восстановительная');
        assert.equal(L.formatRunType('long'), 'Длительная');
        assert.equal(L.formatRunType('tempo'), 'Темповая');
        assert.equal(L.formatRunType('intervals'), 'Интервалы');
        assert.equal(L.formatRunType('hills'), 'Горки');
        assert.equal(L.formatRunType('trail'), 'Трейл');
        assert.equal(L.formatRunType('other'), 'Другая');
    });
    it('returns raw for unknown', () => assert.equal(L.formatRunType('sprint'), 'sprint'));
    it('returns empty for null', () => assert.equal(L.formatRunType(null), ''));
});

// --- formatLobbyDate ---

describe('formatLobbyDate', () => {
    it('formats ISO date to Russian locale', () => {
        const result = L.formatLobbyDate('2027-12-01T09:00:00+03:00');
        assert.ok(typeof result === 'string');
        assert.ok(result.length > 5);
    });
    it('returns empty for null/undefined', () => {
        assert.equal(L.formatLobbyDate(null), '');
        assert.equal(L.formatLobbyDate(undefined), '');
    });
});

// --- formatParticipants ---

describe('formatParticipants', () => {
    it('formats count/capacity', () => assert.equal(L.formatParticipants(5, 10), '5 / 10'));
    it('handles null capacity', () => assert.equal(L.formatParticipants(5, null), '5'));
    it('handles zero count', () => assert.equal(L.formatParticipants(0, 10), '0 / 10'));
});

// --- parsePaceInput ---

describe('parsePaceInput', () => {
    it('parses mm:ss', () => {
        assert.equal(L.parsePaceInput('5:00'), 300);
        assert.equal(L.parsePaceInput('7:30'), 450);
        assert.equal(L.parsePaceInput('0:45'), 45);
    });
    it('parses plain seconds', () => assert.equal(L.parsePaceInput('300'), 300));
    it('returns null for empty/invalid', () => {
        assert.equal(L.parsePaceInput(''), null);
        assert.equal(L.parsePaceInput('abc'), null);
        assert.equal(L.parsePaceInput('5:60'), null);
    });
});

// --- validatePaceInput ---

describe('validatePaceInput', () => {
    it('accepts empty as valid', () => {
        const r = L.validatePaceInput('');
        assert.ok(r.valid);
        assert.equal(r.value, null);
    });
    it('accepts 5:00 (300s) as valid', () => {
        const r = L.validatePaceInput('5:00');
        assert.ok(r.valid);
        assert.equal(r.value, 300);
    });
    it('rejects abc as invalid', () => {
        assert.ok(!L.validatePaceInput('abc').valid);
    });
    it('rejects 5:60 as invalid', () => {
        assert.ok(!L.validatePaceInput('5:60').valid);
    });
    it('rejects 1:30 (90s) as too fast', () => {
        const r = L.validatePaceInput('1:30');
        assert.ok(!r.valid);
        assert.ok(r.error.includes('от 2:00'));
    });
    it('rejects 31:00 (1860s) as too slow', () => {
        const r = L.validatePaceInput('31:00');
        assert.ok(!r.valid);
        assert.ok(r.error.includes('до 30:00'));
    });
    it('accepts 2:00 (120s) boundary', () => {
        assert.ok(L.validatePaceInput('2:00').valid);
    });
    it('accepts 30:00 (1800s) boundary', () => {
        assert.ok(L.validatePaceInput('30:00').valid);
    });
});

// --- formatPaceInput ---

describe('formatPaceInput', () => {
    it('formats seconds to mm:ss', () => {
        assert.equal(L.formatPaceInput(300), '5:00');
        assert.equal(L.formatPaceInput(45), '0:45');
    });
    it('returns empty for null', () => assert.equal(L.formatPaceInput(null), ''));
});

// --- validateFutureDate ---

describe('validateFutureDate', () => {
    it('accepts future', () => {
        const d = new Date(); d.setFullYear(d.getFullYear() + 1);
        assert.ok(L.validateFutureDate(d.toISOString()));
    });
    it('rejects past', () => {
        const d = new Date(); d.setFullYear(d.getFullYear() - 1);
        assert.ok(!L.validateFutureDate(d.toISOString()));
    });
    it('rejects null/invalid', () => {
        assert.ok(!L.validateFutureDate(null));
        assert.ok(!L.validateFutureDate('not-a-date'));
    });
});

// --- validateCapacity ---

describe('validateCapacity', () => {
    it('accepts 2-100', () => {
        assert.ok(L.validateCapacity(2));
        assert.ok(L.validateCapacity(10));
        assert.ok(L.validateCapacity(100));
    });
    it('rejects out of range', () => {
        assert.ok(!L.validateCapacity(1));
        assert.ok(!L.validateCapacity(101));
        assert.ok(!L.validateCapacity(5.5));
    });
});

// --- validateDistanceM ---

describe('validateDistanceM', () => {
    it('accepts empty', () => assert.ok(L.validateDistanceM('')));
    it('accepts positive integer', () => assert.ok(L.validateDistanceM('5000')));
    it('rejects zero', () => assert.ok(!L.validateDistanceM('0')));
    it('rejects negative', () => assert.ok(!L.validateDistanceM('-100')));
    it('rejects float', () => assert.ok(!L.validateDistanceM('5.5')));
});

// --- validateDuration ---

describe('validateDuration', () => {
    it('accepts empty', () => assert.ok(L.validateDuration('')));
    it('accepts 1-1440', () => {
        assert.ok(L.validateDuration('1'));
        assert.ok(L.validateDuration('60'));
        assert.ok(L.validateDuration('1440'));
    });
    it('rejects 0', () => assert.ok(!L.validateDuration('0')));
    it('rejects 1441', () => assert.ok(!L.validateDuration('1441')));
});

// --- getFirstRoutePoint ---

describe('getFirstRoutePoint', () => {
    it('returns first valid point', () => {
        const route = { points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }] };
        const pt = L.getFirstRoutePoint(route);
        assert.equal(pt.lat, 55.7);
        assert.equal(pt.lng, 37.6);
    });
    it('skips invalid first point and returns second', () => {
        const route = { points: [{ lat: NaN, lng: 37.6 }, { lat: 55.8, lng: 37.7 }] };
        const pt = L.getFirstRoutePoint(route);
        assert.equal(pt.lat, 55.8);
    });
    it('skips out-of-range lat', () => {
        const route = { points: [{ lat: 999, lng: 37.6 }, { lat: 55.8, lng: 37.7 }] };
        const pt = L.getFirstRoutePoint(route);
        assert.equal(pt.lat, 55.8);
    });
    it('skips string points', () => {
        const route = { points: ['bad', { lat: 55.8, lng: 37.7 }] };
        const pt = L.getFirstRoutePoint(route);
        assert.equal(pt.lat, 55.8);
    });
    it('returns null for no valid points', () => {
        assert.equal(L.getFirstRoutePoint({ points: [{ lat: NaN, lng: NaN }] }), null);
    });
    it('returns null for null/empty', () => {
        assert.equal(L.getFirstRoutePoint(null), null);
        assert.equal(L.getFirstRoutePoint({ points: [] }), null);
    });
});

// --- getLobbyErrorText ---

describe('getLobbyErrorText', () => {
    it('returns text for each status code', () => {
        assert.ok(typeof L.getLobbyErrorText(400) === 'string');
        assert.ok(typeof L.getLobbyErrorText(401) === 'string');
        assert.ok(typeof L.getLobbyErrorText(403) === 'string');
        assert.ok(typeof L.getLobbyErrorText(404) === 'string');
        assert.ok(typeof L.getLobbyErrorText(409) === 'string');
        assert.ok(typeof L.getLobbyErrorText(422) === 'string');
    });
    it('401 mentions authoriztion', () => {
        assert.ok(L.getLobbyErrorText(401).includes('авторизацию'));
    });
    it('403 mentions forbidden', () => {
        assert.ok(L.getLobbyErrorText(403).includes('запрещено'));
    });
    it('404 mentions unavailable', () => {
        assert.ok(L.getLobbyErrorText(404).includes('недоступна'));
    });
    it('409 mentions completed', () => {
        assert.ok(L.getLobbyErrorText(409).includes('завершена'));
    });
    it('private profile returns friendly text', () => {
        assert.ok(L.getLobbyErrorText(400, 'Profile must be public').includes('публичный профиль'));
    });
    it('unknown status returns generic', () => {
        assert.ok(L.getLobbyErrorText(0).includes('недоступен'));
    });
});

// --- isPrivateProfileError ---

describe('isPrivateProfileError', () => {
    it('returns true for 400 + public detail', () => {
        assert.ok(L.isPrivateProfileError(400, 'Profile must be public'));
    });
    it('returns false for other status', () => {
        assert.ok(!L.isPrivateProfileError(409, 'Profile must be public'));
    });
    it('returns false for other detail', () => {
        assert.ok(!L.isPrivateProfileError(400, 'Bad request'));
    });
});

// --- escapeHtml ---

describe('escapeHtml', () => {
    it('escapes dangerous chars', () => {
        const r = L.escapeHtml('<script>alert("xss")</script>');
        assert.ok(!r.includes('<script>'));
        assert.ok(r.includes('&lt;'));
        assert.ok(r.includes('&quot;'));
    });
    it('handles null/undefined', () => {
        assert.equal(L.escapeHtml(null), '');
        assert.equal(L.escapeHtml(undefined), '');
    });
});

// --- buildLobbyQueryParams ---

describe('buildLobbyQueryParams', () => {
    it('first open with 7-day period includes to', () => {
        const params = L.buildLobbyQueryParams({}, '7', null);
        assert.ok(params.has('to'));
        const to = new Date(params.get('to'));
        const now = new Date();
        const diffDays = (to - now) / (1000 * 60 * 60 * 24);
        assert.ok(diffDays >= 6.9 && diffDays <= 7.1, 'to should be ~7 days from now');
    });
    it('empty period does not include to', () => {
        const params = L.buildLobbyQueryParams({}, '', null);
        assert.ok(!params.has('to'));
    });
    it('null period does not include to', () => {
        const params = L.buildLobbyQueryParams({}, null, null);
        assert.ok(!params.has('to'));
    });
    it('includes city and run_type filters', () => {
        const params = L.buildLobbyQueryParams({ city: 'Moscow', run_type: 'easy' }, '7', null);
        assert.equal(params.get('city'), 'Moscow');
        assert.equal(params.get('run_type'), 'easy');
    });
    it('includes cursor', () => {
        const params = L.buildLobbyQueryParams({}, '7', 'abc123');
        assert.equal(params.get('cursor'), 'abc123');
    });
    it('no cursor when null', () => {
        const params = L.buildLobbyQueryParams({}, '7', null);
        assert.ok(!params.has('cursor'));
    });
});

// --- buildLobbyCreatePayload ---

describe('buildLobbyCreatePayload', () => {
    it('builds required fields', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'Moscow', meetingLat: 55.75, meetingLng: 37.62
        });
        assert.equal(p.title, 'T');
        assert.equal(p.run_type, 'easy');
        assert.equal(p.city, 'Moscow');
        assert.equal(p.meeting_lat, 55.75);
    });
    it('includes optional fields when set', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'Moscow', meetingLat: 55.75, meetingLng: 37.62,
            paceMin: 300, paceMax: 420, capacity: 15, distanceM: 5000
        });
        assert.equal(p.pace_min_sec_per_km, 300);
        assert.equal(p.capacity, 15);
        assert.equal(p.distance_m, 5000);
    });
    it('omits undefined optional fields', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'Moscow', meetingLat: 55.75, meetingLng: 37.62
        });
        assert.ok(!('pace_min_sec_per_km' in p));
        assert.ok(!('capacity' in p));
    });
});

// --- renderLobbyCard (DOM element) ---

describe('renderLobbyCard', () => {
    function mockSafeCreateEl(tag, attrs) {
        const el = { tagName: tag, className: '', textContent: '', innerHTML: '', _children: [], _attrs: {} };
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'textContent') el.textContent = v;
                else if (k === 'className') el.className = v;
                else el._attrs[k] = v;
            }
        }
        el.appendChild = (child) => { el._children.push(child); return child; };
        return el;
    }
    function mockSafeAvatar(url, size) {
        return mockSafeCreateEl('div', { className: 'avatar' });
    }

    it('returns a DOM element with correct data-lobby-id', () => {
        const lobby = {
            id: 'abc-123', title: 'Test Run', run_type: 'easy',
            starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow',
            participant_count: 3, capacity: 10,
            organizer: { display_name: 'Org', avatar_url: null }
        };
        const card = L.renderLobbyCard(lobby, mockSafeCreateEl, mockSafeAvatar);
        assert.equal(card.tagName, 'div');
        assert.equal(card._attrs['data-lobby-id'], 'abc-123');
        assert.ok(card.className.includes('lobby-card'));
    });
    it('uses textContent for user data, not innerHTML', () => {
        const lobby = {
            id: '1', title: '<script>alert(1)</script>', run_type: 'easy',
            starts_at: '2027-12-01T09:00:00+03:00', city: 'City',
            participant_count: 1, capacity: 5,
            organizer: { display_name: '<img onerror=x>', avatar_url: null }
        };
        const card = L.renderLobbyCard(lobby, mockSafeCreateEl, mockSafeAvatar);
        const titleEl = card._children[0]._children[0];
        assert.equal(titleEl.textContent, '<script>alert(1)</script>');
        assert.ok(!titleEl.innerHTML.includes('<script'));
    });
});

// --- Production code regression ---

describe('lobby production code regression', () => {
    it('index.html has lobby menu item and panel', () => {
        assert.ok(indexHtml.includes('menu-lobby'));
        assert.ok(indexHtml.includes('Совместные пробежки'));
        assert.ok(indexHtml.includes('id="lobby-panel"'));
    });
    it('index.html loads lobby-utils.js before app.js', () => {
        const lIdx = indexHtml.indexOf('lobby-utils.js');
        const aIdx = indexHtml.indexOf('src="app.js"');
        assert.ok(lIdx > 0 && lIdx < aIdx, 'lobby-utils.js must load before app.js');
    });
    it('app.js has all lobby functions', () => {
        const fns = ['initLobby', 'openLobbyPanel', 'openLobbyDetail', 'submitLobbyCreate',
            'joinLobby', 'leaveLobbyAction', 'cancelLobbyAction', 'refreshLobbyListItem',
            'useRouteStartForLobby', 'useGpsForLobby', 'loadMoreLobbies'];
        fns.forEach(fn => assert.ok(appJs.includes('function ' + fn), 'missing ' + fn));
    });
    it('lobby code uses getApiHeaders for auth', () => {
        const section = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(section.includes('getApiHeaders'));
    });
    it('lobby code does not use window.confirm or alert', () => {
        const section = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(!section.includes('window.confirm'));
        assert.ok(!section.includes('alert('));
    });
    it('lobby code uses confirm-modal for leave/cancel', () => {
        const section = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(section.includes('confirm-modal'));
    });
    it('can_join/can_leave control buttons in buildLobbyDetailDom', () => {
        const fn = appJs.substring(appJs.indexOf('function buildLobbyDetailDom'));
        assert.ok(fn.includes('can_join'));
        assert.ok(fn.includes('can_leave'));
    });
    it('event delegation on lobby-list-items', () => {
        assert.ok(appJs.includes("getElementById('lobby-list-items')"));
        assert.ok(appJs.includes('.lobby-card'));
    });
    it('lobbyShownIds Set prevents duplicates', () => {
        assert.ok(appJs.includes('lobbyShownIds'));
        assert.ok(appJs.includes('lobbyShownIds.has'));
        assert.ok(appJs.includes('lobbyShownIds.add'));
    });
    it('request token prevents stale responses', () => {
        assert.ok(appJs.includes('lobbyRequestToken'));
    });
    it('refreshLobbyListItem updates card after action', () => {
        assert.ok(appJs.includes('function refreshLobbyListItem'));
        assert.ok(appJs.includes('replaceWith'));
    });
    it('useRouteStartForLobby button exists', () => {
        assert.ok(appJs.includes('function useRouteStartForLobby'));
        assert.ok(indexHtml.includes('lobby-form-route-add-btn'));
    });
    it('GPS uses lastKnownLocation as primary source', () => {
        const fn = appJs.substring(appJs.indexOf('function useGpsForLobby'));
        assert.ok(fn.includes('lastKnownLocation'));
    });
    it('validatePaceInput blocks invalid pace before POST', () => {
        const fn = appJs.substring(appJs.indexOf('function submitLobbyCreate'));
        assert.ok(fn.includes('validatePaceInput'));
        assert.ok(fn.includes('paceMinResult.valid'));
    });
    it('finally restores submit button', () => {
        const fn = appJs.substring(appJs.indexOf('function submitLobbyCreate'));
        assert.ok(fn.includes('finally'));
    });
    it('isPrivateProfileError used in join and create', () => {
        const joinFn = appJs.substring(appJs.indexOf('function joinLobby'));
        assert.ok(joinFn.includes('isPrivateProfileError') || joinFn.includes('lobbyHandlePrivateProfile'));
    });
    it('buildLobbyDetailDom uses createElement/textContent', () => {
        const fn = appJs.substring(appJs.indexOf('function buildLobbyDetailDom'));
        assert.ok(fn.includes('safeCreateEl'));
        assert.ok(fn.includes('textContent'));
    });
    it('no innerHTML used for user data in detail', () => {
        const start = appJs.indexOf('function buildLobbyDetailDom');
        const end = appJs.indexOf('\nfunction ', start + 10);
        const fn = appJs.substring(start, end > start ? end : start + 3000);
        assert.ok(!fn.includes('innerHTML'), 'buildLobbyDetailDom must not use innerHTML');
    });
    it('lobby code does not contain dangerous innerHTML patterns', () => {
        const section = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(!section.includes("' <img"), 'no img in HTML string');
        assert.ok(!section.includes("' <script"), 'no script in HTML string');
    });
});
