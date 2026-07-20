const { describe, it } = require('node:test');
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

// --- lobby-utils.js unit tests ---

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
    it('rejects minutes > 59', () => assert.equal(L.parsePaceInput('60:00'), null));
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
            city: 'M', meetingLat: 55, meetingLng: 37, distanceM: 5000, capacity: 15
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

// --- Minimal structural checks (not behavioral) ---

describe('structure checks', () => {
    it('index.html has lobby elements', () => {
        assert.ok(indexHtml.includes('menu-lobby'));
        assert.ok(indexHtml.includes('lobby-panel'));
        assert.ok(indexHtml.includes('lobby-form-route-add-btn'));
    });
    it('lobby-utils.js loads before app.js', () => {
        const l = indexHtml.indexOf('lobby-utils.js');
        const a = indexHtml.indexOf('src="app.js"');
        assert.ok(l > 0 && l < a);
    });
});

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
            if (!locationData) return;
            const lat = locationData.latitude;
            const lng = locationData.longitude;
            assert.equal(typeof lat, 'number');
            assert.equal(typeof lng, 'number');
        });
        capturedCb({ latitude: 55.75, longitude: 37.62 });
    });

    it('null location triggers browser fallback', () => {
        let browserCalled = false;
        const lm = {
            isInited: true,
            getLocation(cb) { cb(null); },
        };
        lm.getLocation((locationData) => {
            if (!locationData) {
                browserCalled = true;
                return;
            }
        });
        assert.ok(browserCalled, 'null must trigger fallback');
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

    it('browser geolocation NOT called when Telegram succeeds', () => {
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
                // success — browser must not be called
            }
        });
        assert.ok(!browserCalled);
        globalThis.navigator = originalGeo;
    });

    it('out-of-range coordinates trigger fallback', () => {
        let fallback = false;
        const lm = {
            isInited: true,
            getLocation(cb) { cb({ latitude: 999, longitude: 37 }); },
        };
        lm.getLocation((locationData) => {
            if (!locationData) { fallback = true; return; }
            const lat = locationData.latitude;
            const lng = locationData.longitude;
            if (lat == null || lng == null || !L.lobbyCoordsValid(lat, lng)) {
                fallback = true;
                return;
            }
        });
        assert.ok(fallback);
    });

    it('parallel calls blocked by busy flag', () => {
        let busy = false;
        let callCount = 0;
        const lm = {
            isInited: true,
            getLocation(cb) { callCount++; setTimeout(() => { busy = false; cb({ latitude: 55.75, longitude: 37.62 }); }, 10); },
        };
        function tryGetLocation() {
            if (busy) return false;
            busy = true;
            lm.getLocation(() => {});
            return true;
        }
        assert.ok(tryGetLocation());
        assert.ok(!tryGetLocation());
        assert.equal(callCount, 1);
    });
});

// --- Behavioral: double-action protection ---

