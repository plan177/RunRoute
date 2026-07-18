const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load calendar-utils.js into a sandbox (UMD module)
const calendarCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'calendar-utils.js'), 'utf-8');
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(calendarCode, ctx);

const {
    getMonthStart, getMonthEnd, formatDatetimeLocal, datetimeLocalToISO,
    isSameDay, getRunDayKey, buildCreateRunPayload, buildUpdateRunPayload,
    buildUpdateRunUrl, buildSaveRoutePayload, validatePointsCount,
    buildCurrentRouteFromApi, buildCalendarRunsUrl, fetchCalendarData,
} = ctx.RunRouteCalendarUtils || ctx.module.exports;

// Also read production files for regression checks
const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

describe('getMonthStart / getMonthEnd', () => {
    it('returns correct start for January', () => {
        const result = new Date(getMonthStart(2026, 0));
        assert.equal(result.getFullYear(), 2026);
        assert.equal(result.getMonth(), 0);
        assert.equal(result.getDate(), 1);
        assert.equal(result.getHours(), 0);
        assert.equal(result.getMinutes(), 0);
    });

    it('returns correct end for January', () => {
        const result = new Date(getMonthEnd(2026, 0));
        assert.equal(result.getFullYear(), 2026);
        assert.equal(result.getMonth(), 0);
        assert.equal(result.getDate(), 31);
        assert.equal(result.getHours(), 23);
        assert.equal(result.getMinutes(), 59);
    });

    it('December -> January boundary', () => {
        const dec = new Date(getMonthStart(2026, 11));
        assert.equal(dec.getMonth(), 11);
        assert.equal(dec.getDate(), 1);
        const jan = new Date(getMonthStart(2027, 0));
        assert.equal(jan.getFullYear(), 2027);
        assert.equal(jan.getMonth(), 0);
    });

    it('January -> December boundary', () => {
        const dec = new Date(getMonthEnd(2025, 11));
        assert.equal(dec.getFullYear(), 2025);
        assert.equal(dec.getMonth(), 11);
        assert.equal(dec.getDate(), 31);
    });

    it('leap year February', () => {
        const result = new Date(getMonthEnd(2028, 1));
        assert.equal(result.getDate(), 29);
    });

    it('non-leap year February', () => {
        const result = new Date(getMonthEnd(2027, 1));
        assert.equal(result.getDate(), 28);
    });

    it('result contains timezone offset', () => {
        const result = getMonthStart(2026, 0);
        assert.ok(result.includes('+') || result.includes('-'),
            'ISO string must contain timezone offset');
    });
});

describe('formatDatetimeLocal', () => {
    it('formats date without UTC shift', () => {
        const date = new Date(2026, 7, 10, 9, 0);
        const result = formatDatetimeLocal(date);
        assert.equal(result, '2026-08-10T09:00');
    });

    it('pads single digits', () => {
        const date = new Date(2026, 0, 5, 8, 5);
        assert.equal(formatDatetimeLocal(date), '2026-01-05T08:05');
    });

    it('midnight', () => {
        const date = new Date(2026, 5, 15, 0, 0);
        assert.equal(formatDatetimeLocal(date), '2026-06-15T00:00');
    });
});

describe('datetimeLocalToISO', () => {
    it('converts local string to timezone-aware ISO', () => {
        const iso = datetimeLocalToISO('2026-08-10T09:00');
        const d = new Date(iso);
        assert.equal(d.getFullYear(), 2026);
        assert.equal(d.getMonth(), 7);
        assert.equal(d.getDate(), 10);
        assert.equal(d.getHours(), 9);
        assert.equal(d.getMinutes(), 0);
    });

    it('result contains timezone offset', () => {
        const iso = datetimeLocalToISO('2026-12-25T14:30');
        assert.ok(iso.includes('+') || iso.includes('-'),
            'must include timezone offset');
    });
});

describe('isSameDay', () => {
    it('same year, month, day', () => {
        assert.ok(isSameDay('2026-08-10T14:00:00+03:00', 2026, 7, 10));
    });

    it('different year', () => {
        assert.ok(!isSameDay('2025-08-10T14:00:00+03:00', 2026, 7, 10));
    });

    it('different month', () => {
        assert.ok(!isSameDay('2026-09-10T14:00:00+03:00', 2026, 7, 10));
    });

    it('different day', () => {
        assert.ok(!isSameDay('2026-08-11T14:00:00+03:00', 2026, 7, 10));
    });

    it('same day different time', () => {
        assert.ok(isSameDay('2026-08-10T23:59:59+03:00', 2026, 7, 10));
    });
});

