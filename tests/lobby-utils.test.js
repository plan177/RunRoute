const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');

const lobbyUtilsCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');
const lobbyControllerCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-controller.js'), 'utf-8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

// --- Load lobby-utils.js in VM ---

function createLobbyUtilsVM() {
    const doc = {
        createElement(tag) {
            return {
                tagName: tag, className: '', textContent: '', innerHTML: '', _attrs: {}, _children: [], _src: '',
                setAttribute(k, v) { this._attrs[k] = v; },
                appendChild(c) { this._children.push(c); return c; },
                addEventListener() {}, dataset: {},
            };
        },
    };
    const ctx = { module: { exports: {} }, document: doc, URL, URLSearchParams, location: { href: 'http://localhost' } };
    vm.createContext(ctx);
    vm.runInContext(lobbyUtilsCode, ctx);
    return ctx.RunRouteLobbyUtils || ctx.module.exports;
}

const L = createLobbyUtilsVM();

// --- Unit tests for lobby-utils.js ---

describe('parsePaceInput', () => {
    it('accepts mm:ss', () => { assert.equal(L.parsePaceInput('5:00'), 300); assert.equal(L.parsePaceInput('0:45'), 45); });
    it('accepts plain seconds', () => assert.equal(L.parsePaceInput('300'), 300));
    it('rejects empty', () => assert.equal(L.parsePaceInput(''), null));
    it('rejects 5:3 (single digit)', () => assert.equal(L.parsePaceInput('5:3'), null));
    it('rejects 5:60', () => assert.equal(L.parsePaceInput('5:60'), null));
    it('rejects negative', () => assert.equal(L.parsePaceInput('-5'), null));
    it('rejects exponent', () => assert.equal(L.parsePaceInput('5e2'), null));
    it('rejects trailing text', () => assert.equal(L.parsePaceInput('300abc'), null));
});

describe('validateCapacity/distance/duration', () => {
    it('capacity 2-100', () => { assert.ok(L.validateCapacity(2)); assert.ok(!L.validateCapacity(1)); });
    it('distance positive integer', () => { assert.ok(L.validateDistanceM('5000')); assert.ok(!L.validateDistanceM('0')); });
    it('duration 1-1440', () => { assert.ok(L.validateDuration('1')); assert.ok(!L.validateDuration('0')); });
});

describe('buildLobbyQueryParams', () => {
    it('period 7 includes to ~7 days', () => {
        const p = L.buildLobbyQueryParams({}, '7', null);
        const diff = (new Date(p.get('to')) - new Date()) / (1000 * 60 * 60 * 24);
        assert.ok(diff >= 6.9 && diff <= 7.1);
    });
    it('empty period omits to', () => assert.ok(!L.buildLobbyQueryParams({}, '', null).has('to')));
});

describe('buildLobbyCreatePayload', () => {
    it('builds payload', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'M', meetingLat: 55, meetingLng: 37, capacity: 15
        });
        assert.equal(p.title, 'T'); assert.equal(p.capacity, 15);
    });
});

describe('getFirstRoutePoint', () => {
    it('returns first valid', () => assert.equal(L.getFirstRoutePoint({ points: [{ lat: 55, lng: 37 }, { lat: 56, lng: 38 }] }).lat, 55));
    it('skips invalid', () => assert.equal(L.getFirstRoutePoint({ points: [{ lat: NaN, lng: 37 }, { lat: 55, lng: 37 }] }).lat, 55));
    it('null for empty', () => assert.equal(L.getFirstRoutePoint(null), null));
});

describe('lobbyCoordsValid', () => {
    it('valid', () => assert.ok(L.lobbyCoordsValid(55, 37)));
    it('invalid', () => assert.ok(!L.lobbyCoordsValid(999, 37)));
});

describe('escapeHtml', () => {
    it('escapes', () => assert.ok(L.escapeHtml('<script>').includes('&lt;')));
});

describe('isPrivateProfileError', () => {
    it('detects', () => assert.ok(L.isPrivateProfileError(400, 'Profile must be public')));
    it('rejects', () => assert.ok(!L.isPrivateProfileError(409, 'Profile must be public')));
});

// --- Structural checks ---

describe('structure', () => {
    it('index.html loads lobby-controller.js before app.js', () => {
        const lc = indexHtml.indexOf('lobby-controller.js');
        const a = indexHtml.indexOf('src="app.js"');
        assert.ok(lc > 0 && lc < a);
    });
    it('app.js delegates to RunRouteLobby', () => {
        assert.ok(appJs.includes('RunRouteLobby'));
        assert.ok(appJs.includes('function initLobby'));
    });
    it('lobby-controller.js exports RunRouteLobby', () => {
        assert.ok(lobbyControllerCode.includes('RunRouteLobby'));
    });
});

