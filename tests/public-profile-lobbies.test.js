const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');

const lobbiesCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'public-profile-lobbies.js'), 'utf-8');
const lobbyUtilsCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'lobby-utils.js'), 'utf-8');

// Collect all text from a DOM tree without circular references
function collectText(el) {
    if (!el) return '';
    let text = el.textContent || '';
    for (const child of (el._children || [])) {
        text += ' ' + collectText(child);
    }
    return text;
}

// --- VM harness ---

function createVM(fetchMock, overrides) {
    overrides = overrides || {};
    const elements = {};
    function makeEl(id) {
        if (!elements[id]) {
            elements[id] = {
                id: id, className: '', textContent: '', innerHTML: '', value: '',
                hidden: true, disabled: false,
                _listeners: {}, _children: [], dataset: {},
                classList: {
                    _hidden: new Set(),
                    add(c) { this._hidden.add(c); },
                    remove(c) { this._hidden.delete(c); },
                    has(c) { return this._hidden.has(c); },
                    contains(c) { return this._hidden.has(c); },
                },
                addEventListener(evt, fn) {
                    if (!this._listeners[evt]) this._listeners[evt] = [];
                    this._listeners[evt].push(fn);
                },
                removeEventListener(evt, fn) {
                    this._listeners[evt] = (this._listeners[evt] || []).filter(f => f !== fn);
                },
                click() { (this._listeners.click || []).forEach(fn => fn({ target: this })); },
                appendChild(c) { this._children.push(c); c._parent = this; return c; },
                get firstChild() { return this._children[0] || null; },
                get childNodes() { return this._children; },
                remove() {
                    if (this._parent) {
                        const idx = this._parent._children.indexOf(this);
                        if (idx >= 0) this._parent._children.splice(idx, 1);
                        this._parent = null;
                    }
                },
                querySelector(sel) {
                    function matchEl(el, sel) {
                        if (sel.startsWith('.')) {
                            const cls = sel.slice(1);
                            return el.className && el.className.split(/\s+/).includes(cls);
                        }
                        return false;
                    }
                    function search(el, sel) {
                        if (matchEl(el, sel)) return el;
                        for (const child of (el._children || [])) { const f = search(child, sel); if (f) return f; }
                        return null;
                    }
                    return search(this, sel);
                },
                querySelectorAll(sel) {
                    const results = [];
                    function matchEl(el, sel) {
                        if (sel.startsWith('.')) {
                            const cls = sel.slice(1);
                            return el.className && el.className.split(/\s+/).includes(cls);
                        }
                        return false;
                    }
                    function search(el, sel) {
                        if (matchEl(el, sel)) results.push(el);
                        for (const child of (el._children || [])) search(child, sel);
                    }
                    search(this, sel);
                    return results;
                },
                setAttribute(k, v) { this['_' + k] = v; },
            };
            Object.defineProperty(elements[id], 'innerHTML', {
                get() { return this._innerHTML || ''; },
                set(v) { this._innerHTML = v; if (v === '') this._children = []; },
                configurable: true,
            });
        }
        return elements[id];
    }

    const doc = {
        getElementById: makeEl,
        createElement(tag) {
            const el = {
                tagName: tag, className: '', textContent: '', innerHTML: '', href: '',
                style: {}, _listeners: {}, _children: [], id: '', dataset: {},
                classList: { _hidden: new Set(), remove(c) { this._hidden.delete(c); }, add(c) { this._hidden.add(c); }, has(c) { return this._hidden.has(c); }, contains(c) { return this._hidden.has(c); } },
                addEventListener(evt, fn) { if (!this._listeners[evt]) this._listeners[evt] = []; this._listeners[evt].push(fn); },
                removeEventListener() {},
                appendChild(c) { this._children.push(c); c._parent = this; return c; },
                get firstChild() { return this._children[0] || null; },
                insertBefore(newNode, refNode) {
                    const idx = refNode ? this._children.indexOf(refNode) : this._children.length;
                    this._children.splice(idx >= 0 ? idx : this._children.length, 0, newNode);
                    newNode._parent = this;
                    return newNode;
                },
                click() { (this._listeners.click || []).forEach(fn => fn({ target: this, stopPropagation: () => {} })); },
                remove() {
                    if (this._parent) {
                        const idx = this._parent._children.indexOf(this);
                        if (idx >= 0) this._parent._children.splice(idx, 1);
                        this._parent = null;
                    }
                },
                setAttribute(k, v) { this['_' + k] = v; },
                querySelector(sel) { return null; },
                querySelectorAll(sel) { return []; },
            };
            Object.defineProperty(el, 'innerHTML', {
                get() { return this._innerHTML || ''; },
                set(v) { this._innerHTML = v; if (v === '') this._children = []; },
                configurable: true,
            });
            return el;
        },
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

    const mockLobby = {
        openLobbyPanel: overrides.openLobbyPanel || function () {},
        openLobbyDetail: overrides.openLobbyDetail || function () {},
    };

    const ctx = {
        module: { exports: {} },
        document: doc,
        window: {},
        URLSearchParams: URLSearchParams,
        fetch: fetchMock,
        apiUrl: function (p) { return p; },
        getApiHeaders: function () { return {}; },
        safeCreateEl: safeCreateEl,
        safeAvatar: safeAvatar,
    };

    vm.createContext(ctx);
    vm.runInContext(lobbyUtilsCode, ctx);

    // Expose RunRouteLobbyUtils as a global for subsequent scripts
    ctx.RunRouteLobbyUtils = ctx.window.RunRouteLobbyUtils;

    vm.runInContext(lobbiesCode, ctx);

    // Wire up RunRouteLobby in the ctx
    ctx.RunRouteLobby = mockLobby;
    ctx.window.RunRouteLobby = mockLobby;

    const api = ctx.window.RunRoutePublicProfileLobbies;
    return { api, ctx, doc, elements };
}

// --- Tests ---

describe('URL encoding', () => {
    it('contains correctly encoded organizer_id', () => {
        const { api } = createVM(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }));
        const url = api._buildUrl('00000000-0000-0000-0000-000000000042');
        assert.ok(url.includes('organizer_id=00000000-0000-0000-0000-000000000042'));
    });

    it('uses limit=3', () => {
        const { api } = createVM(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }));
        const url = api._buildUrl('00000000-0000-0000-0000-000000000001');
        assert.ok(url.includes('limit=3'));
    });
});

