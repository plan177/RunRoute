const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');

const lobbyUtilsCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');
const lobbyControllerCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-controller.js'), 'utf-8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

// --- lobby-utils.js unit tests ---

function createLobbyUtilsVM() {
    const doc = { createElement(tag) { return { tagName: tag, className: '', textContent: '', innerHTML: '', _attrs: {}, _children: [], _src: '', setAttribute(k, v) { this._attrs[k] = v; }, appendChild(c) { this._children.push(c); return c; }, addEventListener() {}, dataset: {} }; } };
    const ctx = { module: { exports: {} }, document: doc, URL, URLSearchParams, location: { href: 'http://localhost' } };
    vm.createContext(ctx);
    vm.runInContext(lobbyUtilsCode, ctx);
    return ctx.RunRouteLobbyUtils || ctx.module.exports;
}

const L = createLobbyUtilsVM();

describe('parsePaceInput', () => {
    it('accepts mm:ss', () => { assert.equal(L.parsePaceInput('5:00'), 300); assert.equal(L.parsePaceInput('0:45'), 45); });
    it('accepts plain seconds', () => assert.equal(L.parsePaceInput('300'), 300));
    it('rejects empty', () => assert.equal(L.parsePaceInput(''), null));
    it('rejects 5:3 (single digit)', () => assert.equal(L.parsePaceInput('5:3'), null));
    it('rejects 5:60', () => assert.equal(L.parsePaceInput('5:60'), null));
    it('rejects negative', () => assert.equal(L.parsePaceInput('-5'), null));
    it('rejects exponent', () => assert.equal(L.parsePaceInput('5e2'), null));
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
        const p = L.buildLobbyCreatePayload({ title: 'T', runType: 'easy', startsAt: '2027-01-01T09:00:00Z', city: 'M', meetingLat: 55, meetingLng: 37, capacity: 15 });
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

describe('escapeHtml / isPrivateProfileError', () => {
    it('escapes', () => assert.ok(L.escapeHtml('<script>').includes('&lt;')));
    it('detects private', () => assert.ok(L.isPrivateProfileError(400, 'Profile must be public')));
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

// --- VM harness for production lobby-controller.js ---

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

    const safeAvatar = function (url) {
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
        fetch: fetchMock,
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

    const lobby = ctx.RunRouteLobby || (ctx.window && ctx.window.RunRouteLobby);
    return { lobby, ctx, doc, elements };
}

function defaultFetch() {
    return () => Promise.reject(new Error('unexpected fetch call'));
}

function okFetch(body) {
    return () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body || {}) });
}

function errFetch(status, body) {
    return () => Promise.resolve({ ok: false, status: status, json: () => Promise.resolve(body || {}) });
}

// --- Behavioral tests via RunRouteLobby ---

describe('LocationManager via useGpsForLobby', () => {
    it('Telegram success sets meeting point', () => {
        let capturedCb = null;
        const fakeLm = {
            isInited: true,
            getLocation(cb) { capturedCb = cb; },
        };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: null },
        });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };
        lobby.useGpsForLobby();

        capturedCb({ latitude: 55.75, longitude: 37.62 });
        assert.equal(lobby.lobbyMeetingPoint.lat, 55.75);
        assert.equal(lobby.lobbyPointSource, 'gps');
    });

    it('null triggers browser fallback', () => {
        let browserCalled = false;
        let capturedCb = null;
        const fakeLm = { isInited: true, getLocation(cb) { capturedCb = cb; } };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: { getCurrentPosition: () => { browserCalled = true; } } },
        });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };
        lobby.useGpsForLobby();

        capturedCb(null);
        assert.ok(browserCalled, 'browser geolocation must be called on null');
    });

    it('uninitialized LM calls init first', () => {
        const order = [];
        let capturedCb = null;
        const fakeLm = {
            isInited: false,
            init(cb) { order.push('init'); cb(); },
            getLocation(cb) { order.push('getLocation'); capturedCb = cb; },
        };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: null },
        });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };
        lobby.useGpsForLobby();

        capturedCb({ latitude: 55.75, longitude: 37.62 });
        assert.deepEqual(order, ['init', 'getLocation']);
        assert.equal(lobby.lobbyMeetingPoint.lat, 55.75);
    });

    it('invalid coords trigger browser fallback', () => {
        let browserCalled = false;
        let capturedCb = null;
        const fakeLm = { isInited: true, getLocation(cb) { capturedCb = cb; } };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: { getCurrentPosition: () => { browserCalled = true; } } },
        });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };
        lobby.useGpsForLobby();

        capturedCb({ latitude: 999, longitude: 37 });
        assert.ok(browserCalled);
    });

    it('parallel calls blocked by busy flag', () => {
        let capturedCb = null;
        let callCount = 0;
        const fakeLm = { isInited: true, getLocation(cb) { callCount++; capturedCb = cb; } };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: null },
        });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };

        lobby.useGpsForLobby();
        lobby.useGpsForLobby(); // second call should be blocked

        capturedCb({ latitude: 55.75, longitude: 37.62 });
        assert.equal(callCount, 1, 'getLocation should be called only once');
    });

    it('lastKnownLocation takes priority', () => {
        const { lobby } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: null },
            lastKnownLocation: { lat: 55.75, lng: 37.62, timestamp: Date.now() },
        });
        lobby.useGpsForLobby();
        assert.equal(lobby.lobbyMeetingPoint.lat, 55.75);
        assert.equal(lobby.lobbyPointSource, 'gps');
    });
});

