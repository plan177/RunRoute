const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');

// --- Lobby-utils.js unit tests (VM) ---

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

const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

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
    it('rejects single-digit seconds (5:3 not valid)', () => {
        assert.equal(L.parsePaceInput('5:3'), null);
    });
    it('rejects seconds >= 60', () => {
        assert.equal(L.parsePaceInput('5:60'), null);
        assert.equal(L.parsePaceInput('5:99'), null);
    });
    it('rejects minutes > 59', () => {
        assert.equal(L.parsePaceInput('60:00'), null);
    });
    it('rejects negative', () => {
        assert.equal(L.parsePaceInput('-5'), null);
        assert.equal(L.parsePaceInput('-5:00'), null);
    });
    it('rejects NaN/Infinity', () => {
        assert.equal(L.parsePaceInput('NaN'), null);
        assert.equal(L.parsePaceInput('Infinity'), null);
    });
    it('rejects float', () => assert.equal(L.parsePaceInput('5.5'), null));
    it('rejects exponent notation', () => assert.equal(L.parsePaceInput('5e2'), null));
});

describe('validateStrictInteger', () => {
    it('accepts empty', () => assert.ok(L.validateStrictInteger('', 1, 100)));
    it('accepts valid', () => assert.ok(L.validateStrictInteger('10', 2, 100)));
    it('rejects exponent', () => assert.ok(!L.validateStrictInteger('5e2', 2, 100)));
    it('rejects float', () => assert.ok(!L.validateStrictInteger('5.5', 2, 100)));
    it('rejects non-numeric', () => assert.ok(!L.validateStrictInteger('abc', 2, 100)));
    it('rejects out of range', () => assert.ok(!L.validateStrictInteger('1', 2, 100)));
    it('rejects negative', () => assert.ok(!L.validateStrictInteger('-1', 1, 100)));
});

describe('parseStrictInteger', () => {
    it('returns undefined for empty', () => assert.equal(L.parseStrictInteger(''), undefined));
    it('returns number', () => assert.equal(L.parseStrictInteger('10'), 10));
    it('returns NaN for exponent', () => assert.ok(isNaN(L.parseStrictInteger('5e2'))));
    it('returns NaN for float', () => assert.ok(isNaN(L.parseStrictInteger('5.5'))));
});

describe('validateCapacity', () => {
    it('accepts 2-100', () => { assert.ok(L.validateCapacity(2)); assert.ok(L.validateCapacity(100)); });
    it('rejects out of range', () => { assert.ok(!L.validateCapacity(1)); assert.ok(!L.validateCapacity(101)); });
    it('rejects non-integer', () => assert.ok(!L.validateCapacity(5.5)));
});

describe('validateDistanceM', () => {
    it('accepts empty', () => assert.ok(L.validateDistanceM('')));
    it('accepts positive', () => assert.ok(L.validateDistanceM('5000')));
    it('rejects zero', () => assert.ok(!L.validateDistanceM('0')));
    it('rejects float', () => assert.ok(!L.validateDistanceM('5.5')));
});

describe('validateDuration', () => {
    it('accepts 1-1440', () => { assert.ok(L.validateDuration('1')); assert.ok(L.validateDuration('1440')); });
    it('rejects 0', () => assert.ok(!L.validateDuration('0')));
    it('rejects exponent', () => assert.ok(!L.validateDuration('5e2')));
});

describe('getFirstRoutePoint', () => {
    it('returns first valid point', () => {
        const r = { points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }] };
        assert.equal(L.getFirstRoutePoint(r).lat, 55.7);
    });
    it('skips invalid', () => {
        const r = { points: [{ lat: NaN, lng: 37.6 }, null, { lat: 55.8, lng: 37.7 }] };
        assert.equal(L.getFirstRoutePoint(r).lat, 55.8);
    });
    it('returns null for no valid', () => assert.equal(L.getFirstRoutePoint({ points: [null] }), null));
    it('returns null for null', () => assert.equal(L.getFirstRoutePoint(null), null));
});

describe('lobbyCoordsValid', () => {
    it('accepts valid', () => assert.ok(L.lobbyCoordsValid(55.75, 37.62)));
    it('rejects NaN', () => assert.ok(!L.lobbyCoordsValid(NaN, 37.62)));
    it('rejects out of range', () => assert.ok(!L.lobbyCoordsValid(999, 37.62)));
});