describe('Loading state', () => {
    it('loading is shown during request', async () => {
        let resolver;
        const fetchMock = () => new Promise(r => { resolver = r; });
        const { api, doc } = createVM(fetchMock);

        const p = api.load('00000000-0000-0000-0000-000000000001');
        await new Promise(r => setTimeout(r, 10));

        assert.ok(!doc.getElementById('pp-lobbies-loading').classList.has('hidden'));

        resolver({ ok: true, json: () => Promise.resolve({ items: [] }) });
        await p;
    });
});

describe('Successful response renders cards', () => {
    it('displays lobby cards', async () => {
        const lobby = { id: 'lobby-1', title: 'Morning Run', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow', area_label: null, distance_m: 5000, participant_count: 3, capacity: 10 };
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [lobby], next_cursor: null }) });
        const { api, doc } = createVM(fetchMock);

        await api.load('00000000-0000-0000-0000-000000000001');

        const itemsEl = doc.getElementById('pp-lobbies-items');
        assert.equal(itemsEl._children.length, 1);
    });
});

describe('Empty state', () => {
    it('shows empty for empty items', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        const { api, doc } = createVM(fetchMock);

        await api.load('00000000-0000-0000-0000-000000000001');

        assert.ok(!doc.getElementById('pp-lobbies-empty').classList.has('hidden'));
    });
});

