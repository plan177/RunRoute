(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.RunRouteCalendarUtils = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {

    function _localToISO(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        const offset = -date.getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const oh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
        const om = String(Math.abs(offset) % 60).padStart(2, '0');
        return `${y}-${m}-${d}T${h}:${min}:${s}${sign}${oh}:${om}`;
    }

    function getMonthStart(year, month) {
        return _localToISO(new Date(year, month, 1, 0, 0, 0));
    }

    function getMonthEnd(year, month) {
        return _localToISO(new Date(year, month + 1, 0, 23, 59, 59));
    }

    function formatDatetimeLocal(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d}T${h}:${min}`;
    }

    function datetimeLocalToISO(localStr) {
        return _localToISO(new Date(localStr));
    }

    function isSameDay(dateStr, year, month, day) {
        const d = new Date(dateStr);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    }

    function getRunDayKey(dateStr) {
        const d = new Date(dateStr);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    function buildCreateRunPayload({ title, startsAt, savedRouteId, durationMinutes, notes, reminderMinutes, notificationsEnabled }) {
        const body = {
            title,
            starts_at: typeof startsAt === 'string' ? startsAt : _localToISO(new Date(startsAt)),
            duration_minutes: durationMinutes || null,
            notes: notes || null,
            reminder_minutes: reminderMinutes != null ? reminderMinutes : null,
            notifications_enabled: notificationsEnabled,
        };
        if (savedRouteId) body.saved_route_id = savedRouteId;
        return body;
    }

    function buildUpdateRunPayload({ title, startsAt, savedRouteId, durationMinutes, notes, reminderMinutes, notificationsEnabled }) {
        const body = {};
        if (title !== undefined) body.title = title;
        if (startsAt !== undefined) body.starts_at = typeof startsAt === 'string' ? startsAt : _localToISO(new Date(startsAt));
        if (savedRouteId !== undefined) body.saved_route_id = savedRouteId;
        if (durationMinutes !== undefined) body.duration_minutes = durationMinutes;
        if (notes !== undefined) body.notes = notes;
        if (reminderMinutes !== undefined) body.reminder_minutes = reminderMinutes;
        if (notificationsEnabled !== undefined) body.notifications_enabled = notificationsEnabled;
        return body;
    }

    function buildUpdateRunUrl(runId) {
        return `/api/calendar/runs/${runId}`;
    }

    function buildSaveRoutePayload({ name, routeMode, distanceM, points }) {
        return { name, route_mode: routeMode, distance_m: distanceM, points };
    }

    function validatePointsCount(points, max) {
        max = max || 10000;
        if (points.length > max) throw new Error(`Maximum ${max} points allowed`);
        return true;
    }

    return {
        getMonthStart,
        getMonthEnd,
        formatDatetimeLocal,
        datetimeLocalToISO,
        isSameDay,
        getRunDayKey,
        buildCreateRunPayload,
        buildUpdateRunPayload,
        buildUpdateRunUrl,
        buildSaveRoutePayload,
        validatePointsCount
    };
});
