const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { haversine, haversineArr, interpolatePoints, addIntermediateWaypoints } = require('../mini-app/route-utils.js');

describe('haversine', () => {
    it('одинаковые координаты дают 0', () => {
        const result = haversine(55.7558, 37.6173, 55.7558, 37.6173);
        assert.equal(result, 0);
    });

    it('известное расстояние рассчитывается с допуском', () => {
        // Москва → Санкт-Петербург ≈ 635 км
        const dist = haversine(55.7558, 37.6173, 59.9343, 30.3351);
        assert.ok(dist > 600 && dist < 700, `Ожидалось 600-700 км, получено ${dist}`);
    });

    it('симметричность: distance(A, B) = distance(B, A)', () => {
        const ab = haversine(55.7558, 37.6173, 59.9343, 30.3351);
        const ba = haversine(59.9343, 30.3351, 55.7558, 37.6173);
        assert.equal(ab, ba);
    });

    it('маленькое расстояние (100м)', () => {
        const dist = haversine(55.7558, 37.6173, 55.7559, 37.6173);
        assert.ok(dist < 0.02, `Ожидалось < 0.02 км, получено ${dist}`);
    });
});

describe('haversineArr', () => {
    it('суммирует расстояния между точками', () => {
        const pts = [
            { lat: 55.7558, lng: 37.6173 },
            { lat: 55.7559, lng: 37.6173 },
            { lat: 55.7560, lng: 37.6173 }
        ];
        const total = haversineArr(pts);
        const single = haversine(55.7558, 37.6173, 55.7559, 37.6173);
        assert.ok(total > single, 'Сумма должна быть больше одного сегмента');
    });

    it('возвращает 0 для одной точки', () => {
        const pts = [{ lat: 55.7558, lng: 37.6173 }];
        assert.equal(haversineArr(pts), 0);
    });
});

describe('interpolatePoints', () => {
    it('возвращает указанное количество точек', () => {
        const p1 = { lat: 0, lon: 0 };
        const p2 = { lat: 1, lon: 1 };
        const result = interpolatePoints(p1, p2, 5);
        assert.equal(result.length, 5);
    });

    it('не включает начальную и конечную точки', () => {
        const p1 = { lat: 0, lon: 0 };
        const p2 = { lat: 1, lon: 1 };
        const result = interpolatePoints(p1, p2, 3);
        assert.notEqual(result[0].lat, p1.lat);
        assert.notEqual(result[0].lon, p1.lon);
        assert.notEqual(result[2].lat, p2.lat);
        assert.notEqual(result[2].lon, p2.lon);
    });

    it('для одной промежуточной точки возвращает середину', () => {
        const p1 = { lat: 0, lon: 0 };
        const p2 = { lat: 10, lon: 10 };
        const result = interpolatePoints(p1, p2, 1);
        assert.equal(result.length, 1);
        assert.equal(result[0].lat, 5);
        assert.equal(result[0].lon, 5);
    });

    it('не изменяет входные объекты', () => {
        const p1 = { lat: 0, lon: 0 };
        const p2 = { lat: 1, lon: 1 };
        const p1Copy = { lat: 0, lon: 0 };
        const p2Copy = { lat: 1, lon: 1 };
        interpolatePoints(p1, p2, 3);
        assert.deepEqual(p1, p1Copy);
        assert.deepEqual(p2, p2Copy);
    });

    it('возвращает пустой массив для 0 точек', () => {
        const p1 = { lat: 0, lon: 0 };
        const p2 = { lat: 1, lon: 1 };
        const result = interpolatePoints(p1, p2, 0);
        assert.equal(result.length, 0);
    });
});

describe('addIntermediateWaypoints', () => {
    it('пустой массив возвращается без ошибки', () => {
        const result = addIntermediateWaypoints([]);
        assert.deepEqual(result, []);
    });

    it('одна точка сохраняется', () => {
        const waypoints = [{ lat: 55.7558, lon: 37.6173 }];
        const result = addIntermediateWaypoints(waypoints);
        assert.equal(result.length, 1);
        assert.equal(result[0].lat, 55.7558);
    });

    it('начальная и конечная точки сохраняются', () => {
        const waypoints = [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 1 }
        ];
        const result = addIntermediateWaypoints(waypoints);
        assert.equal(result[0].lat, 0);
        assert.equal(result[0].lon, 0);
        assert.equal(result[result.length - 1].lat, 1);
        assert.equal(result[result.length - 1].lon, 1);
    });

    it('порядок точек сохраняется', () => {
        const waypoints = [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 0 },
            { lat: 2, lon: 0 }
        ];
        const result = addIntermediateWaypoints(waypoints);
        for (let i = 0; i < result.length - 1; i++) {
            assert.ok(result[i].lat <= result[i + 1].lat,
                `Точка ${i} (${result[i].lat}) должна быть <= точки ${i + 1} (${result[i + 1].lat})`);
        }
    });

    it('количество промежуточных точек не превышает лимит 20', () => {
        const waypoints = [
            { lat: 0, lon: 0 },
            { lat: 10, lon: 0 }
        ];
        const result = addIntermediateWaypoints(waypoints);
        const intermediateCount = result.length - 2;
        assert.ok(intermediateCount <= 20, `Промежуточных точек ${intermediateCount}, ожидалось <= 20`);
    });

    it('входной массив и его точки не мутируются', () => {
        const waypoints = [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 1 }
        ];
        const copy = JSON.parse(JSON.stringify(waypoints));
        addIntermediateWaypoints(waypoints);
        assert.deepEqual(waypoints, copy);
    });

    it('добавляет промежуточные точки между сегментами', () => {
        const waypoints = [
            { lat: 0, lon: 0 },
            { lat: 5, lon: 0 }
        ];
        const result = addIntermediateWaypoints(waypoints);
        assert.ok(result.length > 2, `Ожидалось > 2 точек, получено ${result.length}`);
    });
});