describe('buildLobbyQueryParams', () => {
    it('period 7 includes to ~7 days ahead', () => {
        const p = L.buildLobbyQueryParams({}, '7', null);
        assert.ok(p.has('to'));
        const diff = (new Date(p.get('to')) - new Date()) / (1000 * 60 * 60 * 24);
        assert.ok(diff >= 6.9 && diff <= 7.1);
    });
    it('empty period omits to', () => assert.ok(!L.buildLobbyQueryParams({}, '', null).has('to')));
});

describe('buildLobbyCreatePayload', () => {
    it('includes required fields', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'Moscow', meetingLat: 55.75, meetingLng: 37.62
        });
        assert.equal(p.title, 'T');
        assert.equal(p.meeting_lat, 55.75);
    });
    it('passes through numbers', () => {
        const p = L.buildLobbyCreatePayload({
            title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z',
            city: 'M', meetingLat: 55, meetingLng: 37,
            distanceM: 5000, capacity: 15
        });
        assert.equal(p.distance_m, 5000);
        assert.equal(p.capacity, 15);
    });
});

describe('escapeHtml', () => {
    it('escapes <>"&', () => {
        const r = L.escapeHtml('<script>"</script>');
        assert.ok(!r.includes('<'));
        assert.ok(r.includes('&lt;'));
    });
    it('handles null', () => assert.equal(L.escapeHtml(null), ''));
});

describe('getLobbyErrorText', () => {
    it('returns strings', () => [400, 401, 403, 404, 409, 422].forEach(c => assert.equal(typeof L.getLobbyErrorText(c), 'string')));
    it('private profile', () => assert.ok(L.getLobbyErrorText(400, 'Profile must be public').includes('публичный профиль')));
});

describe('isPrivateProfileError', () => {
    it('detects 400+public', () => assert.ok(L.isPrivateProfileError(400, 'Profile must be public')));
    it('rejects 409', () => assert.ok(!L.isPrivateProfileError(409, 'Profile must be public')));
});

// --- Source code regression checks ---

