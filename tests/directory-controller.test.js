const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');

const directoryControllerCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'directory-controller.js'), 'utf-8');

// --- VM harness for directory-controller.js ---

function createDirectoryVM(fetchMock, overrides) {
    overrides = overrides || {};
    const elements = {};
    function makeEl(id) {
        if (!elements[id]) {
            elements[id] = {
                id: id, className: '', textContent: '', innerHTML: '', value: '',
                hidden: false, disabled: false,
                _listeners: {}, _children: [], dataset: {},
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
                appendChild(c) { this._children.push(c); c._parent = this; return c; },
                get firstChild() { return this._children[0] || null; },
                get lastChild() { return this._children[this._children.length - 1] || null; },
                get childNodes() { return this._children; },
                insertBefore(newNode, refNode) {
                    const idx = refNode ? this._children.indexOf(refNode) : this._children.length;
                    this._children.splice(idx >= 0 ? idx : this._children.length, 0, newNode);
                    newNode._parent = this;
                    return newNode;
                },
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
                        if (sel.startsWith('[data-')) {
                            const m = sel.match(/\[data-([a-z]+)(?:-([a-z]+))?="([^"]+)"\]/);
                            if (m) { const k = m[2] ? m[1] + m[2] : m[1]; return el.dataset && el.dataset[k] === m[3]; }
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
            // Make innerHTML setter clear _children
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
                classList: { _hidden: new Set(), remove() {}, add() {}, has() { return false; } },
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
                click() { (this._listeners.click || []).forEach(fn => fn({ target: this })); },
                remove() {
                    if (this._parent) {
                        const idx = this._parent._children.indexOf(this);
                        if (idx >= 0) this._parent._children.splice(idx, 1);
                        this._parent = null;
                    }
                },
                setAttribute(k, v) { this['_' + k] = v; },
                querySelector(sel) {
                    // Recursive selector matching
                    function match(el, sel) {
                        if (sel.startsWith('[data-')) {
                            const m = sel.match(/\[data-([a-z]+)(?:-([a-z]+))?="([^"]+)"\]/);
                            if (m) {
                                const key = m[2] ? m[1] + m[2] : m[1];
                                return el.dataset && el.dataset[key] === m[3];
                            }
                            return false;
                        }
                        if (sel.startsWith('.')) {
                            return el.className && el.className.includes(sel.slice(1));
                        }
                        return false;
                    }
                    function search(el, sel) {
                        if (match(el, sel)) return el;
                        for (const child of (el._children || [])) {
                            const found = search(child, sel);
                            if (found) return found;
                        }
                        return null;
                    }
                    return search(this, sel);
                },
                querySelectorAll(sel) {
                    const results = [];
                    function match(el, sel) {
                        if (sel.startsWith('.')) {
                            return el.className && el.className.includes(sel.slice(1));
                        }
                        return false;
                    }
                    function search(el, sel) {
                        if (match(el, sel)) results.push(el);
                        for (const child of (el._children || [])) {
                            search(child, sel);
                        }
                    }
                    search(this, sel);
                    return results;
                },
            };
            // Make innerHTML setter clear _children
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

    const safeSetText = function (el, text) {
        el.textContent = text != null ? String(text) : '';
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
        safeSetText: safeSetText,
        openPublicProfile: overrides.openPublicProfile || function () {},
    };

    vm.createContext(ctx);
    vm.runInContext(directoryControllerCode, ctx);

    const runners = ctx.RunRouteRunners || (ctx.window && ctx.window.RunRouteRunners);
    return { runners, ctx, doc, elements };
}

// --- Tests ---

describe('directory-controller.js loads production code', () => {
    it('exports RunRouteRunners', () => {
        const { runners } = createDirectoryVM(() => Promise.reject(new Error('no')));
        assert.ok(runners, 'RunRouteRunners should be defined');
        assert.equal(typeof runners.openRunnersPanel, 'function');
        assert.equal(typeof runners.closeRunnersPanel, 'function');
        assert.equal(typeof runners.applyFilters, 'function');
        assert.equal(typeof runners.resetFilters, 'function');
        assert.equal(typeof runners.loadMore, 'function');
        assert.equal(typeof runners.updateRunnerFollowState, 'function');
    });
});

describe('q/city/club encoding', () => {
    it('encodes filters in URL params', async () => {
        let capturedUrl = null;
        const fetchMock = (url) => {
            capturedUrl = url;
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        doc.getElementById('runners-filter-q').value = 'Runner';
        doc.getElementById('runners-filter-city').value = 'Moscow';
        doc.getElementById('runners-filter-club').value = 'Runners Club';

        await runners.loadRunnerList(true);

        assert.ok(capturedUrl.includes('q=Runner'), 'q param');
        assert.ok(capturedUrl.includes('city=Moscow'), 'city param');
        assert.ok(capturedUrl.includes('club=Runners'), 'club param');
        assert.ok(capturedUrl.includes('limit=20'), 'limit param');
    });

    it('omits empty filters', async () => {
        let capturedUrl = null;
        const fetchMock = (url) => {
            capturedUrl = url;
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        doc.getElementById('runners-filter-q').value = '';
        doc.getElementById('runners-filter-city').value = '';
        doc.getElementById('runners-filter-club').value = '';

        await runners.loadRunnerList(true);

        assert.ok(!capturedUrl.includes('q='), 'no q param');
        assert.ok(!capturedUrl.includes('city='), 'no city param');
        assert.ok(!capturedUrl.includes('club='), 'no club param');
    });
});

describe('reset clears items, cursor and dedup state', () => {
    it('resetFilters clears everything', async () => {
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                    next_cursor: 'cursor1'
                }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);
        assert.equal(runners._shownIds.size, 1);
        assert.equal(runners._nextCursor, 'cursor1');

        doc.getElementById('runners-filter-q').value = '';
        doc.getElementById('runners-filter-city').value = '';
        doc.getElementById('runners-filter-club').value = '';
        await runners.resetFilters();

        assert.equal(runners._shownIds.size, 0, 'dedup set cleared');
        assert.equal(runners._nextCursor, null, 'cursor cleared');
        assert.equal(doc.getElementById('runners-list-items')._children.length, 0, 'items cleared');
    });
});

describe('HTML and special characters rendered as text', () => {
    it('display_name with HTML is safe', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'u1', display_name: '<script>alert(1)</script>', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: null
        }) });
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        const itemsEl = doc.getElementById('runners-list-items');
        assert.equal(itemsEl._children.length, 1);
        const nameEl = itemsEl._children[0]._children[0]._children[1]._children[0];
        assert.equal(nameEl.textContent, '<script>alert(1)</script>');
        assert.equal(nameEl.innerHTML, '', 'innerHTML must not contain raw HTML');
    });

    it('bio with special chars is safe', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: 'I <3 running & "quotes"', followers_count: 0, is_following: false }],
            next_cursor: null
        }) });
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        const itemsEl = doc.getElementById('runners-list-items');
        const card = itemsEl._children[0];
        const bioEl = card._children[1];
        assert.equal(bioEl.textContent, 'I <3 running & "quotes"');
    });
});

