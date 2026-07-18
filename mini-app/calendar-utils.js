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

    function formatRouteMode(mode) {
        const modes = { auto: 'Авто', manual: 'Вручную', track: 'GPS' };
        return modes[mode] || mode;
    }

    function formatDistanceM(m) {
        return (m / 1000).toFixed(1) + ' км';
    }

    function formatDate(iso) {
        return new Date(iso).toLocaleDateString('ru');
    }

    function dedupRoutesById(routes) {
        const seen = new Set();
        return routes.filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
    }

    function buildRouteDetailUrl(routeId) {
        return `/api/routes/${routeId}`;
    }

    function buildRouteUpdateUrl(routeId) {
        return `/api/routes/${routeId}`;
    }

    function buildRouteDeleteUrl(routeId) {
        return `/api/routes/${routeId}`;
    }

    function buildCurrentRouteFromApi(apiRoute, makeGPXFn) {
        const points = apiRoute.points.map(p => ({ ...p }));
        return {
            source: 'saved',
            saved_route_id: apiRoute.id,
            route_mode: apiRoute.route_mode,
            name: apiRoute.name,
            points,
            distance_km: apiRoute.distance_m / 1000,
            gpx: makeGPXFn(points, apiRoute.name),
        };
    }

    function buildCalendarRunsUrl(from, to) {
        return '/api/calendar/runs?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    }

    function validateSavedRouteForDisplay(route) {
        if (!route || typeof route !== 'object') {
            throw new Error('Маршрут содержит некорректные данные');
        }
        if (route.id == null) {
            throw new Error('Маршрут содержит некорректные данные');
        }
        if (!Array.isArray(route.points)) {
            throw new Error('Маршрут содержит некорректные данные');
        }
        if (route.points.length < 2) {
            throw new Error('Маршрут содержит некорректные данные');
        }
        for (const p of route.points) {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number' ||
                !isFinite(p.lat) || !isFinite(p.lng)) {
                throw new Error('Маршрут содержит некорректные данные');
            }
        }
        if (route.distance_m == null || typeof route.distance_m !== 'number' || route.distance_m < 0 || !isFinite(route.distance_m)) {
            throw new Error('Маршрут содержит некорректные данные');
        }
        const validModes = { auto: true, manual: true, track: true };
        if (!validModes[route.route_mode]) {
            throw new Error('Маршрут содержит некорректные данные');
        }
        return {
            id: route.id,
            name: route.name || '',
            route_mode: route.route_mode,
            distance_m: route.distance_m,
            points: route.points,
        };
    }

    function classifyHttpError(status) {
        if (status === 401) return 'Не удалось подтвердить авторизацию Telegram';
        if (status === 404) return 'Маршрут не найден';
        if (status >= 500) return 'Сервис временно недоступен';
        return 'Не удалось загрузить маршрут';
    }

    /**
     * Process two raw fetch results (responses or errors) for calendar data.
     * Returns { runs, routes, runsError, routesError }.
     * Each error is one of: null, 'auth', 'not_found', 'server', 'network', 'unknown'.
     * Both resources are processed independently — one failing does not affect the other.
     */
    async function fetchCalendarData(runsResult, routesResult, dedupFn) {
        let runs = [];
        let runsError = null;
        let routes = [];
        let routesError = null;

        // Process runs
        if (!runsResult || !('ok' in runsResult)) {
            runsError = 'network';
        } else if (runsResult.ok) {
            try {
                const data = await runsResult.json();
                runs = data.runs || [];
            } catch {
                runsError = 'unknown';
            }
        } else {
            runs = [];
            if (runsResult.status === 401) runsError = 'auth';
            else if (runsResult.status === 404) runsError = 'not_found';
            else if (runsResult.status >= 500) runsError = 'server';
            else runsError = 'unknown';
        }

        // Process routes
        if (!routesResult || !('ok' in routesResult)) {
            routesError = 'network';
        } else if (routesResult.ok) {
            try {
                const data = await routesResult.json();
                routes = dedupFn ? dedupFn(data.routes || []) : (data.routes || []);
            } catch {
                routesError = 'unknown';
            }
        } else {
            if (routesResult.status === 401) routesError = 'auth';
            else if (routesResult.status === 404) routesError = 'not_found';
            else if (routesResult.status >= 500) routesError = 'server';
            else routesError = 'unknown';
        }

        return { runs, routes, runsError, routesError };
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
        validatePointsCount,
        formatRouteMode,
        formatDistanceM,
        formatDate,
        dedupRoutesById,
        buildRouteDetailUrl,
        buildRouteUpdateUrl,
        buildRouteDeleteUrl,
        buildCurrentRouteFromApi,
        buildCalendarRunsUrl,
        fetchCalendarData,
        validateSavedRouteForDisplay,
        classifyHttpError
    };
});
