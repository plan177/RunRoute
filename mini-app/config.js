window.RUNROUTE_CONFIG = {
    API_BASE_URL: 'https://authentic-growth-runroute-pr-51.up.railway.app'
};

function apiUrl(path) {
    const base = (window.RUNROUTE_CONFIG.API_BASE_URL || '').replace(/\/+$/, '');
    if (!base) return path;
    return base + path;
}
