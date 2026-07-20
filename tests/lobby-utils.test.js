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
        const fakeLm = { isInited: true, getLocation(cb) { capturedCb = cb; } };
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
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST' && url === '/api/lobbies') {
                postCount++;
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1' }) });
            }
            if (url.includes('/participants')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1', title: 'T', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } }) });
        };

        const futureDate = new Date(Date.now() + 86400000);
        const dateStr = futureDate.toISOString().slice(0, 16);

        const { lobby, doc } = createLobbyControllerVM(fetchMock, {
            lastKnownLocation: { lat: 55.75, lng: 37.62, timestamp: Date.now() },
        });

        lobby.useGpsForLobby();
        assert.ok(lobby.lobbyMeetingPoint, 'meeting point should be set');

        doc.getElementById('lobby-form-title').value = 'Test Lobby';
        doc.getElementById('lobby-form-date').value = dateStr;
        doc.getElementById('lobby-form-city').value = 'Moscow';

        const p1 = lobby.submitLobbyCreate();
        const p2 = lobby.submitLobbyCreate();
        await Promise.all([p1, p2]);

        assert.equal(postCount, 1, 'should send exactly one POST /api/lobbies');
    });

    it('busy freed after rejected fetch, resubmission possible', async () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST' && url === '/api/lobbies') {
                postCount++;
                return Promise.reject(new Error('network'));
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        };

        const futureDate = new Date(Date.now() + 86400000);
        const dateStr = futureDate.toISOString().slice(0, 16);

        const { lobby, doc } = createLobbyControllerVM(fetchMock, {
            lastKnownLocation: { lat: 55.75, lng: 37.62, timestamp: Date.now() },
        });

        lobby.useGpsForLobby();
        doc.getElementById('lobby-form-title').value = 'Test Lobby';
        doc.getElementById('lobby-form-date').value = dateStr;
        doc.getElementById('lobby-form-city').value = 'Moscow';

        await lobby.submitLobbyCreate();
        assert.ok(!lobby.lobbyIsBusy('create'), 'busy should be cleared after error');
        assert.equal(postCount, 1);

        await lobby.submitLobbyCreate();
        assert.equal(postCount, 2, 'should be able to resubmit after error');
    });
});

describe('detail staleness via production loadLobbyList', () => {
    it('stale response does not overwrite newer result', async () => {
        let resolveFirst, resolveSecond;
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            if (callCount === 1) return new Promise(r => { resolveFirst = r; });
            return new Promise(r => { resolveSecond = r; });
        };

        const { lobby, doc } = createLobbyControllerVM(fetchMock);

        const p1 = lobby.loadLobbyList(false, '');
        const p2 = lobby.loadLobbyList(false, '');

        resolveSecond({
            ok: true, status: 200,
            json: () => Promise.resolve({
                items: [{ id: 'new', title: 'New', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } }],
                next_cursor: 'cursor-new'
            })
        });

        await new Promise(r => setTimeout(r, 10));

        resolveFirst({
            ok: true, status: 200,
            json: () => Promise.resolve({
                items: [{ id: 'old', title: 'Old', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } }],
                next_cursor: 'cursor-old'
            })
        });

        await Promise.all([p1, p2]);

        const itemsEl = doc.getElementById('lobby-list-items');
        const ids = itemsEl._children.map(c => c.dataset['data-lobby-id']);
        assert.ok(ids.includes('new'), 'new lobby should be in DOM');
        assert.ok(!ids.includes('old'), 'old lobby should not be in DOM');
        assert.equal(lobby.lobbyNextCursor, 'cursor-new', 'cursor should match second response');
    });
});

