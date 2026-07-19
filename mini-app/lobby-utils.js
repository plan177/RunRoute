(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.RunRouteLobbyUtils = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatRunType(type) {
        const types = {
            easy: 'Лёгкая', recovery: 'Восстановительная', long: 'Длительная',
            tempo: 'Темповая', intervals: 'Интервалы', hills: 'Горки',
            trail: 'Трейл', other: 'Другая'
        };
        return types[type] || type || '';
    }

    function formatLobbyDate(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })
                + ', ' + d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return iso;
        }
    }

    function formatParticipants(count, capacity) {
        if (capacity == null) return String(count || 0);
        return (count || 0) + ' / ' + capacity;
    }

    function formatDistanceM(m) {
        if (m == null) return '';
        return (m / 1000).toFixed(1) + ' км';
    }

    function formatPace(secPerKm) {
        if (secPerKm == null) return '';
        const m = Math.floor(secPerKm / 60);
        const s = secPerKm % 60;
        return m + ':' + String(s).padStart(2, '0') + ' /км';
    }

    function parsePaceInput(str) {
        if (!str || !str.trim()) return null;
        const parts = str.trim().split(':');
        if (parts.length === 2) {
            const m = parseInt(parts[0], 10);
            const s = parseInt(parts[1], 10);
            if (isNaN(m) || isNaN(s) || m < 0 || s < 0 || s >= 60) return null;
            return m * 60 + s;
        }
        const num = parseInt(str, 10);
        if (isNaN(num) || num < 0) return null;
        return num;
    }

    function formatPaceInput(secPerKm) {
        if (secPerKm == null) return '';
        const m = Math.floor(secPerKm / 60);
        const s = secPerKm % 60;
        return m + ':' + String(s).padStart(2, '0');
    }

    function validateFutureDate(dateStr) {
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        return d.getTime() > Date.now();
    }

    function validateCapacity(value) {
        const n = Number(value);
        return Number.isInteger(n) && n >= 2 && n <= 100;
    }

    function getFirstRoutePoint(route) {
        if (!route || !Array.isArray(route.points) || route.points.length === 0) return null;
        const p = route.points[0];
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;
        if (!isFinite(p.lat) || !isFinite(p.lng)) return null;
        return { lat: p.lat, lng: p.lng };
    }

    function getLobbyErrorText(status, detail) {
        if (detail && typeof detail === 'string') {
            const lower = detail.toLowerCase();
            if (lower.includes('public') || lower.includes('профил')) {
                return 'Для совместных пробежек нужен публичный профиль';
            }
        }
        switch (status) {
            case 400: return 'Некорректные данные. Проверьте форму';
            case 401: return 'Не удалось подтвердить авторизацию Telegram';
            case 403: return 'Действие запрещено';
            case 404: return 'Пробежка больше недоступна';
            case 409: return 'Пробежка завершена, отменена, уже началась или заполнена';
            case 422: return 'Проверьте заполнение формы';
            default: return 'Сервис временно недоступен';
        }
    }

    function buildLobbyCreatePayload(data) {
        const body = {
            title: data.title,
            run_type: data.runType,
            starts_at: data.startsAt,
            city: data.city,
            meeting_lat: data.meetingLat,
            meeting_lng: data.meetingLng,
        };
        if (data.areaLabel) body.area_label = data.areaLabel;
        if (data.savedRouteId) body.saved_route_id = data.savedRouteId;
        if (data.distanceM != null) body.distance_m = data.distanceM;
        if (data.paceMin != null) body.pace_min_sec_per_km = data.paceMin;
        if (data.paceMax != null) body.pace_max_sec_per_km = data.paceMax;
        if (data.durationMinutes != null) body.duration_minutes = data.durationMinutes;
        if (data.capacity != null) body.capacity = data.capacity;
        if (data.description) body.description = data.description;
        return body;
    }

    function renderLobbyCard(lobby) {
        const name = escapeHtml(lobby.title || '');
        const type = escapeHtml(formatRunType(lobby.run_type));
        const date = escapeHtml(formatLobbyDate(lobby.starts_at));
        const city = escapeHtml(lobby.city || '');
        const area = lobby.area_label ? '<span class="lobby-card-area">' + escapeHtml(lobby.area_label) + '</span>' : '';
        const dist = lobby.distance_m != null ? '<span class="lobby-card-dist">' + escapeHtml(formatDistanceM(lobby.distance_m)) + '</span>' : '';
        const pace = lobby.pace_min_sec_per_km != null ? '<span class="lobby-card-pace">' + escapeHtml(formatPace(lobby.pace_min_sec_per_km)) + '</span>' : '';
        const dur = lobby.duration_minutes != null ? '<span class="lobby-card-dur">' + lobby.duration_minutes + ' мин</span>' : '';
        const participants = escapeHtml(formatParticipants(lobby.participant_count, lobby.capacity));
        const orgName = lobby.organizer ? escapeHtml(lobby.organizer.display_name || 'Без имени') : '';
        const orgAvatar = lobby.organizer && lobby.organizer.avatar_url
            ? '<img class="lobby-card-avatar" src="' + escapeHtml(lobby.organizer.avatar_url) + '" alt="" />'
            : '<div class="lobby-card-avatar lobby-card-avatar-empty"></div>';

        return '<div class="lobby-card" data-lobby-id="' + escapeHtml(lobby.id) + '">'
            + '<div class="lobby-card-header">'
            + '<div class="lobby-card-title">' + name + '</div>'
            + '<div class="lobby-card-type">' + type + '</div>'
            + '</div>'
            + '<div class="lobby-card-meta">'
            + '<span class="lobby-card-date">' + date + '</span>'
            + '<span class="lobby-card-city">' + city + area + '</span>'
            + '</div>'
            + '<div class="lobby-card-details">'
            + dist + pace + dur
            + '</div>'
            + '<div class="lobby-card-footer">'
            + '<div class="lobby-card-org">' + orgAvatar + '<span>' + orgName + '</span></div>'
            + '<div class="lobby-card-participants">👤 ' + participants + '</div>'
            + '</div>'
            + '</div>';
    }

    return {
        escapeHtml, formatRunType, formatLobbyDate, formatParticipants,
        formatDistanceM, formatPace, parsePaceInput, formatPaceInput,
        validateFutureDate, validateCapacity, getFirstRoutePoint,
        getLobbyErrorText, buildLobbyCreatePayload, renderLobbyCard
    };
});
