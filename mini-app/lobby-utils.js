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
        const trimmed = str.trim();
        const parts = trimmed.split(':');
        if (parts.length === 2) {
            if (parts[0] === '' || parts[1] === '') return null;
            if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
            if (parts[1].length !== 2) return null;
            const m = parseInt(parts[0], 10);
            const s = parseInt(parts[1], 10);
            if (isNaN(m) || isNaN(s) || m < 0 || s < 0 || s >= 60) return null;
            if (m > 59) return null;
            return m * 60 + s;
        }
        if (!/^\d+$/.test(trimmed)) return null;
        const num = parseInt(trimmed, 10);
        if (isNaN(num) || num < 0) return null;
        return num;
    }

    function validatePaceInput(str) {
        if (!str || !str.trim()) return { valid: true, value: null };
        const value = parsePaceInput(str);
        if (value === null) return { valid: false, error: 'Темп должен быть в формате mm:ss или числом секунд' };
        if (value < 120 || value > 1800) return { valid: false, error: 'Темп должен быть от 2:00 до 30:00 /км' };
        return { valid: true, value };
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

    function validateStrictInteger(value, min, max) {
        if (value === '' || value == null) return true;
        if (typeof value === 'number') {
            return Number.isInteger(value) && value >= min && value <= max;
        }
        const s = String(value).trim();
        if (s === '') return true;
        if (!/^-?\d+$/.test(s)) return false;
        const n = parseInt(s, 10);
        return n >= min && n <= max;
    }

    function validateCapacity(value) {
        return validateStrictInteger(value, 2, 100);
    }

    function validateDistanceM(value) {
        if (value === '' || value == null) return true;
        if (!validateStrictInteger(value, 1, Infinity)) return false;
        return true;
    }

    function validateDuration(value) {
        return validateStrictInteger(value, 1, 1440);
    }

    function parseStrictInteger(value) {
        if (value === '' || value == null) return undefined;
        const s = String(value).trim();
        if (s === '') return undefined;
        if (!/^-?\d+$/.test(s)) return NaN;
        return parseInt(s, 10);
    }

    function getFirstRoutePoint(route) {
        if (!route || !Array.isArray(route.points)) return null;
        for (let i = 0; i < route.points.length; i++) {
            const p = route.points[i];
            if (p == null || typeof p !== 'object') continue;
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
            if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
            if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) continue;
            return { lat: p.lat, lng: p.lng };
        }
        return null;
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

    function isPrivateProfileError(status, detail) {
        return status === 400 && detail && typeof detail === 'string'
            && detail.toLowerCase().includes('public');
    }

    function buildLobbyQueryParams(filters, periodDays, cursor) {
        const params = new URLSearchParams();
        if (filters.city) params.set('city', filters.city);
        if (filters.run_type) params.set('run_type', filters.run_type);
        if (periodDays) {
            const d = new Date();
            d.setDate(d.getDate() + parseInt(periodDays));
            params.set('to', d.toISOString());
        }
        if (cursor) params.set('cursor', cursor);
        return params;
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

    function renderLobbyCard(lobby, safeCreateEl, safeAvatar) {
        const card = safeCreateEl('div', { className: 'lobby-card', 'data-lobby-id': lobby.id });

        const header = safeCreateEl('div', { className: 'lobby-card-header' });
        header.appendChild(safeCreateEl('div', { className: 'lobby-card-title', textContent: lobby.title || '' }));
        header.appendChild(safeCreateEl('div', { className: 'lobby-card-type', textContent: formatRunType(lobby.run_type) }));
        card.appendChild(header);

        const meta = safeCreateEl('div', { className: 'lobby-card-meta' });
        meta.appendChild(safeCreateEl('span', { className: 'lobby-card-date', textContent: formatLobbyDate(lobby.starts_at) }));
        const cityText = lobby.area_label ? (lobby.city || '') + ', ' + lobby.area_label : (lobby.city || '');
        meta.appendChild(safeCreateEl('span', { className: 'lobby-card-city', textContent: cityText }));
        card.appendChild(meta);

        const details = safeCreateEl('div', { className: 'lobby-card-details' });
        if (lobby.distance_m != null) {
            details.appendChild(safeCreateEl('span', { className: 'lobby-card-dist', textContent: formatDistanceM(lobby.distance_m) }));
        }
        if (lobby.pace_min_sec_per_km != null) {
            details.appendChild(safeCreateEl('span', { className: 'lobby-card-pace', textContent: formatPace(lobby.pace_min_sec_per_km) }));
        }
        if (lobby.duration_minutes != null) {
            details.appendChild(safeCreateEl('span', { className: 'lobby-card-dur', textContent: lobby.duration_minutes + ' мин' }));
        }
        card.appendChild(details);

        const footer = safeCreateEl('div', { className: 'lobby-card-footer' });
        const orgDiv = safeCreateEl('div', { className: 'lobby-card-org' });
        if (lobby.organizer) {
            orgDiv.appendChild(safeAvatar(lobby.organizer.avatar_url, 20));
            orgDiv.appendChild(safeCreateEl('span', { textContent: lobby.organizer.display_name || 'Без имени' }));
        }
        footer.appendChild(orgDiv);
        footer.appendChild(safeCreateEl('div', { className: 'lobby-card-participants', textContent: '\uD83D\uDC64 ' + formatParticipants(lobby.participant_count, lobby.capacity) }));
        card.appendChild(footer);

        return card;
    }

    function lobbyCoordsValid(lat, lng) {
        return typeof lat === 'number' && typeof lng === 'number'
            && isFinite(lat) && isFinite(lng)
            && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }

    return {
        escapeHtml, formatRunType, formatLobbyDate, formatParticipants,
        formatDistanceM, formatPace, parsePaceInput, validatePaceInput,
        formatPaceInput, validateFutureDate, validateCapacity,
        validateDistanceM, validateDuration, validateStrictInteger,
        parseStrictInteger, lobbyCoordsValid,
        getFirstRoutePoint, getLobbyErrorText, isPrivateProfileError,
        buildLobbyQueryParams, buildLobbyCreatePayload, renderLobbyCard
    };
});