describe('getRunDayKey', () => {
    it('returns year-month-day key', () => {
        const key = getRunDayKey('2026-08-10T14:00:00+03:00');
        assert.equal(key, '2026-7-10');
    });
});

describe('buildCreateRunPayload', () => {
    it('builds correct payload', () => {
        const payload = buildCreateRunPayload({
            title: 'Morning Run',
            startsAt: '2026-08-10T09:00:00+03:00',
            durationMinutes: 30,
            notes: 'Easy run',
            reminderMinutes: 15,
            notificationsEnabled: true,
        });
        assert.equal(payload.title, 'Morning Run');
        assert.equal(payload.starts_at, '2026-08-10T09:00:00+03:00');
        assert.equal(payload.duration_minutes, 30);
        assert.equal(payload.notes, 'Easy run');
        assert.equal(payload.reminder_minutes, 15);
        assert.equal(payload.notifications_enabled, true);
        assert.equal(payload.saved_route_id, undefined);
    });

    it('includes saved_route_id when provided', () => {
        const payload = buildCreateRunPayload({
            title: 'Run', startsAt: '2026-08-10T09:00:00+03:00',
            savedRouteId: 'route-123', notificationsEnabled: false,
        });
        assert.equal(payload.saved_route_id, 'route-123');
        assert.equal(payload.notifications_enabled, false);
    });

    it('nullifies optional fields', () => {
        const payload = buildCreateRunPayload({
            title: 'Run', startsAt: '2026-08-10T09:00:00+03:00',
            notificationsEnabled: true,
        });
        assert.equal(payload.duration_minutes, null);
        assert.equal(payload.notes, null);
        assert.equal(payload.reminder_minutes, null);
    });

    it('converts Date object to ISO', () => {
        const payload = buildCreateRunPayload({
            title: 'Run', startsAt: new Date(2026, 7, 10, 9, 0),
            notificationsEnabled: true,
        });
        assert.ok(typeof payload.starts_at === 'string');
        assert.ok(payload.starts_at.includes('2026'));
    });
});

describe('buildUpdateRunPayload', () => {
    it('only includes provided fields', () => {
        const payload = buildUpdateRunPayload({ title: 'Updated' });
        assert.equal(Object.keys(payload).length, 1);
        assert.equal(payload.title, 'Updated');
    });

    it('includes multiple fields', () => {
        const payload = buildUpdateRunPayload({
            title: 'Updated', durationMinutes: 45, notes: 'New notes',
        });
        assert.equal(payload.title, 'Updated');
        assert.equal(payload.duration_minutes, 45);
        assert.equal(payload.notes, 'New notes');
        assert.equal(Object.keys(payload).length, 3);
    });

    it('sets saved_route_id to null explicitly', () => {
        const payload = buildUpdateRunPayload({ savedRouteId: null });
        assert.equal(Object.keys(payload).length, 1);
        assert.equal(payload.saved_route_id, null);
    });
});

describe('buildUpdateRunUrl', () => {
    it('builds correct URL', () => {
        assert.equal(buildUpdateRunUrl('abc-123'), '/api/calendar/runs/abc-123');
    });
});

describe('buildSaveRoutePayload', () => {
    it('builds route payload', () => {
        const payload = buildSaveRoutePayload({
            name: 'Morning Route',
            routeMode: 'auto',
            distanceM: 5000,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        });
        assert.equal(payload.name, 'Morning Route');
        assert.equal(payload.route_mode, 'auto');
        assert.equal(payload.distance_m, 5000);
        assert.equal(payload.points.length, 2);
    });
});

describe('validatePointsCount', () => {
    it('accepts 10000 points', () => {
        const points = Array.from({ length: 10000 }, () => ({ lat: 0, lng: 0 }));
        assert.ok(validatePointsCount(points, 10000));
    });

    it('rejects 10001 points', () => {
        const points = Array.from({ length: 10001 }, () => ({ lat: 0, lng: 0 }));
        assert.throws(() => validatePointsCount(points, 10000), /Maximum/);
    });

    it('default max is 10000', () => {
        const points = Array.from({ length: 10001 }, () => ({ lat: 0, lng: 0 }));
        assert.throws(() => validatePointsCount(points), /Maximum/);
    });
});