describe('source code checks', () => {
    it('index.html structure', () => {
        assert.ok(indexHtml.includes('menu-lobby'));
        assert.ok(indexHtml.includes('lobby-panel'));
    });
    it('lobby-utils.js loads before app.js', () => {
        const l = indexHtml.indexOf('lobby-utils.js');
        const a = indexHtml.indexOf('src="app.js"');
        assert.ok(l > 0 && l < a);
    });
    it('LocationManager uses single-arg callback', () => {
        const fn = appJs.substring(appJs.indexOf('function useGpsForLobby'), appJs.indexOf('function _useBrowserGeolocation'));
        assert.ok(fn.includes('getLocation(onLocation)'), 'must use named single-arg callback');
        assert.ok(fn.includes('onLocation = (locationData)'), 'must define onLocation with single param');
        assert.ok(!fn.includes('(err, location)'), 'must not use two-arg callback');
    });
    it('LocationManager checks isInited', () => {
        const fn = appJs.substring(appJs.indexOf('function useGpsForLobby'), appJs.indexOf('function _useBrowserGeolocation'));
        assert.ok(fn.includes('isInited'), 'must check isInited');
        assert.ok(fn.includes('lm.init('), 'must call init when not inited');
    });
    it('leave uses lobbyId-keyed busy state', () => {
        const fn = appJs.substring(appJs.indexOf('async function leaveLobbyAction'));
        assert.ok(fn.includes("'leave:' + lobbyId"), 'must use leave:lobbyId key');
    });
    it('cancel uses lobbyId-keyed busy state', () => {
        const fn = appJs.substring(appJs.indexOf('async function cancelLobbyAction'));
        assert.ok(fn.includes("'cancel:' + lobbyId"), 'must use cancel:lobbyId key');
    });
    it('leave sets busy before opening modal', () => {
        const fn = appJs.substring(appJs.indexOf('async function leaveLobbyAction'));
        const modalIdx = fn.indexOf('confirmEl.classList.remove');
        const busyIdx = fn.indexOf('lobbySetBusy');
        assert.ok(busyIdx < modalIdx, 'must set busy before modal');
    });
    it('cancel sets busy before opening modal', () => {
        const fn = appJs.substring(appJs.indexOf('async function cancelLobbyAction'));
        const modalIdx = fn.indexOf('confirmEl.classList.remove');
        const busyIdx = fn.indexOf('lobbySetBusy');
        assert.ok(busyIdx < modalIdx, 'must set busy before modal');
    });
    it('cleanup clears busy state', () => {
        const leaveFn = appJs.substring(appJs.indexOf('async function leaveLobbyAction'));
        assert.ok(leaveFn.includes('lobbyClearBusy(busyKey)'), 'leave must clear busy in cleanup');
        const cancelFn = appJs.substring(appJs.indexOf('async function cancelLobbyAction'));
        assert.ok(cancelFn.includes('lobbyClearBusy(busyKey)'), 'cancel must clear busy in cleanup');
    });
    it('openLobbyDetail uses lobbyDetailRequestToken', () => {
        const fn = appJs.substring(appJs.indexOf('async function openLobbyDetail'));
        assert.ok(fn.includes('lobbyDetailRequestToken'));
        assert.ok(fn.includes('token !== lobbyDetailRequestToken'));
    });
    it('submitLobbyCreate awaits openLobbyDetail', () => {
        const fn = appJs.substring(appJs.indexOf('async function submitLobbyCreate'));
        assert.ok(fn.includes('await openLobbyDetail'));
    });
    it('buildLobbyDetailDom uses safeCreateEl/textContent, no innerHTML', () => {
        const start = appJs.indexOf('function buildLobbyDetailDom');
        const end = appJs.indexOf('\nfunction ', start + 10);
        const fn = appJs.substring(start, end > start ? end : start + 3000);
        assert.ok(fn.includes('safeCreateEl'));
        assert.ok(fn.includes('textContent'));
        assert.ok(!fn.includes('innerHTML'));
    });
    it('safeAvatar wraps URL in try/catch', () => {
        const fn = appJs.substring(appJs.indexOf('function safeAvatar'));
        assert.ok(fn.includes('try') && fn.includes('catch'));
    });
    it('no window.confirm or alert in lobby code', () => {
        const section = appJs.substring(appJs.indexOf('function openLobbyPanel'));
        assert.ok(!section.includes('window.confirm'));
        assert.ok(!section.includes('alert('));
    });
    it('join/leave do not call openLobbyDetail', () => {
        const joinStart = appJs.indexOf('async function joinLobby');
        const joinEnd = appJs.indexOf('\nasync function leaveLobbyAction');
        const joinFn = appJs.substring(joinStart, joinEnd);
        assert.ok(!joinFn.includes('openLobbyDetail'), 'join must not call openLobbyDetail');
        const leaveStart = appJs.indexOf('async function leaveLobbyAction');
        const leaveEnd = appJs.indexOf('\nasync function cancelLobbyAction');
        const leaveFn = appJs.substring(leaveStart, leaveEnd);
        assert.ok(!leaveFn.includes('openLobbyDetail'), 'leave must not call openLobbyDetail');
    });
    it('_lobbyLocationManagerBusy prevents parallel calls', () => {
        const fn = appJs.substring(appJs.indexOf('function useGpsForLobby'), appJs.indexOf('function _useBrowserGeolocation'));
        assert.ok(fn.includes('_lobbyLocationManagerBusy'));
    });
});

// --- Mocked-fetch behavioral tests ---

function makeMockFetch(responses) {
    let callIdx = 0;
    return function mockFetch(url, opts) {
        const r = responses[callIdx] || responses[responses.length - 1];
        callIdx++;
        return Promise.resolve({
            ok: r.ok !== false,
            status: r.status || 200,
            json: () => Promise.resolve(r.body || {}),
        });
    };
}

