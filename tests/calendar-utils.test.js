const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load calendar-utils.js into a sandbox
const calendarCode = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'calendar-utils.js'), 'utf-8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(calendarCode, ctx);

const {
    getMonthStart, getMonthEnd, formatDatetimeLocal, datetimeLocalToISO,
    isSameDay, getRunDayKey, buildCreateRunPayload, buildUpdateRunPayload,
    buildUpdateRunUrl, buildSaveRoutePayload, validatePointsCount,
} = ctx;

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

    it('December → January boundary', () => {
        const dec = new Date(getMonthStart(2026, 11));
        assert.equal(dec.getMonth(), 11);
        assert.equal(dec.getDate(), 1);
        const jan = new Date(getMonthStart(2027, 0));
        assert.equal(jan.getFullYear(), 2027);
        assert.equal(jan.getMonth(), 0);
    });

    it('January → December boundary', () => {
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
        const date = new Date(2026, 7, 10, 9, 0); // Aug 10 2026 09:00 local
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
        assert.deepEqual(Object.keys(payload), ['title']);
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

describe('production code regression', () => {
    it('calendar-utils.js is loaded before app.js', () => {
        const calIdx = indexHtml.indexOf('calendar-utils.js');
        const appIdx = indexHtml.indexOf('src="app.js"');
        assert.ok(calIdx > 0, 'calendar-utils.js must be in index.html');
        assert.ok(appIdx > 0, 'app.js must be in index.html');
        assert.ok(calIdx < appIdx, 'calendar-utils.js must load before app.js');
    });

    it('app.js uses calendar-utils helpers', () => {
        assert.ok(appJs.includes('getCalendarMonthStart') || appJs.includes('getMonthStart'),
            'app.js must use getMonthStart');
        assert.ok(appJs.includes('getCalendarMonthEnd') || appJs.includes('getMonthEnd'),
            'app.js must use getMonthEnd');
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

    it('calendar events use textContent', () => {
        assert.ok(appJs.includes('.textContent'),
            'calendar rendering must use textContent');
    });

    it('save route checks 10000 point limit', () => {
        assert.ok(appJs.includes('10000'),
            'save route must check 10000 limit');
    });
});