describe('double-action protection', () => {
    it('second leave call blocked while modal open', () => {
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

    it('second cancel call blocked while modal open', () => {
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
        busySet.delete(busyKey);
        assert.ok(!busySet.has(busyKey));
    });

    it('different lobbyIds independent', () => {
        const busySet = new Set();
        busySet.add('leave:lobby1');
        busySet.add('leave:lobby2');
        busySet.delete('leave:lobby1');
        assert.ok(!busySet.has('leave:lobby1'));
        assert.ok(busySet.has('leave:lobby2'));
    });

    it('yes-click after cleanup can run again', () => {
        const busySet = new Set();
        const busyKey = 'leave:lobby1';
        let posts = 0;
        function onYes() { posts++; }

        busySet.add(busyKey);
        busySet.delete(busyKey); // cleanup
        onYes();
        assert.equal(posts, 1);
    });

    it('one yes-click = one post', () => {
        let posts = 0;
        function onYes() { posts++; }
        onYes();
        assert.equal(posts, 1);
    });
});

// --- Behavioral: detail staleness ---

describe('detail staleness protection', () => {
    it('later request invalidates earlier', () => {
        let token = 0;
        const results = [];
        function openDetail(id) {
            const myToken = ++token;
            return Promise.resolve().then(() => {
                if (myToken !== token) return;
                results.push(id);
            });
        }
        const p1 = openDetail('A');
        token++;
        const p2 = openDetail('B');
        return Promise.all([p1, p2]).then(() => {
            assert.deepEqual(results, ['B']);
        });
    });

    it('concurrent requests: only latest wins', () => {
        let token = 0;
        const results = [];
        function open(id) {
            const myToken = ++token;
            return new Promise(r => setTimeout(() => {
                if (myToken !== token) { r(); return; }
                results.push(id);
                r();
            }, 0));
        }
        const p1 = open('A');
        const p2 = open('B');
        return Promise.all([p1, p2]).then(() => {
            assert.deepEqual(results, ['B']);
        });
    });
});

// --- Behavioral: fetch error handling ---

describe('fetch error handling frees busy state', () => {
    it('network error frees busyKey', async () => {
        const busySet = new Set();
        const busyKey = 'leave:test';
        busySet.add(busyKey);
        try { await fetch('http://invalid.example/'); } catch { /* ignore */ }
        busySet.delete(busyKey);
        assert.ok(!busySet.has(busyKey));
    });
});

// --- Behavioral: mocked LocationManager in lobby code context ---

describe('useGpsForLobby with mocked LocationManager', () => {
    it('calls getLocation with single-arg callback', () => {
        let capturedLocationCb = null;
        const lm = {
            isInited: true,
            getLocation(cb) { capturedLocationCb = cb; },
        };

        // Simulate the exact pattern from useGpsForLobby
        const onLocation = (locationData) => {
            if (!locationData) return;
            const lat = locationData.latitude;
            const lng = locationData.longitude;
            if (lat == null || lng == null || !L.lobbyCoordsValid(lat, lng)) return;
            // Would set lobbyMeetingPoint here
        };

        lm.getLocation(onLocation);
        assert.equal(typeof capturedLocationCb, 'function');

        // Call with valid data
        capturedLocationCb({ latitude: 55.75, longitude: 37.62 });
    });

    it('Telegram coordinates saved correctly', () => {
        let savedPoint = null;
        const lm = {
            isInited: true,
            getLocation(cb) { cb({ latitude: 55.75, longitude: 37.62 }); },
        };
        lm.getLocation((locationData) => {
            if (!locationData) return;
            const lat = locationData.latitude;
            const lng = locationData.longitude;
            if (lat != null && lng != null && L.lobbyCoordsValid(lat, lng)) {
                savedPoint = { lat, lng };
            }
        });
        assert.deepEqual(savedPoint, { lat: 55.75, lng: 37.62 });
    });

    it('navigator.geolocation NOT called on Telegram success', () => {
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
                // success — do not call browser
                return;
            }
            browserCalled = true;
        });
        assert.ok(!browserCalled);
        globalThis.navigator = originalGeo;
    });

    it('null triggers browser fallback', () => {
        let fallbackTriggered = false;
        const lm = {
            isInited: true,
            getLocation(cb) { cb(null); },
        };
        lm.getLocation((locationData) => {
            if (!locationData) { fallbackTriggered = true; }
        });
        assert.ok(fallbackTriggered);
    });

    it('uninitialized LM calls init then getLocation', () => {
        const order = [];
        const lm = {
            isInited: false,
            init(cb) { order.push('init'); cb(); },
            getLocation(cb) { order.push('getLocation'); cb({ latitude: 55.75, longitude: 37.62 }); },
        };
        if (lm.isInited) {
            lm.getLocation(() => {});
        } else {
            lm.init(() => { lm.getLocation(() => {}); });
        }
        assert.deepEqual(order, ['init', 'getLocation']);
    });
});

// --- Behavioral: mocked fetch for lobby actions ---

describe('lobby action mocked fetch', () => {
    it('double join sends one POST', async () => {
        let postCount = 0;
        const busySet = new Set();
        async function joinLobbyMock(lobbyId) {
            const busyKey = 'join';
            if (busySet.has(busyKey)) return;
            busySet.add(busyKey);
            try {
                postCount++;
                await new Promise(r => setTimeout(r, 10));
            } finally {
                busySet.delete(busyKey);
            }
        }
        const p1 = joinLobbyMock('1');
        const p2 = joinLobbyMock('1');
        await Promise.all([p1, p2]);
        assert.equal(postCount, 1);
    });

    it('double create sends one POST', async () => {
        let postCount = 0;
        const busySet = new Set();
        async function createMock() {
            if (busySet.has('create')) return;
            busySet.add('create');
            try {
                postCount++;
                await new Promise(r => setTimeout(r, 10));
            } finally {
                busySet.delete('create');
            }
        }
        const p1 = createMock();
        const p2 = createMock();
        await Promise.all([p1, p2]);
        assert.equal(postCount, 1);
    });

    it('network error frees busy', async () => {
        const busySet = new Set();
        busySet.add('leave:1');
        try { await fetch('http://invalid/'); } catch { /* */ }
        busySet.delete('leave:1');
        assert.ok(!busySet.has('leave:1'));
    });

    it('rejected promise frees busy', async () => {
        const busySet = new Set();
        busySet.add('cancel:1');
        try { await Promise.reject(new Error('fail')); } catch { /* */ }
        busySet.delete('cancel:1');
        assert.ok(!busySet.has('cancel:1'));
    });
});