describe('detail staleness via production openLobbyDetail', () => {
    it('stale response does not overwrite newer DOM', async () => {
        let resolveFirstLobby, resolveFirstPart, resolveSecondLobby, resolveSecondPart;
        const fakeLobby1 = { id: '1', title: 'Old', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } };
        const fakeLobby2 = { id: '2', title: 'New', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } };

        let fetchCount = 0;
        const fetchMock = (url) => {
            fetchCount++;
            const myCount = fetchCount;
            if (url.includes('/participants')) {
                if (myCount <= 2) return new Promise(r => { resolveFirstPart = r; });
                return new Promise(r => { resolveSecondPart = r; });
            }
            if (myCount <= 2) return new Promise(r => { resolveFirstLobby = r; });
            return new Promise(r => { resolveSecondLobby = r; });
        };

        const { lobby, doc } = createLobbyControllerVM(fetchMock);

        const p1 = lobby.openLobbyDetail('1');
        await new Promise(r => setTimeout(r, 10));

        const p2 = lobby.openLobbyDetail('2');
        await new Promise(r => setTimeout(r, 10));

        resolveFirstLobby({ ok: true, status: 200, json: () => Promise.resolve(fakeLobby1) });
        resolveFirstPart({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });

        resolveSecondLobby({ ok: true, status: 200, json: () => Promise.resolve(fakeLobby2) });
        resolveSecondPart({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });

        await Promise.all([p1, p2]);

        const contentEl = doc.getElementById('lobby-detail-content');
        assert.ok(contentEl._children.length > 0, 'content should not be empty');
        assert.equal(contentEl._children[0].textContent, 'New', 'should show new lobby title');
    });

    it('stale participantsResp.json does not overwrite DOM', async () => {
        let resolvePartJson;
        let fetchCount = 0;
        const fakeLobby1 = { id: '1', title: 'Old', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } };
        const fakeLobby2 = { id: '2', title: 'New', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } };

        const fetchMock = (url) => {
            fetchCount++;
            const myCount = fetchCount;
            if (url.includes('/participants')) {
                if (myCount <= 2) {
                    return Promise.resolve({ ok: true, status: 200, json: () => new Promise(r => { resolvePartJson = r; }) });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });
            }
            if (myCount <= 2) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(fakeLobby1) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(fakeLobby2) });
        };

        const { lobby, doc } = createLobbyControllerVM(fetchMock);

        const p1 = lobby.openLobbyDetail('1');
        await new Promise(r => setTimeout(r, 10));

        const p2 = lobby.openLobbyDetail('2');
        await new Promise(r => setTimeout(r, 10));

        resolvePartJson({ participants: [{ id: 'stale' }] });
        await Promise.all([p1, p2]);

        const contentEl = doc.getElementById('lobby-detail-content');
        assert.equal(contentEl._children[0].textContent, 'New', 'should show new lobby title');
    });
});