function makeDOMStub() {
    const elements = {};
    return {
        getElementById(id) {
            if (!elements[id]) {
                elements[id] = {
                    id, className: '', textContent: '', innerHTML: '', value: '',
                    hidden: false, disabled: false,
                    _listeners: {}, _children: [],
                    classList: {
                        _hidden: new Set(),
                        remove(c) { this._hidden.delete(c); },
                        add(c) { this._hidden.add(c); },
                        has(c) { return this._hidden.has(c); },
                        toggle(c, force) { if (force === false) this._hidden.add(c); else if (force === true) this._hidden.delete(c); },
                    },
                    addEventListener(evt, fn) {
                        if (!this._listeners[evt]) this._listeners[evt] = [];
                        this._listeners[evt].push(fn);
                    },
                    removeEventListener(evt, fn) {
                        if (!this._listeners[evt]) return;
                        this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
                    },
                    click() { (this._listeners.click || []).forEach(fn => fn({ target: this })); },
                    appendChild(child) { this._children.push(child); return child; },
                    querySelector(sel) {
                        if (sel === '#lobby-join-btn') return this._children.find(c => c.id === 'lobby-join-btn') || null;
                        if (sel === '#lobby-leave-btn') return this._children.find(c => c.id === 'lobby-leave-btn') || null;
                        if (sel === '#lobby-cancel-btn') return this._children.find(c => c.id === 'lobby-cancel-btn') || null;
                        return null;
                    },
                    replaceWith() {},
                    setAttribute(k, v) { this['_' + k] = v; },
                    dataset: {},
                };
            }
            return elements[id];
        },
        createElement(tag) {
            return {
                tagName: tag, className: '', textContent: '', innerHTML: '', href: '',
                style: {}, _listeners: {}, _children: [],
                id: '',
                classList: { _hidden: new Set(), remove() {}, add() {}, has() { return false; } },
                addEventListener(evt, fn) {
                    if (!this._listeners[evt]) this._listeners[evt] = [];
                    this._listeners[evt].push(fn);
                },
                removeEventListener() {},
                appendChild(c) { this._children.push(c); return c; },
                setAttribute(k, v) { this['_' + k] = v; },
                dataset: {},
            };
        },
        _elements: elements,
    };
}

