const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');

// --- Minimal DOM mock ---
function createMockDocument() {
    const elements = [];
    const doc = {
        createElement(tag) {
            const el = {
                tagName: tag.toUpperCase(), className: '', textContent: '', innerHTML: '',
                _attrs: {}, _children: [], _src: '',
                setAttribute(k, v) { this._attrs[k] = v; if (k === 'src') this._src = v; },
                getAttribute(k) { return this._attrs[k]; },
                appendChild(child) { this._children.push(child); return child; },
                replaceWith() {}, addEventListener() {}, dataset: {},
            };
            elements.push(el);
            return el;
        },
        _elements: elements,
    };
    return doc;
}

const lobbyCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');
const mockDoc = createMockDocument();
const ctx = {
    module: { exports: {} }, document: mockDoc, URL, URLSearchParams,
    location: { href: 'http://localhost' },
};
vm.createContext(ctx);
vm.runInContext(lobbyCode, ctx);
const L = ctx.RunRouteLobbyUtils || ctx.module.exports;

const lobbyUtilsCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

// --- parsePaceInput ---

describe('parsePaceInput', () => {
    it('accepts mm:ss', () => {
        assert.equal(L.parsePaceInput('5:00'), 300);
        assert.equal(L.parsePaceInput('05:00'), 300);
        assert.equal(L.parsePaceInput('0:45'), 45);
    });
    it('accepts plain integer seconds', () => {
        assert.equal(L.parsePaceInput('300'), 300);
        assert.equal(L.parsePaceInput('0'), 0);
    });
    it('rejects empty/whitespace', () => {
        assert.equal(L.parsePaceInput(''), null);
        assert.equal(L.parsePaceInput('   '), null);
    });
    it('rejects non-numeric text', () => {
        assert.equal(L.parsePaceInput('abc'), null);
        assert.equal(L.parsePaceInput('5x:30'), null);
    });
    it('rejects trailing letters on integer', () => {
        assert.equal(L.parsePaceInput('300abc'), null);
        assert.equal(L.parsePaceInput('5min'), null);
    });
    it('rejects single-digit seconds in mm:ss (5:3 not valid)', () => {
        assert.equal(L.parsePaceInput('5:3'), null);
    });
    it('rejects seconds >= 60 in mm:ss', () => {
        assert.equal(L.parsePaceInput('5:60'), null);
        assert.equal(L.parsePaceInput('5:99'), null);
    });
    it('rejects minutes > 59 in mm:ss', () => {
        assert.equal(L.parsePaceInput('60:00'), null);
    });
    it('rejects negative values', () => {
        assert.equal(L.parsePaceInput('-5'), null);
        assert.equal(L.parsePaceInput('-5:00'), null);
    });
    it('rejects NaN/Infinity inputs', () => {
        assert.equal(L.parsePaceInput('NaN'), null);
        assert.equal(L.parsePaceInput('Infinity'), null);
    });
    it('rejects floating point', () => {
        assert.equal(L.parsePaceInput('5.5'), null);
    });
    it('rejects exponent notation', () => {
        assert.equal(L.parsePaceInput('5e2'), null);
    });
});

// --- validateStrictInteger ---

describe('validateStrictInteger', () => {
    it('accepts empty', () => assert.ok(L.validateStrictInteger('', 1, 100)));
    it('accepts valid integer string', () => assert.ok(L.validateStrictInteger('10', 2, 100)));
    it('rejects exponent notation', () => assert.ok(!L.validateStrictInteger('5e2', 2, 100)));
    it('rejects float string', () => assert.ok(!L.validateStrictInteger('5.5', 2, 100)));
    it('rejects non-numeric', () => assert.ok(!L.validateStrictInteger('abc', 2, 100)));
    it('rejects out of range', () => assert.ok(!L.validateStrictInteger('1', 2, 100)));
    it('rejects negative when min > 0', () => assert.ok(!L.validateStrictInteger('-1', 1, 100)));
});