describe('UMD module', () => {
    it('exports via RunRouteCalendarUtils', () => {
        const ctx2 = { module: { exports: {} } };
        vm.createContext(ctx2);
        vm.runInContext(calendarCode, ctx2);
        assert.ok(ctx2.RunRouteCalendarUtils, 'must export via RunRouteCalendarUtils');
        assert.equal(typeof ctx2.RunRouteCalendarUtils.getMonthStart, 'function');
        assert.equal(typeof ctx2.RunRouteCalendarUtils.formatDatetimeLocal, 'function');
    });
});

describe('production code regression', () => {
    it('calendar-utils.js is loaded before app.js', () => {
        const calIdx = indexHtml.indexOf('calendar-utils.js');
        const appIdx = indexHtml.indexOf('src="app.js"');
        assert.ok(calIdx > 0, 'calendar-utils.js must be in index.html');
        assert.ok(appIdx > 0, 'app.js must be in index.html');
        assert.ok(calIdx < appIdx, 'calendar-utils.js must load before app.js');
    });

    it('app.js imports from RunRouteCalendarUtils', () => {
        assert.ok(appJs.includes('RunRouteCalendarUtils'),
            'app.js must import from RunRouteCalendarUtils');
    });

    it('app.js does not redefine getMonthStart/getMonthEnd', () => {
        assert.ok(!appJs.includes('function getMonthStart('),
            'app.js must not define getMonthStart');
        assert.ok(!appJs.includes('function getMonthEnd('),
            'app.js must not define getMonthEnd');
    });

    it('app.js uses calGetMonthStart/calGetMonthEnd', () => {
        assert.ok(appJs.includes('calGetMonthStart'),
            'app.js must use calGetMonthStart');
        assert.ok(appJs.includes('calGetMonthEnd'),
            'app.js must use calGetMonthEnd');
    });

    it('app.js uses formatDatetimeLocal for edit', () => {
        assert.ok(appJs.includes('formatDatetimeLocal'),
            'app.js must use formatDatetimeLocal');
    });

    it('app.js uses datetimeLocalToISO for save', () => {
        assert.ok(appJs.includes('datetimeLocalToISO'),
            'app.js must use datetimeLocalToISO');
    });

    it('app.js uses isSameDay for event filtering', () => {
        assert.ok(appJs.includes('isSameDay'),
            'app.js must use isSameDay');
    });

    it('app.js uses getRunDayKey for day highlighting', () => {
        assert.ok(appJs.includes('getRunDayKey'),
            'app.js must use getRunDayKey');
    });

    it('app.js has race condition protection', () => {
        assert.ok(appJs.includes('calRequestSeq'),
            'app.js must have request sequence counter');
    });

    it('app.js resets selected date on month change', () => {
        assert.ok(appJs.includes('calSelectedDate > daysInMonth') || appJs.includes('calSelectedDate = null'),
            'must reset selected date when out of range');
    });

    it('shareRoute returns explicit result', () => {
        assert.ok(appJs.includes("return 'shared'") || appJs.includes('return "shared"'),
            'shareRoute must return shared');
        assert.ok(appJs.includes("return 'cancelled'") || appJs.includes('return "cancelled"'),
            'shareRoute must return cancelled');
        assert.ok(appJs.includes("return 'downloaded'") || appJs.includes('return "downloaded"'),
            'shareRoute must return downloaded');
        assert.ok(appJs.includes("return 'failed'") || appJs.includes('return "failed"'),
            'shareRoute must return failed');
    });

    it('mode switch checks share result before clearing', () => {
        assert.ok(appJs.includes('shareResult'),
            'mode switch must check shareResult');
    });
});

// --- Saved routes management tests ---

const {
    formatRouteMode, formatDistanceM, formatDate, dedupRoutesById,
    buildRouteDetailUrl, buildRouteUpdateUrl, buildRouteDeleteUrl,
} = ctx.RunRouteCalendarUtils || ctx.module.exports;