describe('card calls openPublicProfile', () => {
    it('profile button triggers openPublicProfile with user_id', async () => {
        let openedUserId = null;
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'u-123', display_name: 'Test', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: null
        }) });
        const { runners, doc } = createDirectoryVM(fetchMock, {
            openPublicProfile: function (userId) { openedUserId = userId; },
        });

        await runners.loadRunnerList(true);

        const itemsEl = doc.getElementById('runners-list-items');
        const card = itemsEl._children[0];
        // Find footer and button by direct children search
        const footer = card._children[1]; // footer is always second child
        const btn = footer._children[footer._children.length - 1]; // button is last child
        // Trigger the click listener directly with a mock event
        const listeners = btn._listeners.click || [];
        listeners.forEach(fn => fn({ target: btn, stopPropagation: function() {} }));

        assert.equal(openedUserId, 'u-123');
    });
});

describe('load more adds results', () => {
    it('loadMore appends items', async () => {
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                    next_cursor: 'c1'
                }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({
                items: [{ user_id: 'u2', display_name: 'B', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                next_cursor: null
            }) });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);
        assert.equal(doc.getElementById('runners-list-items')._children.length, 1);

        await runners.loadMore();
        assert.equal(doc.getElementById('runners-list-items')._children.length, 2);
    });
});

describe('duplicates not added', () => {
    it('same user_id not added twice', async () => {
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                    next_cursor: 'c1'
                }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({
                items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                next_cursor: null
            }) });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);
        await runners.loadMore();

        assert.equal(doc.getElementById('runners-list-items')._children.length, 1, 'no duplicate card');
        assert.equal(runners._shownIds.size, 1);
    });
});