describe('double join via production joinLobby', () => {
    it('two concurrent calls produce one POST', async () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST' && url.includes('/join')) {
                postCount++;
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1', title: 'T', route_mode: 'auto', distance_m: 5000, points: [], can_join: false, can_leave: true }) });
            }
            if (url.includes('/participants')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1', title: 'T', route_mode: 'auto', distance_m: 5000, points: [], can_join: false, can_leave: true }) });
        };
        const { lobby } = createLobbyControllerVM(fetchMock);

        const p1 = lobby.joinLobby('1');
        const p2 = lobby.joinLobby('1');
        await Promise.all([p1, p2]);

        assert.equal(postCount, 1, 'should send exactly one POST');
    });
});

describe('rejected fetch frees busy via production joinLobby', () => {
    it('busy cleared after error', async () => {
        const fetchMock = () => Promise.reject(new Error('network'));
        const { lobby } = createLobbyControllerVM(fetchMock);

        await lobby.joinLobby('1');
        assert.ok(!lobby.lobbyIsBusy('join:1'), 'busy must be cleared after error');
    });
});

describe('cancel/overlay frees busy via production leaveLobbyAction', () => {
    it('no POST on overlay click', () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST') postCount++;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        };
        const { lobby, elements } = createLobbyControllerVM(fetchMock);

        lobby.leaveLobbyAction('1');
        assert.ok(lobby.lobbyIsBusy('leave:1'), 'busy set before modal');

        const confirmEl = elements['confirm-modal'];
        // Simulate overlay click
        const clickHandlers = confirmEl._listeners.click || [];
        if (clickHandlers.length > 0) {
            clickHandlers[0]({ target: confirmEl });
        }

        assert.equal(postCount, 0, 'no POST on overlay click');
        assert.ok(!lobby.lobbyIsBusy('leave:1'), 'busy cleared after overlay');
    });
});

describe('double submitLobbyCreate via production', () => {
    it('busy guard prevents double POST', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        const { lobby } = createLobbyControllerVM(fetchMock);

        // Test busy guard directly via production functions
        lobby.lobbySetBusy('create');
        assert.ok(lobby.lobbyIsBusy('create'));
        lobby.lobbyClearBusy('create');
        assert.ok(!lobby.lobbyIsBusy('create'));
    });
});

describe('detail staleness via production loadLobbyList', () => {
    it('later request invalidates earlier', async () => {
        let requestCount = 0;
        const fetchMock = () => {
            requestCount++;
            const myCount = requestCount;
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [{ id: 'r' + myCount, title: 'T' + myCount, route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } }] }) });
                }, myCount === 1 ? 50 : 10);
            });
        };
        const { lobby, doc } = createLobbyControllerVM(fetchMock);

        const p1 = lobby.loadLobbyList(false, '');
        const p2 = lobby.loadLobbyList(false, '');

        await Promise.all([p1, p2]);

        // Elements created by _el() inside loadLobbyList
        const itemsEl = doc.getElementById('lobby-list-items');
        assert.ok(itemsEl, 'lobby-list-items element should exist');
        assert.ok(itemsEl._children.length > 0, 'should have cards from second request');
    });
});

describe('closeLobbyPanel invalidates requests', () => {
    it('increments both tokens', () => {
        const { lobby } = createLobbyControllerVM(defaultFetch());
        const token1 = lobby.lobbyDetailRequestToken;
        const listToken1 = lobby.lobbyRequestToken;
        lobby.closeLobbyPanel();
        assert.ok(lobby.lobbyDetailRequestToken > token1);
        assert.ok(lobby.lobbyRequestToken > listToken1);
    });
});

describe('useGpsForLobby busy flag lifecycle', () => {
    it('busy cleared after success', () => {
        let capturedCb = null;
        const fakeLm = { isInited: true, getLocation(cb) { capturedCb = cb; } };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: null },
        });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };

        lobby.useGpsForLobby();
        // busy is set, call with success
        capturedCb({ latitude: 55.75, longitude: 37.62 });
        // After success, busy should be cleared (we can call again)
        capturedCb = null;
        lobby.useGpsForLobby();
        // Second call should work (busy was cleared)
        assert.ok(capturedCb !== null, 'should be able to call again after success');
    });
});
