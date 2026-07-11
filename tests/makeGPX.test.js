const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeGPX } = require('../mini-app/route-utils.js');

function parseTrackTimesFromGPX(gpx) {
    const times = [];
    const regex = /<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/g;
    let match;
    while ((match = regex.exec(gpx)) !== null) {
        times.push(new Date(match[1]));
    }
    return times;
}

describe('makeGPX', () => {
    it('реальные возрастающие timestamps сохраняются', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now - 10000 },
            { lat: 55.7559, lng: 37.6174, time: now - 5000 },
            { lat: 55.7560, lng: 37.6175, time: now }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('все timestamps отсутствуют', () => {
        const points = [
            { lat: 55.7558, lng: 37.6173 },
            { lat: 55.7559, lng: 37.6174 },
            { lat: 55.7560, lng: 37.6175 }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
        const diff = (times[1] - times[0]) / 1000;
        assert.equal(diff, 5, 'Шаг между точками должен быть 5 секунд');
    });

    it('invalid находится в начале', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: 'invalid' },
            { lat: 55.7559, lng: 37.6174, time: now - 5000 },
            { lat: 55.7560, lng: 37.6175, time: now }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('invalid находится в середине', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now - 10000 },
            { lat: 55.7559, lng: 37.6174, time: 'invalid' },
            { lat: 55.7560, lng: 37.6175, time: now }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('invalid находится в конце', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now - 10000 },
            { lat: 55.7559, lng: 37.6174, time: now - 5000 },
            { lat: 55.7560, lng: 37.6175, time: 'invalid' }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('валидная точка после fallback имеет время меньше предыдущей — итог всё равно не убывает', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now },
            { lat: 55.7559, lng: 37.6174, time: now - 100000 },
            { lat: 55.7560, lng: 37.6175, time: now - 50000 }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
    });

    it('timestamp из будущего', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now + 100000 },
            { lat: 55.7559, lng: 37.6174, time: now + 200000 }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 2);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('точка с exportTime + 500мс считается будущей и получает fallback', () => {
        const now = Date.now();
        const points = [
            { lat: 55.7558, lng: 37.6173, time: now - 5000 },
            { lat: 55.7559, lng: 37.6174, time: now + 500 },
            { lat: 55.7560, lng: 37.6175, time: now }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 3);
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
        assert.ok(times[times.length - 1] <= new Date(), 'Последнее время не позже момента экспорта');
    });

    it('NaN, Infinity, -1 и строка invalid', () => {
        const points = [
            { lat: 55.7558, lng: 37.6173, time: NaN },
            { lat: 55.7559, lng: 37.6174, time: Infinity },
            { lat: 55.7560, lng: 37.6175, time: -1 },
            { lat: 55.7561, lng: 37.6176, time: 'invalid' }
        ];
        const gpx = makeGPX(points, 'Test Track');
        const times = parseTrackTimesFromGPX(gpx);
        assert.equal(times.length, 4);
        assert.ok(!gpx.includes('Invalid Date'), 'GPX не должен содержать Invalid Date');
        for (let i = 1; i < times.length; i++) {
            assert.ok(times[i] >= times[i - 1], 'Время должно идти по возрастанию');
        }
    });

    it('пустой массив', () => {
        const gpx = makeGPX([], 'Empty Track');
        assert.ok(gpx.includes('<gpx'), 'GPX должен содержать <gpx>');
        assert.ok(gpx.includes('</gpx>'), 'GPX должен содержать </gpx>');
        assert.ok(!gpx.includes('Invalid Date'), 'GPX не должен содержать Invalid Date');
    });

    it('XML-экранирование названия', () => {
        const points = [
            { lat: 55.7558, lng: 37.6173, time: Date.now() }
        ];
        const gpx = makeGPX(points, 'Track <test> & "name"');
        assert.ok(gpx.includes('&lt;test&gt;'), 'Название должно быть экранировано');
        assert.ok(gpx.includes('&amp;'), 'Амперсанд должен быть экранирован');
        assert.ok(gpx.includes('&quot;'), 'Кавычки должны быть экранированы');
    });
});