describe('formatRouteMode', () => {
    it('formats auto as Авто', () => {
        assert.equal(formatRouteMode('auto'), 'Авто');
    });
    it('formats manual as Вручную', () => {
        assert.equal(formatRouteMode('manual'), 'Вручную');
    });
    it('formats track as GPS', () => {
        assert.equal(formatRouteMode('track'), 'GPS');
    });
    it('returns raw value for unknown mode', () => {
        assert.equal(formatRouteMode('swim'), 'swim');
    });
});

describe('formatDistanceM', () => {
    it('formats 5000m as 5.0 км', () => {
        assert.equal(formatDistanceM(5000), '5.0 км');
    });
    it('formats 21097m as 21.1 км', () => {
        assert.equal(formatDistanceM(21097), '21.1 км');
    });
    it('formats 1000m as 1.0 км', () => {
        assert.equal(formatDistanceM(1000), '1.0 км');
    });
});

describe('formatDate', () => {
    it('formats ISO date string', () => {
        const result = formatDate('2025-06-15T10:30:00Z');
        assert.ok(typeof result === 'string');
        assert.ok(result.length > 0);
    });
});

describe('dedupRoutesById', () => {
    it('removes duplicate ids, keeps first', () => {
        const routes = [
            { id: 'a', name: 'First' },
            { id: 'b', name: 'Second' },
            { id: 'a', name: 'Duplicate' },
        ];
        const result = dedupRoutesById(routes);
        assert.equal(result.length, 2);
        assert.equal(result[0].name, 'First');
        assert.equal(result[1].name, 'Second');
    });
    it('returns empty array for empty input', () => {
        assert.deepEqual(dedupRoutesById([]), []);
    });
    it('keeps all unique routes', () => {
        const routes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        assert.equal(dedupRoutesById(routes).length, 3);
    });
});

describe('route URL builders', () => {
    it('buildRouteDetailUrl', () => {
        assert.equal(buildRouteDetailUrl('abc'), '/api/routes/abc');
    });
    it('buildRouteUpdateUrl', () => {
        assert.equal(buildRouteUpdateUrl('abc'), '/api/routes/abc');
    });
    it('buildRouteDeleteUrl', () => {
        assert.equal(buildRouteDeleteUrl('abc'), '/api/routes/abc');
    });
});

describe('saved routes production code regression', () => {
    it('app.js imports formatRouteMode', () => {
        assert.ok(appJs.includes('formatRouteMode'), 'app.js must import formatRouteMode');
    });
    it('app.js imports dedupRoutesById', () => {
        assert.ok(appJs.includes('dedupRoutesById'), 'app.js must import dedupRoutesById');
    });
    it('app.js imports buildRouteDetailUrl', () => {
        assert.ok(appJs.includes('buildRouteDetailUrl'), 'app.js must import buildRouteDetailUrl');
    });
    it('app.js has loadSavedRoutes function', () => {
        assert.ok(appJs.includes('function loadSavedRoutes'), 'must have loadSavedRoutes');
    });
    it('app.js has renderSavedRoutes function', () => {
        assert.ok(appJs.includes('function renderSavedRoutes'), 'must have renderSavedRoutes');
    });
    it('app.js has openSavedRoute function', () => {
        assert.ok(appJs.includes('function openSavedRoute'), 'must have openSavedRoute');
    });
    it('app.js has renameSavedRoute function', () => {
        assert.ok(appJs.includes('function renameSavedRoute'), 'must have renameSavedRoute');
    });
    it('app.js has deleteSavedRoute function', () => {
        assert.ok(appJs.includes('function deleteSavedRoute'), 'must have deleteSavedRoute');
    });
    it('app.js has planRunWithRoute function', () => {
        assert.ok(appJs.includes('function planRunWithRoute'), 'must have planRunWithRoute');
    });
    it('app.js uses textContent for route cards', () => {
        assert.ok(!appJs.includes('card.innerHTML') && !appJs.includes('route.innerHTML'),
            'route cards must not use innerHTML for user data');
    });
    it('openSavedRoute does not call generateAutoRoute or Valhalla', () => {
        const openFn = appJs.substring(appJs.indexOf('function openSavedRoute'));
        const endIdx = openFn.indexOf('\n// === Init all ===');
        const fnBody = openFn.substring(0, endIdx > 0 ? endIdx : 2000);
        assert.ok(!fnBody.includes('generateAutoRoute'), 'must not call generateAutoRoute');
        assert.ok(!fnBody.includes('valhalla'), 'must not call Valhalla');
    });
    it('index.html has calendar tabs', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');
        assert.ok(html.includes('cal-tab-calendar'), 'must have calendar tab');
        assert.ok(html.includes('cal-tab-routes'), 'must have routes tab');
    });
    it('index.html has rename route modal', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');
        assert.ok(html.includes('rename-route-modal'), 'must have rename modal');
    });
    it('style.css has route card styles', () => {
        const css = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'style.css'), 'utf-8');
        assert.ok(css.includes('.cal-route-card'), 'must have route card style');
        assert.ok(css.includes('.cal-tab'), 'must have tab style');
    });
    it('cal-route-card does not require horizontal scroll', () => {
        const css = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'style.css'), 'utf-8');
        assert.ok(css.includes('.cal-route-actions'), 'must have actions style');
        assert.ok(css.includes('flex-wrap') || css.includes('white-space: nowrap'),
            'actions must handle narrow widths');
    });
});