// --- parseStrictInteger ---

describe('parseStrictInteger', () => {
    it('returns undefined for empty', () => assert.equal(L.parseStrictInteger(''), undefined));
    it('returns number for valid', () => assert.equal(L.parseStrictInteger('10'), 10));
    it('returns NaN for exponent', () => assert.ok(isNaN(L.parseStrictInteger('5e2'))));
    it('returns NaN for float', () => assert.ok(isNaN(L.parseStrictInteger('5.5'))));
});

// --- validateCapacity ---

describe('validateCapacity', () => {
    it('accepts 2-100', () => {
        assert.ok(L.validateCapacity(2));
        assert.ok(L.validateCapacity(50));
        assert.ok(L.validateCapacity(100));
    });
    it('rejects out of range', () => {
        assert.ok(!L.validateCapacity(1));
        assert.ok(!L.validateCapacity(101));
    });
    it('rejects non-integer', () => assert.ok(!L.validateCapacity(5.5)));
    it('rejects exponent string', () => assert.ok(!L.validateCapacity('5e2')));
});

// --- validateDistanceM ---

describe('validateDistanceM', () => {
    it('accepts empty', () => assert.ok(L.validateDistanceM('')));
    it('accepts positive integer', () => assert.ok(L.validateDistanceM('5000')));
    it('rejects zero', () => assert.ok(!L.validateDistanceM('0')));
    it('rejects negative', () => assert.ok(!L.validateDistanceM('-100')));
    it('rejects float', () => assert.ok(!L.validateDistanceM('5.5')));
    it('rejects exponent', () => assert.ok(!L.validateDistanceM('5e2')));
});

// --- validateDuration ---

describe('validateDuration', () => {
    it('accepts 1-1440', () => {
        assert.ok(L.validateDuration('1'));
        assert.ok(L.validateDuration('60'));
        assert.ok(L.validateDuration('1440'));
    });
    it('rejects 0', () => assert.ok(!L.validateDuration('0')));
    it('rejects 1441', () => assert.ok(!L.validateDuration('1441')));
    it('rejects exponent', () => assert.ok(!L.validateDuration('5e2')));
});

// --- getFirstRoutePoint ---

describe('getFirstRoutePoint', () => {
    it('returns first valid point', () => {
        const r = { points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }] };
        const pt = L.getFirstRoutePoint(r);
        assert.equal(pt.lat, 55.7);
    });
    it('skips invalid and returns first valid', () => {
        const r = { points: [{ lat: NaN, lng: 37.6 }, null, { lat: 55.8, lng: 37.7 }] };
        assert.equal(L.getFirstRoutePoint(r).lat, 55.8);
    });
    it('skips out-of-range', () => {
        const r = { points: [{ lat: 999, lng: 37.6 }, { lat: 55.8, lng: 37.7 }] };
        assert.equal(L.getFirstRoutePoint(r).lat, 55.8);
    });
    it('returns null for no valid', () => {
        assert.equal(L.getFirstRoutePoint({ points: [null, 'bad'] }), null);
    });
    it('returns null for null/empty', () => {
        assert.equal(L.getFirstRoutePoint(null), null);
        assert.equal(L.getFirstRoutePoint({ points: [] }), null);
    });
});

// --- lobbyCoordsValid ---

describe('lobbyCoordsValid', () => {
    it('accepts valid', () => assert.ok(L.lobbyCoordsValid(55.75, 37.62)));
    it('rejects NaN', () => assert.ok(!L.lobbyCoordsValid(NaN, 37.62)));
    it('rejects out of range', () => assert.ok(!L.lobbyCoordsValid(999, 37.62)));
    it('rejects non-number', () => assert.ok(!L.lobbyCoordsValid('55', 37.62)));
});

// --- buildLobbyQueryParams ---

