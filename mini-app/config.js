window.RUNROUTE_CONFIG = window.RUNROUTE_CONFIG || {};

function apiUrl(path) {
    const base = (window.RUNROUTE_CONFIG.API_BASE_URL || '').replace(/\/+$/, '');
    if (!base) return path;
    return base + path;
}