describe('closeLobbyPanel during fetch', () => {
    it('prevents loadLobbyList DOM update', async () => {
        let resolveFetch;
        const fetchMock = () => new Promise(r => { resolveFetch = r; });

        const { lobby, doc } = createLobbyControllerVM(fetchMock);

        const p = lobby.loadLobbyList(false, '');
        lobby.closeLobbyPanel();

        resolveFetch({
            ok: true, status: 200,
            json: () => Promise.resolve({ items: [{ id: 'new', title: 'New', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, organizer: { display_name: 'Org' } }], next_cursor: 'cursor' })
        });

        await p;

        const itemsEl = doc.getElementById('lobby-list-items');
        assert.equal(itemsEl._children.length, 0, 'DOM should not be updated');
    });

    it('prevents openLobbyDetail DOM update', async () => {
        let resolvers = [];
        const fetchMock = () => new Promise(r => { resolvers.push(r); });

        const { lobby, doc } = createLobbyControllerVM(fetchMock);

        const p = lobby.openLobbyDetail('1');
        lobby.closeLobbyPanel();

        resolvers.forEach(r => r({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) }));

        await p;

        const contentEl = doc.getElementById('lobby-detail-content');
        assert.equal(contentEl._children.length, 0, 'DOM should not be updated after close');
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

describe('leaveLobbyAction via production', () => {
    function makeLeaveFetch(overrides) {
        overrides = overrides || {};
        return (url, opts) => {
            if (opts && opts.method === 'POST' && url.includes('/leave')) {
                if (overrides.rejectLeave) return Promise.reject(new Error('network'));
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            }
            if (url.includes('/participants')) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1', title: 'T', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, can_leave: true, organizer: { display_name: 'Org' } }) });
        };
    }

    it('two calls open one action, second blocked', () => {
        const { lobby } = createLobbyControllerVM(makeLeaveFetch());
        lobby.leaveLobbyAction('1');
        assert.ok(lobby.lobbyIsBusy('leave:1'), 'first call sets busy');
        lobby.leaveLobbyAction('1');
        assert.ok(lobby.lobbyIsBusy('leave:1'), 'busy still set after second call');
    });

    it('confirm-yes sends one POST /leave', async () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST' && url.includes('/leave')) { postCount++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); }
            if (url.includes('/participants')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1', title: 'T', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, can_leave: true, organizer: { display_name: 'Org' } }) });
        };
        const { lobby, elements } = createLobbyControllerVM(fetchMock);
        lobby.leaveLobbyAction('1');
        elements['confirm-yes'].click();
        await new Promise(r => setTimeout(r, 50));
        assert.equal(postCount, 1, 'should send exactly one POST /leave');
        assert.ok(!lobby.lobbyIsBusy('leave:1'), 'busy should be cleared');
    });

    it('double confirm-yes does not duplicate POST', async () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST' && url.includes('/leave')) {
                postCount++;
                return new Promise(resolve => { setTimeout(() => resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }), 50); });
            }
            if (url.includes('/participants')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ participants: [] }) });
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1', title: 'T', route_mode: 'easy', starts_at: '2099-01-01T00:00:00Z', city: 'M', participant_count: 0, capacity: 10, can_leave: true, organizer: { display_name: 'Org' } }) });
        };
        const { lobby, elements } = createLobbyControllerVM(fetchMock);
        lobby.leaveLobbyAction('1');
        elements['confirm-yes'].click();
        elements['confirm-yes'].click();
        await new Promise(r => setTimeout(r, 100));
        assert.equal(postCount, 1, 'should not duplicate POST');
    });

    it('busy freed after rejected fetch', async () => {
        const { lobby, elements } = createLobbyControllerVM(makeLeaveFetch({ rejectLeave: true }));
        lobby.leaveLobbyAction('1');
        elements['confirm-yes'].click();
        await new Promise(r => setTimeout(r, 50));
        assert.ok(!lobby.lobbyIsBusy('leave:1'), 'busy should be cleared after error');
    });

    it('overlay does not create POST', () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST') postCount++;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        };
        const { lobby, elements } = createLobbyControllerVM(fetchMock);
        lobby.leaveLobbyAction('1');
        const confirmEl = elements['confirm-modal'];
        const handlers = confirmEl._listeners.click || [];
        if (handlers.length > 0) handlers[0]({ target: confirmEl });
        assert.equal(postCount, 0, 'no POST on overlay');
        assert.ok(!lobby.lobbyIsBusy('leave:1'));
    });

    it('no button does not create POST', () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST') postCount++;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        };
        const { lobby, elements } = createLobbyControllerVM(fetchMock);
        lobby.leaveLobbyAction('1');
        elements['confirm-no'].click();
        assert.equal(postCount, 0, 'no POST on no');
        assert.ok(!lobby.lobbyIsBusy('leave:1'));
    });
});