describe('buildLobbyQueryParams', () => {
    it('with period 7 includes to ~7 days ahead', () => {
        const p = L.buildLobbyQueryParams({}, '7', null);
        assert.ok(p.has('to'));
        const diff = (new Date(p.get('to')) - new Date()) / (1000 * 60 * 60 * 24);
        assert.ok(diff >= 6.9 && diff <= 7.1);
    });
    it('empty period omits to', () => assert.ok(!L.buildLobbyQueryParams({}, '', null).has('to')));
    it('includes filters and cursor', () => {
        const p = L.buildLobbyQueryParams({ city: 'M', run_type: 'easy' }, '7', 'abc');
        assert.equal(p.get('city'), 'M');
        assert.equal(p.get('run_type'), 'easy');
        assert.equal(p.get('cursor'), 'abc');
    });
});

// --- buildLobbyCreatePayload ---

describe('buildLobbyCreatePayload', () => {
    it('includes required fields', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'Moscow', meetingLat: 55.75, meetingLng: 37.62
        });
        assert.equal(p.title, 'T');
        assert.equal(p.meeting_lat, 55.75);
    });
    it('passes through numeric values as-is', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'M', meetingLat: 55, meetingLng: 37,
            distanceM: 5000, capacity: 15, durationMinutes: 60, paceMin: 300, paceMax: 420
        });
        assert.equal(p.distance_m, 5000);
        assert.equal(p.capacity, 15);
        assert.equal(p.duration_minutes, 60);
    });
});

// --- escapeHtml / getLobbyErrorText / isPrivateProfileError ---

describe('escapeHtml', () => {
    it('escapes dangerous chars', () => {
        const r = L.escapeHtml('<script>"</script>');
        assert.ok(!r.includes('<'));
        assert.ok(r.includes('&lt;'));
    });
    it('handles null', () => assert.equal(L.escapeHtml(null), ''));
});

describe('getLobbyErrorText', () => {
    it('returns strings for all codes', () => {
        [400, 401, 403, 404, 409, 422].forEach(c => assert.equal(typeof L.getLobbyErrorText(c), 'string'));
    });
    it('private profile returns friendly text', () => {
        assert.ok(L.getLobbyErrorText(400, 'Profile must be public').includes('публичный профиль'));
    });
});

describe('isPrivateProfileError', () => {
    it('detects 400+public', () => assert.ok(L.isPrivateProfileError(400, 'Profile must be public')));
    it('rejects 409', () => assert.ok(!L.isPrivateProfileError(409, 'Profile must be public')));
});

// --- Production code regression ---

