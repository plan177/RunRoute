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

    function escapeXml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function isValidTimestamp(time) {
        return time !== null && time !== undefined && 
               typeof time === 'number' && time > 0 && 
               isFinite(time) && !isNaN(time);
    }

    function makeGPX(points, name) {
        const exportTime = Date.now();
        const exportISO = new Date(exportTime).toISOString();
        let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
        gpx += '<gpx version="1.1" creator="RunRouteBot" ';
        gpx += 'xmlns="http://www.topografix.com/GPX/1/1" ';
        gpx += 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
        gpx += 'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n';
        gpx += '  <metadata>\n';
        gpx += '    <name>' + escapeXml(name) + '</name>\n';
        gpx += '    <time>' + exportISO + '</time>\n';
        gpx += '  </metadata>\n';
        gpx += '  <trk>\n';
        gpx += '    <name>' + escapeXml(name) + '</name>\n';
        gpx += '    <type>running</type>\n';
        gpx += '    <trkseg>\n';
        let fallbackStart = null;
        let lastTime = null;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            let t = null;
            if (isValidTimestamp(p.time)) {
                const date = new Date(p.time);
                if (!isNaN(date.getTime()) && p.time <= exportTime) {
                    if (lastTime === null || p.time >= lastTime) {
                        t = date.toISOString();
                        lastTime = p.time;
                    }
                }
            }
            if (t === null) {
                if (fallbackStart === null) {
                    fallbackStart = lastTime !== null 
                        ? lastTime - Math.max(0, i) * 5000
                        : exportTime - Math.max(0, points.length - 1) * 5000;
                }
                const fallbackTime = fallbackStart + i * 5000;
                const cappedTime = Math.min(fallbackTime, exportTime);
                t = new Date(cappedTime).toISOString();
                lastTime = cappedTime;
            }
            gpx += '      <trkpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lng.toFixed(6) + '">\n';
            gpx += '        <ele>0</ele>\n';
            gpx += '        <time>' + t + '</time>\n';
            gpx += '      </trkpt>\n';
        }
        gpx += '    </trkseg>\n';
        gpx += '  </trk>\n';
        gpx += '</gpx>';
        return gpx;
    }

    return {
        haversine,
        haversineArr,
        interpolatePoints,
        addIntermediateWaypoints,
        escapeXml,
        makeGPX
    };
});