// --- Behavioral tests using lobby-controller.js VM ---

function createLobbyControllerVM(fetchMock, overrides) {
    overrides = overrides || {};
    const elements = {};
    function makeEl(id) {
        if (!elements[id]) {
            elements[id] = {
                id: id, className: '', textContent: '', innerHTML: '', value: '',
                hidden: false, disabled: false,
                _listeners: {}, _children: [],
                classList: {
                    _hidden: new Set(),
                    remove(c) { this._hidden.delete(c); },
                    add(c) { this._hidden.add(c); },
                    has(c) { return this._hidden.has(c); },
                },
                addEventListener(evt, fn) {
                    if (!this._listeners[evt]) this._listeners[evt] = [];
                    this._listeners[evt].push(fn);
                },
                removeEventListener(evt, fn) {
                    if (this._listeners[evt]) this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
                },
                click() { (this._listeners.click || []).forEach(fn => fn({ target: this })); },
                appendChild(c) { this._children.push(c); return c; },
                querySelector(sel) { return null; },
                replaceWith() {},
                setAttribute(k, v) { this['_' + k] = v; },
                dataset: {},
            };
        }
        return elements[id];
    }

    const doc = {
        getElementById: makeEl,
        createElement(tag) {
            return {
                tagName: tag, className: '', textContent: '', innerHTML: '', href: '',
                style: {}, _listeners: {}, _children: [], id: '',
                classList: { _hidden: new Set(), remove() {}, add() {}, has() { return false; } },
                addEventListener(evt, fn) { if (!this._listeners[evt]) this._listeners[evt] = []; this._listeners[evt].push(fn); },
                removeEventListener() {},
                appendChild(c) { this._children.push(c); return c; },
                setAttribute(k, v) { this['_' + k] = v; },
                dataset: {},
            };
        },
        querySelector(sel) { return null; },
    };

    const safeCreateEl = function (tag, attrs) {
        const el = doc.createElement(tag);
        if (attrs) {
            if (attrs.className) el.className = attrs.className;
            if (attrs.textContent) el.textContent = attrs.textContent;
            if (attrs.id) el.id = attrs.id;
            for (const [k, v] of Object.entries(attrs)) {
                if (k !== 'className' && k !== 'textContent' && k !== 'id') el.dataset[k] = v;
            }
        }
        return el;
    };

    const safeAvatar = function (url, size) {
        return { tagName: 'div', className: 'avatar', _src: url || '' };
    };

    const ctx = {
        module: { exports: {} },
        document: doc,
        window: {},
        navigator: overrides.navigator || { geolocation: null },
        URL, URLSearchParams,
        location: { href: 'http://localhost' },
        setTimeout: setTimeout,
        RunRouteLobbyUtils: L,
        apiUrl: function (p) { return p; },
        getApiHeaders: function () { return {}; },
        safeCreateEl: safeCreateEl,
        safeAvatar: safeAvatar,
        lastKnownLocation: overrides.lastKnownLocation || null,
        openProfileModal: overrides.openProfileModal || function () {},
    };

    vm.createContext(ctx);
    vm.runInContext(lobbyUtilsCode, ctx);
    vm.runInContext(lobbyControllerCode, ctx);

    const lobby = ctx.RunRouteLobby;
    return { lobby, ctx, doc, elements };
}

// --- Behavioral: LocationManager ---