describe('lobby production code regression', () => {
    it('index.html structure', () => {
        assert.ok(indexHtml.includes('menu-lobby'));
        assert.ok(indexHtml.includes('lobby-panel'));
        assert.ok(indexHtml.includes('lobby-form-route-add-btn'));
    });
    it('lobby-utils.js loads before app.js', () => {
        const l = indexHtml.indexOf('lobby-utils.js');
        const a = indexHtml.indexOf('src="app.js"');
        assert.ok(l > 0 && l < a);
    });
    it('app.js has all lobby functions', () => {
        ['initLobby', 'openLobbyPanel', 'openLobbyDetail', 'submitLobbyCreate',
         'joinLobby', 'leaveLobbyAction', 'cancelLobbyAction', 'refreshLobbyListItem',
         'useRouteStartForLobby', 'useGpsForLobby', 'loadMoreLobbies',
         'resetLobbyCreateForm', '_useBrowserGeolocation'
        ].forEach(fn => assert.ok(appJs.includes('function ' + fn), 'missing ' + fn));
        assert.ok(lobbyUtilsCode.includes('lobbyCoordsValid'), 'missing lobbyCoordsValid in lobby-utils');
    });
    it('lobbyBusyActions prevents double actions', () => {
        assert.ok(appJs.includes('lobbyBusyActions'));
        assert.ok(appJs.includes('lobbyIsBusy'));
        assert.ok(appJs.includes('lobbySetBusy'));
        assert.ok(appJs.includes('lobbyClearBusy'));
    });
    it('resetLobbyCreateForm clears all fields', () => {
        const fn = appJs.substring(appJs.indexOf('function resetLobbyCreateForm'), appJs.indexOf('\nasync function openLobbyCreateForm'));
        assert.ok(fn.includes('lobby-form-title'));
        assert.ok(fn.includes('lobby-form-city'));
        assert.ok(fn.includes('lobby-form-capacity'));
        assert.ok(fn.includes('lobby-form-pace-min'));
        assert.ok(fn.includes('lobby-form-desc'));
    });
    it('GPS uses Telegram LocationManager first', () => {
        const fn = appJs.substring(appJs.indexOf('function useGpsForLobby'));
        assert.ok(fn.includes('LocationManager'));
        assert.ok(fn.includes('_useBrowserGeolocation'));
    });
    it('validates coords in GPS callbacks', () => {
        const fn = appJs.substring(appJs.indexOf('function _useBrowserGeolocation'));
        assert.ok(fn.includes('lobbyCoordsValid'));
    });
    it('join/leave/cancel use single detail fetch', () => {
        const joinFn = appJs.substring(appJs.indexOf('async function joinLobby'));
        assert.ok(joinFn.includes('Promise.all') || joinFn.includes('lobbyResp'), 'must not call openLobbyDetail');
        assert.ok(!joinFn.includes('await openLobbyDetail'), 'join must not call openLobbyDetail');
    });
    it('cancel awaits loadLobbyList', () => {
        const fn = appJs.substring(appJs.indexOf('async function cancelLobbyAction'));
        assert.ok(fn.includes('await loadLobbyList'));
    });
    it('submitLobbyCreate uses parseStrictInteger', () => {
        const fn = appJs.substring(appJs.indexOf('async function submitLobbyCreate'));
        assert.ok(fn.includes('parseStrictInteger'));
        assert.ok(!fn.includes('parseInt(distanceM)'));
        assert.ok(!fn.includes('parseInt(capacity)'));
    });
    it('submitLobbyCreate resets form after success', () => {
        const fn = appJs.substring(appJs.indexOf('async function submitLobbyCreate'));
        assert.ok(fn.includes('resetLobbyCreateForm'));
    });
    it('finally always restores submit button', () => {
        const fn = appJs.substring(appJs.indexOf('async function submitLobbyCreate'));
        assert.ok(fn.includes('finally'));
        assert.ok(fn.includes('lobbyClearBusy'));
    });
    it('openLobbyDetail uses Promise.all for parallel fetch', () => {
        const fn = appJs.substring(appJs.indexOf('async function openLobbyDetail'));
        assert.ok(fn.includes('Promise.all'));
    });
    it('safeAvatar wraps URL in try/catch', () => {
        const fn = appJs.substring(appJs.indexOf('function safeAvatar'));
        assert.ok(fn.includes('try'));
        assert.ok(fn.includes('catch'));
    });
    it('no window.confirm or alert in lobby code', () => {
        const section = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(!section.includes('window.confirm'));
        assert.ok(!section.includes('alert('));
    });
    it('buildLobbyDetailDom uses safeCreateEl and textContent', () => {
        const fn = appJs.substring(appJs.indexOf('function buildLobbyDetailDom'));
        assert.ok(fn.includes('safeCreateEl'));
        assert.ok(fn.includes('textContent'));
    });
    it('no innerHTML assignment in buildLobbyDetailDom', () => {
        const start = appJs.indexOf('function buildLobbyDetailDom');
        const end = appJs.indexOf('\nfunction ', start + 10);
        const fn = appJs.substring(start, end > start ? end : start + 3000);
        assert.ok(!fn.includes('innerHTML'), 'buildLobbyDetailDom must not use innerHTML');
    });
    it('refreshLobbyListItem accepts lobby param', () => {
        const fn = appJs.substring(appJs.indexOf('function refreshLobbyListItem'));
        assert.ok(fn.includes('lobby)') || fn.includes('lobby ='), 'must accept lobby param');
    });
});