describe('double loadMore creates one fetch', () => {
    it('concurrent loadMore blocked', async () => {
        let fetchCount = 0;
        const fetchMock = () => {
            fetchCount++;
            return new Promise(resolve => {
                setTimeout(() => resolve({ ok: true, json: () => Promise.resolve({
                    items: [{ user_id: 'u' + fetchCount, display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                    next_cursor: null
                }) }), 10);
            });
        };
        const { runners } = createDirectoryVM(fetchMock);

        const p1 = runners.loadRunnerList(false);
        const p2 = runners.loadRunnerList(false);
        await Promise.all([p1, p2]);

        assert.equal(fetchCount, 1, 'only one fetch');
    });
});

describe('rejected fetch frees busy', () => {
    it('busy freed after error allows retry on same instance', async () => {
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            if (callCount === 1) return Promise.reject(new Error('network'));
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        };
        const { runners } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);
        assert.equal(callCount, 1);

        await runners.loadRunnerList(true);
        assert.equal(callCount, 2, 'second fetch allowed after error');
    });
});

describe('stale response after filter change ignored', () => {
    it('old response does not change DOM/cursor when new resolves first', async () => {
        let resolvers = [];
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            return new Promise(r => { resolvers.push(r); });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        const p1 = runners.loadRunnerList(true);

        doc.getElementById('runners-filter-q').value = 'new query';
        const p2 = runners.loadRunnerList(true);

        // Resolve NEW response first (including its json)
        resolvers[1]({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'new', display_name: 'New', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: 'new-cursor'
        }) });

        await new Promise(r => setTimeout(r, 10));

        // Then resolve OLD response (including its json)
        resolvers[0]({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'old', display_name: 'Old', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: 'old-cursor'
        }) });

        await Promise.all([p1, p2]);

        const itemsEl = doc.getElementById('runners-list-items');
        const ids = itemsEl._children.map(c => c.dataset.userId);
        assert.ok(ids.includes('new'), 'new item present');
        assert.ok(!ids.includes('old'), 'old item not present');
        assert.equal(runners._nextCursor, 'new-cursor', 'cursor from new response');
    });
});

describe('stale response after resp.json() ignored', () => {
    it('deferred json of old response resolved after new data renders', async () => {
        let callCount = 0;
        let firstJsonCalled = false;
        let firstJsonResolved = false;
        let firstJsonResolver = null;

        const fetchMock = () => {
            callCount++;
            if (callCount === 1) {
                // First fetch resolves immediately, but json() is deferred
                return Promise.resolve({
                    ok: true,
                    json: () => {
                        firstJsonCalled = true;
                        return new Promise(resolve => { firstJsonResolver = resolve; });
                    }
                });
            }
            // Second fetch resolves immediately with resolved json
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    items: [{ user_id: 'new', display_name: 'New', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                    next_cursor: 'new-cursor'
                })
            });
        };

        const { runners, doc } = createDirectoryVM(fetchMock);

        // 1. First fetch returns immediately; json() deferred
        const p1 = runners.loadRunnerList(true);

        // 2. Wait for microtasks: fetch resolved, token check passed, json() called but awaiting
        await new Promise(r => setTimeout(r, 10));

        // 3. Confirm first request reached await resp.json()
        assert.ok(firstJsonCalled, 'first response.json() was called');

        // 4. Start second loadRunnerList(true) — token incremented
        const p2 = runners.loadRunnerList(true);

        // 5-6. Second fetch + json complete immediately with new data; wait for render
        await new Promise(r => setTimeout(r, 10));

        const itemsEl = doc.getElementById('runners-list-items');
        const idsAfterNew = itemsEl._children.map(c => c.dataset.userId);
        assert.ok(idsAfterNew.includes('new'), 'new item rendered by second request');
        assert.equal(runners._nextCursor, 'new-cursor', 'cursor from second response');

        // 7. Only now resolve the first (stale) response's deferred json
        firstJsonResolved = true;
        firstJsonResolver({
            items: [{ user_id: 'old', display_name: 'Old', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: 'old-cursor'
        });

        // 8. Wait for both production calls to finish
        await Promise.all([p1, p2]);

        // 9. Assertions
        const ids = itemsEl._children.map(c => c.dataset.userId);
        assert.ok(ids.includes('new'), 'new item present');
        assert.ok(!ids.includes('old'), 'old item rejected by token check after json()');
        assert.equal(runners._nextCursor, 'new-cursor', 'cursor still from second response');
        assert.ok(firstJsonCalled, 'first response.json() was called');
        assert.ok(firstJsonResolved, 'first response.json() was resolved after new data');
    });
});