// --- Saved route viewing tests ---

describe('buildCurrentRouteFromApi', () => {
    const fakeGPX = (points, name) => '<gpx>' + name + '</gpx>';

    it('preserves route_mode=auto', () => {
        const apiRoute = {
            id: 'r1', name: 'Auto Route', route_mode: 'auto', distance_m: 5000,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.equal(cr.route_mode, 'auto');
    });

    it('preserves route_mode=manual', () => {
        const apiRoute = {
            id: 'r2', name: 'Manual', route_mode: 'manual', distance_m: 3000,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.equal(cr.route_mode, 'manual');
    });

    it('preserves route_mode=track', () => {
        const apiRoute = {
            id: 'r3', name: 'Track', route_mode: 'track', distance_m: 10000,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.equal(cr.route_mode, 'track');
    });

    it('track points preserve time and accuracy', () => {
        const apiRoute = {
            id: 'r4', name: 'GPS Track', route_mode: 'track', distance_m: 2000,
            points: [
                { lat: 55.7, lng: 37.6, time: '2025-06-15T10:00:00Z', accuracy: 5.2 },
                { lat: 55.8, lng: 37.7, time: '2025-06-15T10:05:00Z', accuracy: 3.1 },
            ],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.equal(cr.points[0].time, '2025-06-15T10:00:00Z');
        assert.equal(cr.points[0].accuracy, 5.2);
        assert.equal(cr.points[1].time, '2025-06-15T10:05:00Z');
        assert.equal(cr.points[1].accuracy, 3.1);
    });

    it('currentRoute contains gpx', () => {
        const apiRoute = {
            id: 'r5', name: 'GPX Test', route_mode: 'auto', distance_m: 5000,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.ok(cr.gpx.includes('GPX Test'));
    });

    it('source is saved', () => {
        const apiRoute = {
            id: 'r6', name: 'Src', route_mode: 'auto', distance_m: 1000,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.equal(cr.source, 'saved');
    });

    it('saved_route_id matches', () => {
        const apiRoute = {
            id: 'r7', name: 'ID', route_mode: 'auto', distance_m: 1000,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.equal(cr.saved_route_id, 'r7');
    });

    it('distance_km computed from distance_m', () => {
        const apiRoute = {
            id: 'r8', name: 'Dist', route_mode: 'auto', distance_m: 7500,
            points: [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }],
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        assert.equal(cr.distance_km, 7.5);
    });

    it('points are copies, not originals', () => {
        const original = [{ lat: 55.7, lng: 37.6 }, { lat: 55.8, lng: 37.7 }];
        const apiRoute = {
            id: 'r9', name: 'Copy', route_mode: 'auto', distance_m: 1000,
            points: original,
        };
        const cr = buildCurrentRouteFromApi(apiRoute, fakeGPX);
        cr.points[0].lat = 0;
        assert.equal(original[0].lat, 55.7);
    });
});

describe('saved route viewing production code regression', () => {
    it('openSavedRoute uses buildCurrentRouteFromApi', () => {
        assert.ok(appJs.includes('buildCurrentRouteFromApi'),
            'openSavedRoute must use buildCurrentRouteFromApi');
    });

    it('openSavedRoute does not set routeMode', () => {
        const fn = appJs.substring(appJs.indexOf('async function openSavedRoute'));
        const endIdx = fn.indexOf('\nfunction renameSavedRoute');
        const body = fn.substring(0, endIdx > 0 ? endIdx : 2000);
        assert.ok(!body.includes("routeMode ="),
            'openSavedRoute must not change routeMode');
    });

    it('openSavedRoute does not call updateUIForMode', () => {
        const fn = appJs.substring(appJs.indexOf('async function openSavedRoute'));
        const endIdx = fn.indexOf('\nfunction renameSavedRoute');
        const body = fn.substring(0, endIdx > 0 ? endIdx : 2000);
        assert.ok(!body.includes('updateUIForMode'),
            'openSavedRoute must not call updateUIForMode');
    });

    it('openSavedRoute uses displayRoute', () => {
        const fn = appJs.substring(appJs.indexOf('async function openSavedRoute'));
        const endIdx = fn.indexOf('\nfunction renameSavedRoute');
        const body = fn.substring(0, endIdx > 0 ? endIdx : 2000);
        assert.ok(body.includes('displayRoute'),
            'openSavedRoute must use displayRoute');
    });

    it('openSavedRoute uses showRouteButtons saved', () => {
        const fn = appJs.substring(appJs.indexOf('async function openSavedRoute'));
        const endIdx = fn.indexOf('\nfunction renameSavedRoute');
        const body = fn.substring(0, endIdx > 0 ? endIdx : 2000);
        assert.ok(body.includes("showRouteButtons('saved')"),
            'openSavedRoute must show saved buttons');
    });

    it('showRouteButtons handles saved mode', () => {
        assert.ok(appJs.includes("'saved'") || appJs.includes('"saved"'),
            'showRouteButtons must handle saved mode');
    });

    it('deleteSavedRoute shows error on failure', () => {
        const fn = appJs.substring(appJs.indexOf('async function deleteSavedRoute'));
        const endIdx = fn.indexOf('\nfunction planRunWithRoute');
        const body = fn.substring(0, endIdx > 0 ? endIdx : 2000);
        assert.ok(body.includes("showToast('Не удалось удалить маршрут')") ||
                  body.includes('showToast("Не удалось удалить маршрут")'),
            'delete must show error on HTTP failure');
        assert.ok(body.includes("showToast('Ошибка сети')") ||
                  body.includes('showToast("Ошибка сети")'),
            'delete must show error on network failure');
    });

    it('deleteSavedRoute does not have silent catch', () => {
        const fn = appJs.substring(appJs.indexOf('async function deleteSavedRoute'));
        const endIdx = fn.indexOf('\nfunction planRunWithRoute');
        const body = fn.substring(0, endIdx > 0 ? endIdx : 2000);
        assert.ok(!body.includes('/* silent */'),
            'delete must not silently swallow errors');
    });
});


// --- Production bugfix: calendar URL encoding ---

describe('buildCalendarRunsUrl', () => {
    it('encodes + in timezone offset as %2B', () => {
        const url = buildCalendarRunsUrl(
            '2026-07-01T00:00:00+03:00',
            '2026-07-31T23:59:59+03:00'
        );
        assert.ok(url.includes('%2B03%3A00'),
            'URL must encode + as %2B: ' + url);
    });

    it('round-trips +03:00 correctly', () => {
        const from = '2026-07-01T00:00:00+03:00';
        const to = '2026-07-31T23:59:59+03:00';
        const url = buildCalendarRunsUrl(from, to);
        const params = new URLSearchParams(url.split('?')[1]);
        assert.equal(params.get('from'), from);
        assert.equal(params.get('to'), to);
    });

    it('preserves UTC Z timezone', () => {
        const url = buildCalendarRunsUrl(
            '2026-07-01T00:00:00Z',
            '2026-07-31T23:59:59Z'
        );
        assert.ok(url.includes('from=2026-07-01'), 'must contain from param');
        assert.ok(url.includes('to=2026-07-31'), 'must contain to param');
    });
});

describe('calendar partial availability', () => {
    it('app.js loads runs and routes via Promise.allSettled', () => {
        assert.ok(appJs.includes('Promise.allSettled'),
            'loadCalendarData must use Promise.allSettled');
    });

    it('loadCalendarData delegates to fetchCalendarData', () => {
        const fnStart = appJs.indexOf('async function loadCalendarData');
        const fnBody = appJs.substring(fnStart, fnStart + 1500);
        assert.ok(fnBody.includes('fetchCalendarData'),
            'must call fetchCalendarData');
    });

    it('routes use dedupRoutesById', () => {
        const fnStart = appJs.indexOf('async function loadCalendarData');
        const fnBody = appJs.substring(fnStart, fnStart + 1500);
        assert.ok(fnBody.includes('dedupRoutesById'),
            'must deduplicate routes');
    });

    it('app.js uses buildCalendarRunsUrl', () => {
        assert.ok(appJs.includes('buildCalendarRunsUrl'),
            'app.js must use buildCalendarRunsUrl');
    });

    it('app.js destructures buildCalendarRunsUrl', () => {
        assert.ok(appJs.includes('buildCalendarRunsUrl') &&
                  appJs.includes('RunRouteCalendarUtils'),
            'must import buildCalendarRunsUrl');
    });
});


// --- Behavioral tests for fetchCalendarData ---

function makeResponse(ok, status, body) {
    return {
        ok,
        status,
        json: async () => body,
    };
}

function makeNetworkError() {
    return new Error('Failed to fetch');
}

describe('fetchCalendarData — runs=500, routes=200', () => {
    it('routes saved, runsError present, routesError absent', async () => {
        const runsResp = makeResponse(false, 500, null);
        const routesResp = makeResponse(true, 200, { routes: [{ id: 'r1', name: 'Route 1' }] });
        const result = await fetchCalendarData(runsResp, routesResp, null);
        assert.equal(result.runs.length, 0);
        assert.equal(result.runsError, 'server');
        assert.equal(result.routesError, null);
        assert.equal(result.routes.length, 1);
        assert.equal(result.routes[0].id, 'r1');
    });
});

describe('fetchCalendarData — runs=200, routes=500', () => {
    it('runs saved, routesError present', async () => {
        const runsResp = makeResponse(true, 200, { runs: [{ id: 'run1', title: 'Morning' }] });
        const routesResp = makeResponse(false, 500, null);
        const result = await fetchCalendarData(runsResp, routesResp, null);
        assert.equal(result.runsError, null);
        assert.equal(result.routesError, 'server');
        assert.equal(result.runs.length, 1);
        assert.equal(result.runs[0].id, 'run1');
        assert.equal(result.routes.length, 0);
    });
});

describe('fetchCalendarData — both 200', () => {
    it('both saved, routes deduplicated', async () => {
        const runsResp = makeResponse(true, 200, { runs: [{ id: 'run1' }] });
        const routesResp = makeResponse(true, 200, { routes: [{ id: 'r1' }, { id: 'r1' }, { id: 'r2' }] });
        const result = await fetchCalendarData(runsResp, routesResp, dedupRoutesById);
        assert.equal(result.runsError, null);
        assert.equal(result.routesError, null);
        assert.equal(result.runs.length, 1);
        assert.equal(result.routes.length, 2);
    });
});

describe('fetchCalendarData — network error runs only', () => {
    it('successful routes not lost', async () => {
        const runsErr = makeNetworkError();
        const routesResp = makeResponse(true, 200, { routes: [{ id: 'r1' }] });
        const result = await fetchCalendarData(runsErr, routesResp, null);
        assert.equal(result.runsError, 'network');
        assert.equal(result.routesError, null);
        assert.equal(result.runs.length, 0);
        assert.equal(result.routes.length, 1);
    });
});

describe('fetchCalendarData — network error routes only', () => {
    it('successful runs not lost', async () => {
        const runsResp = makeResponse(true, 200, { runs: [{ id: 'run1' }] });
        const routesErr = makeNetworkError();
        const result = await fetchCalendarData(runsResp, routesErr, null);
        assert.equal(result.runsError, null);
        assert.equal(result.routesError, 'network');
        assert.equal(result.runs.length, 1);
        assert.equal(result.routes.length, 0);
    });
});

describe('fetchCalendarData — both fail', () => {
    it('returns both errors', async () => {
        const runsResp = makeResponse(false, 500, null);
        const routesResp = makeResponse(false, 500, null);
        const result = await fetchCalendarData(runsResp, routesResp, null);
        assert.equal(result.runsError, 'server');
        assert.equal(result.routesError, 'server');
        assert.equal(result.runs.length, 0);
        assert.equal(result.routes.length, 0);
    });

    it('mixed errors: network + auth', async () => {
        const runsErr = makeNetworkError();
        const routesResp = makeResponse(false, 401, null);
        const result = await fetchCalendarData(runsErr, routesResp, null);
        assert.equal(result.runsError, 'network');
        assert.equal(result.routesError, 'auth');
    });
});

describe('fetchCalendarData — 404 not_found', () => {
    it('returns not_found error', async () => {
        const runsResp = makeResponse(false, 404, null);
        const routesResp = makeResponse(true, 200, { routes: [] });
        const result = await fetchCalendarData(runsResp, routesResp, null);
        assert.equal(result.runsError, 'not_found');
        assert.equal(result.routesError, null);
    });
});

describe('fetchCalendarData — auth 401', () => {
    it('returns auth error', async () => {
        const runsResp = makeResponse(false, 401, null);
        const routesResp = makeResponse(false, 401, null);
        const result = await fetchCalendarData(runsResp, routesResp, null);
        assert.equal(result.runsError, 'auth');
        assert.equal(result.routesError, 'auth');
    });
});

describe('fetchCalendarData — bad json', () => {
    it('returns unknown error on json parse failure', async () => {
        const badResp = {
            ok: true,
            status: 200,
            json: async () => { throw new Error('bad json'); },
        };
        const routesResp = makeResponse(true, 200, { routes: [] });
        const result = await fetchCalendarData(badResp, routesResp, null);
        assert.equal(result.runsError, 'unknown');
        assert.equal(result.routesError, null);
    });
});

describe('loadCalendarData integration', () => {
    it('app.js uses Promise.allSettled', () => {
        assert.ok(appJs.includes('Promise.allSettled'),
            'loadCalendarData must use Promise.allSettled');
    });

    it('loadCalendarData returns { runsError, routesError }', () => {
        const fnStart = appJs.indexOf('async function loadCalendarData');
        const fnBody = appJs.substring(fnStart, fnStart + 1500);
        assert.ok(fnBody.includes('runsError') && fnBody.includes('routesError'),
            'must return runsError and routesError');
    });

    it('loadCalendarData calls fetchCalendarData', () => {
        const fnStart = appJs.indexOf('async function loadCalendarData');
        const fnBody = appJs.substring(fnStart, fnStart + 1500);
        assert.ok(fnBody.includes('fetchCalendarData'),
            'must call fetchCalendarData');
    });

    it('loadCalendarData uses dedupRoutesById', () => {
        const fnStart = appJs.indexOf('async function loadCalendarData');
        const fnBody = appJs.substring(fnStart, fnStart + 1500);
        assert.ok(fnBody.includes('dedupRoutesById'),
            'must pass dedupRoutesById');
    });

    it('openCalendar shows content on partial success', () => {
        const fnStart = appJs.indexOf('async function openCalendar');
        const fnBody = appJs.substring(fnStart, fnStart + 2500);
        assert.ok(fnBody.includes('cal-runs-status'),
            'must use cal-runs-status element');
    });

    it('openCalendar shows runs error separately', () => {
        const fnStart = appJs.indexOf('async function openCalendar');
        const fnBody = appJs.substring(fnStart, fnStart + 2500);
        assert.ok(fnBody.includes('runsError') && fnBody.includes('routesError'),
            'must handle both error types');
    });

    it('openCalendar does not hide content when one resource succeeds', () => {
        const fnStart = appJs.indexOf('async function openCalendar');
        const fnBody = appJs.substring(fnStart, fnStart + 2500);
        const partialIdx = fnBody.indexOf('At least one succeeded');
        assert.ok(partialIdx > 0,
            'must show content on partial success');
    });

    it('index.html has cal-runs-status element', () => {
        assert.ok(indexHtml.includes('id="cal-runs-status"'),
            'index.html must contain cal-runs-status');
    });
});
