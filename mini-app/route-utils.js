(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.RunRouteUtils = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function haversine(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function haversineArr(pts) {
        let total = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            total += haversine(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
        }
        return total;
    }

    function interpolatePoints(p1, p2, numPoints) {
        const points = [];
        for (let i = 1; i <= numPoints; i++) {
            const t = i / (numPoints + 1);
            points.push({
                lat: p1.lat + (p2.lat - p1.lat) * t,
                lon: p1.lon + (p2.lon - p1.lon) * t
            });
        }
        return points;
    }

    function addIntermediateWaypoints(waypoints) {
        if (waypoints.length < 2) return waypoints;

        const result = [waypoints[0]];
        for (let i = 0; i < waypoints.length - 1; i++) {
            const p1 = waypoints[i];
            const p2 = waypoints[i + 1];
            const dist = haversine(p1.lat, p1.lon, p2.lat, p2.lon);
            const numIntermediate = Math.min(20, Math.max(1, Math.floor(dist / 0.1)));
            result.push(...interpolatePoints(p1, p2, numIntermediate));
            result.push(p2);
        }
        return result;
    }

    return {
        haversine,
        haversineArr,
        interpolatePoints,
        addIntermediateWaypoints
    };
});