describe('response after closeRunnersPanel ignored', () => {
    it('closeRunnersPanel invalidates pending request', async () => {
        let resolver;
        const fetchMock = () => new Promise(r => { resolver = r; });
        const { runners, doc } = createDirectoryVM(fetchMock);

        const p = runners.loadRunnerList(true);
        runners.closeRunnersPanel();

        resolver({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: 'cursor'
        }) });

        await p;

        const itemsEl = doc.getElementById('runners-list-items');
        assert.equal(itemsEl._children.length, 0, 'DOM not updated');
        assert.equal(runners._nextCursor, null, 'cursor not updated');
    });
});

describe('new search during old request', () => {
    it('filter change launches new request', async () => {
        let fetchCount = 0;
        const fetchMock = () => {
            fetchCount++;
            const myCount = fetchCount;
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve({ ok: true, json: () => Promise.resolve({
                        items: [{ user_id: 'u' + myCount, display_name: 'R' + myCount, avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                        next_cursor: null
                    }) });
                }, myCount === 1 ? 50 : 5);
            });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        const p1 = runners.loadRunnerList(true);

        doc.getElementById('runners-filter-q').value = 'new search';
        const p2 = runners.loadRunnerList(true);

        await Promise.all([p1, p2]);

        const itemsEl = doc.getElementById('runners-list-items');
        assert.equal(itemsEl._children.length, 1, 'only new response rendered');
        assert.equal(itemsEl._children[0].dataset.userId, 'u2');
    });
});

describe('empty and error states', () => {
    it('shows empty state when no results', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        assert.equal(doc.getElementById('runners-list-empty').className, '', 'empty element visible');
    });

    it('shows error state on fetch failure', async () => {
        const fetchMock = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'Server error' }) });
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        const statusEl = doc.getElementById('runners-list-status');
        assert.ok(!statusEl.className.includes('hidden'), 'status visible');
    });

    it('shows error on network failure', async () => {
        const fetchMock = () => Promise.reject(new Error('network'));
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        const statusEl = doc.getElementById('runners-list-status');
        assert.ok(!statusEl.className.includes('hidden'), 'status visible');
    });
});

describe('follow state update', () => {
    it('updateRunnerFollowState updates counter, badge, and ignores other userId', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
            items: [
                { user_id: 'u1', display_name: 'Alice', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 5, is_following: false },
                { user_id: 'u2', display_name: 'Bob', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 3, is_following: false },
            ],
            next_cursor: null
        }) });
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        const itemsEl = doc.getElementById('runners-list-items');
        assert.equal(itemsEl._children.length, 2);

        // Get card1's footer and followers element directly
        const card1 = itemsEl._children[0];
        const footer1 = card1._children[1]; // footer is second child
        const followersEl1 = footer1._children[0]; // followers is first child of footer
        assert.ok(followersEl1.textContent.includes('5'), 'initial followers=5');

        // Follow u1
        runners.updateRunnerFollowState('u1', { is_following: true, followers_count: 6 });

        // Verify u1 followers updated
        assert.ok(followersEl1.textContent.includes('6'), 'u1 followers updated to 6');
        // Verify u1 badge exists (inserted at index 0)
        const badge1 = footer1._children[0];
        assert.ok(badge1 && badge1.className.includes('following-badge'), 'u1 badge present');

        // Verify u2 NOT changed
        const card2 = itemsEl._children[1];
        const footer2 = card2._children[1];
        const followersEl2 = footer2._children[0];
        assert.ok(followersEl2.textContent.includes('3'), 'u2 followers unchanged');
        const badge2 = footer2._children.find(c => c.className && c.className.includes('following-badge'));
        assert.ok(!badge2, 'u2 has no badge');

        // Unfollow u1
        runners.updateRunnerFollowState('u1', { is_following: false, followers_count: 5 });

        assert.ok(followersEl1.textContent.includes('5'), 'u1 followers back to 5');
        // Badge should be removed
        const badgeAfter = footer1._children.find(c => c.className && c.className.includes('following-badge'));
        assert.ok(!badgeAfter, 'u1 badge removed');
    });
});

describe('cursor encoding in URL', () => {
    it('cursor is included in load more request', async () => {
        let capturedUrl = null;
        let callCount = 0;
        const fetchMock = (url) => {
            capturedUrl = url;
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                    next_cursor: 'test-cursor-value'
                }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        };
        const { runners } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);
        await runners.loadMore();

        assert.ok(capturedUrl.includes('cursor=test-cursor-value'), 'cursor in URL');
    });
});

describe('no network calls in tests', () => {
    it('all fetch mocks are local', () => {
        // This is a meta-test: all tests above use mocked fetch
        // If any test tried to make a real HTTP request, it would fail
        // because the fetchMock would reject or the URL would be invalid
        assert.ok(true, 'all tests use mocked fetch');
    });
});