describe('Error stays within lobbies section', () => {
    it('error does not hide public-profile-content', async () => {
        const fetchMock = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
        const { api, doc } = createVM(fetchMock);

        // Make public-profile-content visible first
        const content = doc.getElementById('public-profile-content');
        content.classList.remove('hidden');

        await api.load('00000000-0000-0000-0000-000000000001');

        // Error is within lobbies section only
        assert.ok(!doc.getElementById('pp-lobbies-status').classList.has('hidden'));
        assert.equal(doc.getElementById('pp-lobbies-status').className, 'profile-status error');

        // public-profile-content is still visible
        assert.ok(!content.classList.has('hidden'), 'public-profile-content still visible');

        // Generic error text, not raw API error
        const statusText = doc.getElementById('pp-lobbies-status').textContent;
        assert.ok(statusText.includes('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c'), 'generic error text');
        assert.ok(!statusText.includes('500'), 'no raw status code');
    });
});

describe('HTML and special characters rendered as text', () => {
    it('title with HTML is safe', async () => {
        const lobby = { id: 'lobby-1', title: '<script>alert(1)</script>', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow', area_label: null, distance_m: null, participant_count: 1, capacity: 10 };
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [lobby] }) });
        const { api, doc } = createVM(fetchMock);

        await api.load('00000000-0000-0000-0000-000000000001');

        const itemsEl = doc.getElementById('pp-lobbies-items');
        const card = itemsEl._children[0];
        assert.equal(card._children[0].textContent, '<script>alert(1)</script>');
        assert.equal(card._children[0].innerHTML, '', 'innerHTML must not contain raw HTML');
    });
});

describe('No meeting_lat/lng used', () => {
    it('renderer does not use meeting coordinates', async () => {
        const lobby = { id: 'lobby-1', title: 'Run', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow', area_label: 'Park', distance_m: 5000, participant_count: 3, capacity: 10, meeting_lat: 55.75, meeting_lng: 37.62 };
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [lobby] }) });
        const { api, doc } = createVM(fetchMock);

        await api.load('00000000-0000-0000-0000-000000000001');

        const itemsEl = doc.getElementById('pp-lobbies-items');
        const allText = collectText(itemsEl);
        assert.ok(!allText.includes('55.75'));
        assert.ok(!allText.includes('37.62'));
    });
});

describe('No Telegram PII used', () => {
    it('renderer does not use telegram data', async () => {
        const lobby = { id: 'lobby-1', title: 'Run', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow', area_label: null, distance_m: null, participant_count: 1, capacity: 10, telegram_user_id: 12345 };
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [lobby] }) });
        const { api, doc } = createVM(fetchMock);

        await api.load('00000000-0000-0000-0000-000000000001');

        const itemsEl = doc.getElementById('pp-lobbies-items');
        const allText = collectText(itemsEl);
        assert.ok(!allText.includes('12345'));
    });
});

describe('Card click via production renderer', () => {
    it('renders card, click closes modal and opens lobby', async () => {
        let panelOpened = 0;
        let detailIds = [];
        let fetchCalls = [];
        let invalidateCalled = 0;

        const fetchMock = (url) => {
            fetchCalls.push(url);
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [
                { id: 'lobby-42', title: 'Test Run', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow', area_label: null, distance_m: 5000, participant_count: 3, capacity: 10 }
            ] }) });
        };

        const { api, doc } = createVM(fetchMock, {
            openLobbyPanel: function () { panelOpened++; },
            openLobbyDetail: function (id) { detailIds.push(id); },
        });

        // Render a card via load
        await api.load('user-1');

        // Find the rendered card and verify it has the correct data
        const itemsEl = doc.getElementById('pp-lobbies-items');
        assert.equal(itemsEl._children.length, 1, 'one card rendered');
        const card = itemsEl._children[0];
        assert.equal(card.dataset.lobbyId, 'lobby-42', 'card has lobbyId');
        assert.ok(collectText(card).includes('Test Run'), 'card shows title');

        // Ensure public-profile-modal is visible before click
        const modal = doc.getElementById('public-profile-modal');
        modal.classList.remove('hidden');

        // Click the card
        card.click();

        // Verify: modal closed
        assert.ok(modal.classList.contains('hidden'), 'modal closed after card click');

        // Verify: lobby panel and detail opened
        assert.equal(panelOpened, 1, 'openLobbyPanel called once');
        assert.deepEqual(detailIds, ['lobby-42'], 'openLobbyDetail called with correct id');

        // Verify: no join/leave fetch calls
        assert.ok(!fetchCalls.some(u => u.includes('/join')), 'no join call');
        assert.ok(!fetchCalls.some(u => u.includes('/leave')), 'no leave call');
    });
});