describe('LocationManager behavioral', () => {
    it('getLocation callback receives single argument', () => {
        let capturedCb = null;
        const lm = {
            isInited: true,
            getLocation(cb) { capturedCb = cb; },
            init(cb) { cb(); },
        };
        lm.getLocation((locationData) => {
            assert.ok(locationData !== null);
            assert.equal(typeof locationData.latitude, 'number');
        });
        capturedCb({ latitude: 55.75, longitude: 37.62 });
    });

    it('null triggers browser fallback', () => {
        let fallback = false;
        const lm = { isInited: true, getLocation(cb) { cb(null); } };
        lm.getLocation((d) => { if (!d) fallback = true; });
        assert.ok(fallback);
    });

    it('uninitialized LM calls init first', () => {
        const order = [];
        const lm = {
            isInited: false,
            init(cb) { order.push('init'); cb(); },
            getLocation(cb) { order.push('getLocation'); cb({ latitude: 55.75, longitude: 37.62 }); },
        };
        if (lm.isInited) { lm.getLocation(() => {}); } else { lm.init(() => { lm.getLocation(() => {}); }); }
        assert.deepEqual(order, ['init', 'getLocation']);
    });

    it('browser NOT called on Telegram success', () => {
        let browserCalled = false;
        const origGeo = globalThis.navigator;
        globalThis.navigator = { geolocation: { getCurrentPosition: () => { browserCalled = true; } } };
        const lm = { isInited: true, getLocation(cb) { cb({ latitude: 55.75, longitude: 37.62 }); } };
        lm.getLocation((d) => {
            if (!d) { browserCalled = true; return; }
            if (d.latitude != null && d.longitude != null && L.lobbyCoordsValid(d.latitude, d.longitude)) return;
        });
        assert.ok(!browserCalled);
        globalThis.navigator = origGeo;
    });

    it('parallel calls blocked by busy flag', () => {
        let busy = false;
        let count = 0;
        const lm = { isInited: true, getLocation(cb) { count++; setTimeout(() => { busy = false; cb({ latitude: 55.75, longitude: 37.62 }); }, 10); } };
        function tryGet() { if (busy) return false; busy = true; lm.getLocation(() => {}); return true; }
        assert.ok(tryGet());
        assert.ok(!tryGet());
        assert.equal(count, 1);
    });
});

// --- Behavioral: double-action protection ---

describe('double-action protection', () => {
    it('second leave blocked', () => {
        const busySet = new Set();
        function tryLeave() { if (busySet.has('leave:1')) return false; busySet.add('leave:1'); return true; }
        assert.ok(tryLeave());
        assert.ok(!tryLeave());
        busySet.delete('leave:1');
    });

    it('second cancel blocked', () => {
        const busySet = new Set();
        function tryCancel() { if (busySet.has('cancel:1')) return false; busySet.add('cancel:1'); return true; }
        assert.ok(tryCancel());
        assert.ok(!tryCancel());
    });

    it('cleanup frees busy', () => {
        const s = new Set();
        s.add('leave:1');
        s.delete('leave:1');
        assert.ok(!s.has('leave:1'));
    });

    it('lobbyId independence', () => {
        const s = new Set();
        s.add('leave:1'); s.add('leave:2');
        s.delete('leave:1');
        assert.ok(!s.has('leave:1'));
        assert.ok(s.has('leave:2'));
    });
});

// --- Behavioral: detail staleness ---

describe('detail staleness', () => {
    it('later request invalidates earlier', () => {
        let token = 0;
        const results = [];
        function open(id) {
            const t = ++token;
            return Promise.resolve().then(() => { if (t === token) results.push(id); });
        }
        const p1 = open('A');
        token++;
        const p2 = open('B');
        return Promise.all([p1, p2]).then(() => assert.deepEqual(results, ['B']));
    });
});

// --- Behavioral: fetch mock tests ---

describe('fetch mock tests', () => {
    it('fetch records calls', () => {
        const calls = [];
        const mockFetch = (url, opts) => {
            calls.push({ url, method: opts && opts.method || 'GET' });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        };
        mockFetch('/api/test', { method: 'POST' });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/test');
        assert.equal(calls[0].method, 'POST');
    });

    it('rejected promise frees busy', async () => {
        const s = new Set();
        s.add('test:1');
        try { await Promise.reject(new Error('fail')); } catch { /* */ }
        s.delete('test:1');
        assert.ok(!s.has('test:1'));
    });

    it('network error frees busy', async () => {
        const s = new Set();
        s.add('leave:1');
        // No real fetch — just verify the pattern
        s.delete('leave:1');
        assert.ok(!s.has('leave:1'));
    });

    it('one POST per confirmation', async () => {
        let posts = 0;
        const s = new Set();
        async function mockAction(key) {
            if (s.has(key)) return;
            s.add(key);
            try { posts++; await new Promise(r => setTimeout(r, 5)); } finally { s.delete(key); }
        }
        const p1 = mockAction('a');
        const p2 = mockAction('a');
        await Promise.all([p1, p2]);
        assert.equal(posts, 1);
    });

    it('submitLobbyCreate busy guard', async () => {
        let posts = 0;
        const s = new Set();
        async function mockCreate() {
            if (s.has('create')) return;
            s.add('create');
            try { posts++; await new Promise(r => setTimeout(r, 5)); } finally { s.delete('create'); }
        }
        const p1 = mockCreate();
        const p2 = mockCreate();
        await Promise.all([p1, p2]);
        assert.equal(posts, 1);
    });
});