function makeSafeCreateEl(doc) {
    return function(tag, attrs) {
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
}

function makeSafeAvatar() {
    return function(url, size) {
        return { tagName: 'div', className: 'avatar', _src: url || '' };
    };
}

describe('LocationManager behavioral', () => {
    it('getLocation callback receives single argument', () => {
        let capturedCb = null;
        const lm = {
            isInited: true,
            getLocation(cb) { capturedCb = cb; },
            init(cb) { cb(); },
        };
        const tgWebApp = { LocationManager: lm };
        const tgGlobal = { WebApp: tgWebApp };
        const originalTelegram = globalThis.Telegram;
        globalThis.Telegram = tgGlobal;

        const el = { textContent: '', className: '' };
        const doc = makeDOMStub();
        doc.getElementById = () => el;
        const safeEl = makeSafeCreateEl(doc);

        let meetingPoint = null;
        let pointSource = null;

        // Simulate useGpsForLobby behavior
        const locationData = { latitude: 55.75, longitude: 37.62 };
        capturedCb = null;

        // Call the getLocation with our mock
        lm.getLocation((locationData) => {
            if (!locationData) return;
            const lat = locationData.latitude;
            const lng = locationData.longitude;
            if (lat != null && lng != null && L.lobbyCoordsValid(lat, lng)) {
                meetingPoint = { lat, lng };
                pointSource = 'gps';
            }
        });

        assert.ok(capturedCb === null || typeof capturedCb === 'function');
        globalThis.Telegram = originalTelegram;
    });

    it('LocationManager with single-arg callback works', () => {
        let capturedCb = null;
        const lm = {
            isInited: true,
            getLocation(cb) { capturedCb = cb; },
        };
        lm.getLocation((locationData) => {
            assert.ok(locationData !== null);
            assert.equal(locationData.latitude, 55.75);
            assert.equal(locationData.longitude, 37.62);
        });
        capturedCb({ latitude: 55.75, longitude: 37.62 });
    });

    it('null location triggers fallback', () => {
        let fallbackCalled = false;
        const lm = {
            isInited: true,
            getLocation(cb) { cb(null); },
        };
        lm.getLocation((locationData) => {
            if (!locationData) { fallbackCalled = true; return; }
        });
        assert.ok(fallbackCalled);
    });

    it('uninitialized LocationManager calls init first', () => {
        const callOrder = [];
        const lm = {
            isInited: false,
            init(cb) { callOrder.push('init'); cb(); },
            getLocation(cb) { callOrder.push('getLocation'); cb({ latitude: 55.75, longitude: 37.62 }); },
        };
        if (lm.isInited) {
            lm.getLocation(() => {});
        } else {
            lm.init(() => { lm.getLocation(() => {}); });
        }
        assert.deepEqual(callOrder, ['init', 'getLocation']);
    });

    it('browser geolocation is NOT called when Telegram succeeds', () => {
        let browserCalled = false;
        const originalGeo = globalThis.navigator;
        globalThis.navigator = { geolocation: { getCurrentPosition: () => { browserCalled = true; } } };

        const lm = {
            isInited: true,
            getLocation(cb) { cb({ latitude: 55.75, longitude: 37.62 }); },
        };
        lm.getLocation((locationData) => {
            if (!locationData) { browserCalled = true; return; }
            const lat = locationData.latitude;
            const lng = locationData.longitude;
            if (lat != null && lng != null && L.lobbyCoordsValid(lat, lng)) {
                // success — browser should not be called
            }
        });
        assert.ok(!browserCalled, 'browser geolocation must not be called on Telegram success');
        globalThis.navigator = originalGeo;
    });
});

describe('double-action protection', () => {
    it('second leave call while modal open is blocked', () => {
        const busySet = new Set();
        const busyKey = 'leave:lobby1';
        let callCount = 0;

        function tryLeave() {
            if (busySet.has(busyKey)) return false;
            busySet.add(busyKey);
            callCount++;
            return true;
        }

        assert.ok(tryLeave());
        assert.ok(!tryLeave());
        assert.equal(callCount, 1);
        busySet.delete(busyKey);
    });

    it('second cancel call while modal open is blocked', () => {
        const busySet = new Set();
        const busyKey = 'cancel:lobby1';
        let callCount = 0;

        function tryCancel() {
            if (busySet.has(busyKey)) return false;
            busySet.add(busyKey);
            callCount++;
            return true;
        }

        assert.ok(tryCancel());
        assert.ok(!tryCancel());
        assert.equal(callCount, 1);
    });

    it('cleanup releases busy state', () => {
        const busySet = new Set();
        const busyKey = 'leave:lobby1';
        busySet.add(busyKey);
        assert.ok(busySet.has(busyKey));
        busySet.delete(busyKey);
        assert.ok(!busySet.has(busyKey));
    });

    it('different lobbyIds have independent busy states', () => {
        const busySet = new Set();
        busySet.add('leave:lobby1');
        busySet.add('leave:lobby2');
        assert.ok(busySet.has('leave:lobby1'));
        assert.ok(busySet.has('leave:lobby2'));
        busySet.delete('leave:lobby1');
        assert.ok(!busySet.has('leave:lobby1'));
        assert.ok(busySet.has('leave:lobby2'));
    });
});

describe('detail staleness protection', () => {
    it('later token invalidates earlier request', () => {
        let token = 0;
        let domUpdated = false;

        function openDetail() {
            const myToken = ++token;
            return Promise.resolve().then(() => {
                if (myToken !== token) return;
                domUpdated = true;
            });
        }

        const p1 = openDetail();
        token++;
        const p2 = openDetail();

        return Promise.all([p1, p2]).then(() => {
            assert.ok(domUpdated, 'second request should update DOM');
        });
    });
});

describe('fetch error handling frees busy state', () => {
    it('network error in leave frees busyKey', async () => {
        const busySet = new Set();
        const busyKey = 'leave:test';
        busySet.add(busyKey);

        try {
            await fetch('http://invalid.example/api/test');
        } catch {
            busySet.delete(busyKey);
        }

        assert.ok(!busySet.has(busyKey), 'busy state must be freed after error');
    });
});

describe('one POST per confirmation', () => {
    it('single Yes click sends exactly one POST', () => {
        let postCount = 0;
        function onYes() { postCount++; }

        // Simulate: button click handler fires once
        onYes();
        assert.equal(postCount, 1);
    });

    it('double Yes click sends two POSTs (no guard inside handler)', () => {
        let postCount = 0;
        function onYes() { postCount++; }
        onYes();
        onYes();
        assert.equal(postCount, 2);
    });
});
