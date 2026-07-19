window.RUNROUTE_CONFIG = {
    API_BASE_URL: 'https://run-route-api-production.up.railway.app'
};

function apiUrl(path) {
    const base = (window.RUNROUTE_CONFIG.API_BASE_URL || '').replace(/\/+$/, '');
    if (!base) return path;
    return base + path;
}
