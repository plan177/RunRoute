const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let t;
        const hasValidTime = p.time !== null && p.time !== undefined && !isNaN(p.time) && isFinite(p.time);
        if (hasValidTime) {
            const date = new Date(p.time);
            if (!isNaN(date.getTime()) && p.time <= exportTime + 1000) {
                t = date.toISOString();
            }
        }
        if (!t) {
            if (fallbackStart === null) {
                fallbackStart = exportTime - Math.max(0, points.length - 1) * 5000;
            }
            const fallbackTime = fallbackStart + i * 5000;
            t = new Date(fallbackTime).toISOString();
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

function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function parseTimesFromGPX(gpx) {
    const times = [];
    const regex = /<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/g;
    let match;
    while ((match = regex.exec(gpx)) !== null) {
        times.push(new Date(match[1]));
    }
    return times;
}

describe('makeGPX', () => {
    it('все точки имеют реальные timestamps', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now - 10000 },
            { lat: 55.7559, lng: 37.6174, time: now - 5000 },
            { lat: 55.7560, lng: 37.6175, time: now }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('ни одна точка не имеет time', () => {
        const points = [
            { lat: 55.7558, lng: 37.6173 },
            { lat: 55.7559, lng: 37.6174 },
            { lat: 55.7560, lng: 37.6175 }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
        const diff = (times[1] - times[0]) / 1000;
        assert.equal(diff, 5, 'Шаг между точками должен быть 5 секунд');
    });

    it('одна точка содержит некорректный time', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now - 10000 },
            { lat: 55.7559, lng: 37.6174, time: 'invalid' },
            { lat: 55.7560, lng: 37.6175, time: now }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('GPX генерируется без исключения для пустого массива', () => {
        const gpx = makeGPX([], 'Empty Track');
        assert.ok(gpx.includes('<gpx'), 'GPX должен содержать <gpx>');
        assert.ok(gpx.includes('</gpx>'), 'GPX должен содержать </gpx>');
    });

    it('Invalid Date не появляется в GPX', () => {
        const points = [
            { lat: 55.7558, lng: 37.6173, time: NaN },
            { lat: 55.7559, lng: 37.6174, time: Infinity },
            { lat: 55.7560, lng: 37.6175, time: -1 }
        ];
        const gpx = makeGPX(points, 'Test Track');
        assert.ok(!gpx.includes('Invalid Date'), 'GPX не должен содержать Invalid Date');
    });
});