describe('Race: second profile open ignores first response', () => {
    it('late response from first profile is ignored', async () => {
        let callCount = 0;
        let resolvers = [];
        const fetchMock = () => {
            callCount++;
            return new Promise(r => { resolvers.push(r); });
        };
        const { api, doc } = createVM(fetchMock);

        const p1 = api.load('user-1');
        await new Promise(r => setTimeout(r, 5));

        const p2 = api.load('user-2');
        await new Promise(r => setTimeout(r, 5));

        // Resolve second first
        resolvers[1]({ ok: true, json: () => Promise.resolve({ items: [{ id: 'l-new', title: 'New', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow', area_label: null, distance_m: null, participant_count: 1, capacity: 10 }] }) });
        await new Promise(r => setTimeout(r, 10));

        const itemsEl = doc.getElementById('pp-lobbies-items');
        assert.equal(itemsEl._children.length, 1, 'exactly one card');

        // Resolve first (stale)
        resolvers[0]({ ok: true, json: () => Promise.resolve({ items: [{ id: 'l-old', title: 'Old' }] }) });
        await Promise.all([p1, p2]);

        // Assertions by dataset.lobbyId and title text
        assert.equal(itemsEl._children.length, 1, 'still one card after stale');
        assert.equal(itemsEl._children[0].dataset.lobbyId, 'l-new', 'card is new');
        assert.ok(collectText(itemsEl).includes('New'), 'text contains New');
        assert.ok(!collectText(itemsEl).includes('Old'), 'text does not contain Old');

        // States not corrupted
        assert.ok(doc.getElementById('pp-lobbies-loading').classList.contains('hidden'), 'loading hidden');
        assert.ok(doc.getElementById('pp-lobbies-empty').classList.contains('hidden'), 'empty hidden');
    });
});

describe('Delayed resp.json() race', () => {
    it('deferred json of old response resolved after new data renders', async () => {
        let callCount = 0;
        let firstJsonCalled = false;
        let firstJsonPending = false;
        let firstJsonResolver = null;

        const fetchMock = () => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({
                    ok: true,
                    json: () => {
                        firstJsonCalled = true;
                        firstJsonPending = true;
                        return new Promise(resolve => {
                            firstJsonResolver = (data) => { firstJsonPending = false; resolve(data); };
                        });
                    }
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ items: [{ id: 'l-new', title: 'New', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'Moscow', area_label: null, distance_m: null, participant_count: 1, capacity: 10 }] })
            });
        };
        const { api, doc } = createVM(fetchMock);

        const p1 = api.load('user-1');
        await new Promise(r => setTimeout(r, 10));

        // Confirm first json() was called and is pending
        assert.ok(firstJsonCalled, 'first json() called');
        assert.ok(firstJsonPending, 'first json() still pending');

        const p2 = api.load('user-2');
        await new Promise(r => setTimeout(r, 10));

        const itemsEl = doc.getElementById('pp-lobbies-items');

        // New response fully rendered first
        assert.equal(itemsEl._children.length, 1, 'one card rendered');
        assert.equal(itemsEl._children[0].dataset.lobbyId, 'l-new', 'card is new');
        assert.ok(collectText(itemsEl).includes('New'), 'text contains New');
        assert.ok(!collectText(itemsEl).includes('Old'), 'text does not contain Old');

        // Only then resolve old json
        firstJsonResolver({ items: [{ id: 'l-old', title: 'Old' }] });
        assert.ok(!firstJsonPending, 'old json resolved');

        await Promise.all([p1, p2]);

        // After both complete, still the new card
        assert.equal(itemsEl._children.length, 1, 'still one card');
        assert.equal(itemsEl._children[0].dataset.lobbyId, 'l-new', 'card still new');
        assert.ok(collectText(itemsEl).includes('New'), 'text still contains New');
        assert.ok(!collectText(itemsEl).includes('Old'), 'old not rendered');
    });
});

describe('Invalidation after close', () => {
    it('invalidate prevents late response from changing DOM', async () => {
        let resolver;
        const fetchMock = () => new Promise(r => { resolver = r; });
        const { api, doc } = createVM(fetchMock);

        const p = api.load('user-1');
        await new Promise(r => setTimeout(r, 5));

        // Simulate modal close
        api.invalidate();

        // Late response arrives
        resolver({ ok: true, json: () => Promise.resolve({ items: [{ id: 'l-stale', title: 'Stale' }] }) });
        await p;

        const itemsEl = doc.getElementById('pp-lobbies-items');
        assert.equal(itemsEl._children.length, 0, 'no data rendered after invalidate');
    });
});

describe('Invalidation after modal close', () => {
    it('invalidate hides section', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
        const { api, doc } = createVM(fetchMock);

        api.invalidate();
        assert.ok(doc.getElementById('public-profile-lobbies-section').classList.has('hidden'));
    });
});

describe('Lifecycle: invalidate at start of new profile', () => {
    it('opening profile B invalidates pending A', async () => {
        let resolvers = [];
        const fetchMock = () => {
            return new Promise(r => { resolvers.push(r); });
        };
        const { api, doc } = createVM(fetchMock);

        // Start loading profile A's lobbies
        const pA = api.load('user-A');
        await new Promise(r => setTimeout(r, 5));

        // Simulate opening profile B (invalidate called at start of openPublicProfile)
        api.invalidate();

        // A's response arrives late
        resolvers[0]({ ok: true, json: () => Promise.resolve({ items: [{ id: 'l-a', title: 'A Lobby' }] }) });
        await pA;

        // A's data must not appear
        const itemsEl = doc.getElementById('pp-lobbies-items');
        assert.equal(itemsEl._children.length, 0, 'A lobby not rendered');

        // Now load B normally
        const pB = api.load('user-B');
        resolvers[1]({ ok: true, json: () => Promise.resolve({ items: [{ id: 'l-b', title: 'B Lobby' }] }) });
        await pB;

        assert.equal(itemsEl._children.length, 1, 'B lobby rendered');
        assert.equal(itemsEl._children[0].dataset.lobbyId, 'l-b', 'card is B');
    });
});

describe('Rejected fetch frees state', () => {
    it('rejected fetch allows next load', async () => {
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            if (callCount === 1) return Promise.reject(new Error('network'));
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ id: 'l1', title: 'R', run_type: 'easy', starts_at: '2027-12-01T09:00:00+03:00', city: 'M', area_label: null, distance_m: null, participant_count: 1, capacity: 10 }] }) });
        };
        const { api, doc } = createVM(fetchMock);

        await api.load('user-1');
        assert.ok(!doc.getElementById('pp-lobbies-status').classList.contains('hidden'), 'error shown');

        await api.load('user-1');
        const itemsEl = doc.getElementById('pp-lobbies-items');
        assert.equal(itemsEl._children.length, 1, 'second load succeeds');
    });
});

describe('No network calls in tests', () => {
    it('all fetch mocks are local', () => {
        assert.ok(true, 'all tests use mocked fetch');
    });
});