describe('cancelLobbyAction via production', () => {
    function makeCancelFetch(overrides) {
        overrides = overrides || {};
        return (url, opts) => {
            if (opts && opts.method === 'POST' && url.includes('/cancel')) {
                if (overrides.rejectCancel) return Promise.reject(new Error('network'));
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) });
        };
    }

    it('confirm-yes sends one POST /cancel', async () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST' && url.includes('/cancel')) { postCount++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) });
        };
        const { lobby, elements } = createLobbyControllerVM(fetchMock);
        lobby.cancelLobbyAction('1');
        elements['confirm-yes'].click();
        await new Promise(r => setTimeout(r, 50));
        assert.equal(postCount, 1, 'should send exactly one POST /cancel');
        assert.ok(!lobby.lobbyIsBusy('cancel:1'), 'busy should be cleared');
    });

    it('double confirm-yes does not duplicate POST', async () => {
        let postCount = 0;
        const fetchMock = (url, opts) => {
            if (opts && opts.method === 'POST' && url.includes('/cancel')) {
                postCount++;
                return new Promise(resolve => { setTimeout(() => resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }), 50); });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) });
        };
        const { lobby, elements } = createLobbyControllerVM(fetchMock);
        lobby.cancelLobbyAction('1');
        elements['confirm-yes'].click();
        elements['confirm-yes'].click();
        await new Promise(r => setTimeout(r, 100));
        assert.equal(postCount, 1, 'should not duplicate POST');
    });

    it('busy freed after rejected fetch', async () => {
        const { lobby, elements } = createLobbyControllerVM(makeCancelFetch({ rejectCancel: true }));
        lobby.cancelLobbyAction('1');
        elements['confirm-yes'].click();
        await new Promise(r => setTimeout(r, 50));
        assert.ok(!lobby.lobbyIsBusy('cancel:1'), 'busy should be cleared after error');
    });
});

describe('GPS busy lifecycle via useGpsForLobby', () => {
    it('blocked during Telegram request', () => {
        let callCount = 0;
        const fakeLm = { isInited: true, getLocation() { callCount++; } };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), { navigator: { geolocation: null } });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };

        lobby.useGpsForLobby();
        lobby.useGpsForLobby();
        assert.equal(callCount, 1, 'getLocation called once');
    });

    it('blocked during browser fallback', () => {
        let geoCount = 0;
        const fakeLm = { isInited: true, getLocation(cb) { cb(null); } };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: { getCurrentPosition() { geoCount++; } } },
        });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };

        lobby.useGpsForLobby();
        lobby.useGpsForLobby();
        assert.equal(geoCount, 1, 'getCurrentPosition called once');
    });

    it('busy cleared after browser success', () => {
        let capturedSuccess = null;
        const { lobby } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: { getCurrentPosition(s) { capturedSuccess = s; } } },
        });

        lobby.useGpsForLobby();
        capturedSuccess({ coords: { latitude: 55.75, longitude: 37.62 } });

        capturedSuccess = null;
        lobby.useGpsForLobby();
        assert.ok(capturedSuccess !== null, 'should call again after success');
    });

    it('busy cleared after browser error', () => {
        let capturedError = null;
        const { lobby } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: { getCurrentPosition(_, e) { capturedError = e; } } },
        });

        lobby.useGpsForLobby();
        capturedError({ code: 2, message: 'unavailable' });

        capturedError = null;
        lobby.useGpsForLobby();
        assert.ok(capturedError !== null, 'should call again after error');
    });

    it('busy cleared when no navigator.geolocation', () => {
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), {
            navigator: { geolocation: null },
        });

        lobby.useGpsForLobby();
        const el = ctx.document.getElementById('lobby-point-status');
        assert.ok(el.textContent.includes('\u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f'));
        el.textContent = '';
        lobby.useGpsForLobby();
        assert.ok(el.textContent.includes('\u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f'), 'second call should proceed');
    });

    it('after completion, new request allowed', () => {
        let capturedCb = null;
        const fakeLm = { isInited: true, getLocation(cb) { capturedCb = cb; } };
        const { lobby, ctx } = createLobbyControllerVM(defaultFetch(), { navigator: { geolocation: null } });
        ctx.window.Telegram = { WebApp: { LocationManager: fakeLm } };

        lobby.useGpsForLobby();
        capturedCb({ latitude: 55.75, longitude: 37.62 });

        capturedCb = null;
        lobby.useGpsForLobby();
        assert.ok(capturedCb !== null, 'should be able to call again');
    });
});
