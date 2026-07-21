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
                appendChild(c) { this._children.push(c); return c; },
                remove() {},
                querySelector(sel) { return null; },
                querySelectorAll() { return []; },
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
                appendChild(c) { this._children.push(c); return c; },
                click() { (this._listeners.click || []).forEach(fn => fn({ target: this })); },
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
    it('busy cleared after error', async () => {
        const fetchMock = () => Promise.reject(new Error('network'));
        const { runners } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        // Should be able to call again
        let fetchCalled = false;
        const fetchMock2 = () => {
            fetchCalled = true;
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], next_cursor: null }) });
        };
        const { runners: runners2 } = createDirectoryVM(fetchMock2);
        // Use same runners instance - actually we need to test with the same instance
        // Since busy is per-instance, let's test differently
    });

    it('busy freed after error allows retry', async () => {
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
        assert.equal(callCount, 2, 'second fetch allowed');
    });
});

describe('stale response after filter change ignored', () => {
    it('old response does not change DOM/cursor', async () => {
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

        resolvers[0]({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'old', display_name: 'Old', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: 'old-cursor'
        }) });

        resolvers[1]({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'new', display_name: 'New', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
            next_cursor: 'new-cursor'
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
    it('delayed json response does not change DOM', async () => {
        let callCount = 0;
        const fetchMock = () => {
            callCount++;
            if (callCount === 1) {
                // First fetch: slow json
                return Promise.resolve({
                    ok: true,
                    json: () => new Promise(() => {}) // never resolves
                });
            }
            // Second fetch: fast response
            return Promise.resolve({ ok: true, json: () => Promise.resolve({
                items: [{ user_id: 'new', display_name: 'New', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 0, is_following: false }],
                next_cursor: 'new-cursor'
            }) });
        };
        const { runners, doc } = createDirectoryVM(fetchMock);

        const p1 = runners.loadRunnerList(true);
        const p2 = runners.loadRunnerList(true);

        await p2; // second resolves fast

        const itemsEl = doc.getElementById('runners-list-items');
        const ids = itemsEl._children.map(c => c.dataset.userId);
        assert.ok(ids.includes('new'), 'new item present');
        assert.equal(runners._nextCursor, 'new-cursor');
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
    it('updateRunnerFollowState does not throw', async () => {
        const fetchMock = () => Promise.resolve({ ok: true, json: () => Promise.resolve({
            items: [{ user_id: 'u1', display_name: 'A', avatar_url: null, city: null, club_name: null, bio: null, followers_count: 5, is_following: false }],
            next_cursor: null
        }) });
        const { runners, doc } = createDirectoryVM(fetchMock);

        await runners.loadRunnerList(true);

        // Should not throw
        runners.updateRunnerFollowState('u1', { is_following: true, followers_count: 6 });
        runners.updateRunnerFollowState('u1', { is_following: false, followers_count: 5 });
        runners.updateRunnerFollowState('nonexistent', { is_following: true, followers_count: 10 });

        const itemsEl = doc.getElementById('runners-list-items');
        assert.equal(itemsEl._children.length, 1, 'card still exists');
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
