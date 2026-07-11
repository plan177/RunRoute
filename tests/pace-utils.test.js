const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, calculatePaceMetrics, buildSplits } = require('../mini-app/pace-utils.js');

describe('calculatePaceMetrics', () => {
    it('5 км за 25 минут → 5:00 мин/км и 12.0 км/ч', () => {
        const result = calculatePaceMetrics(5000, 1500, 100);
        assert.ok(result);
        assert.equal(result.paceText, '5:00');
        assert.equal(result.speedText, '12.0');
    });

    it('10 км за 1 час → 6:00 и 10.0 км/ч', () => {
        const result = calculatePaceMetrics(10000, 3600, 100);
        assert.ok(result);
        assert.equal(result.paceText, '6:00');
        assert.equal(result.speedText, '10.0');
    });

    it('расчёт интервала 100, 200 и 400 метров', () => {
        const result = calculatePaceMetrics(5000, 1500, 100);
        assert.ok(result);
        assert.equal(result.lapText, '0:30');

        const result200 = calculatePaceMetrics(5000, 1500, 200);
        assert.ok(result200);
        assert.equal(result200.lapText, '1:00');

        const result400 = calculatePaceMetrics(5000, 1500, 400);
        assert.ok(result400);
        assert.equal(result400.lapText, '2:00');
    });

    it('дробная дистанция 21.097 км', () => {
        const result = calculatePaceMetrics(21097, 7200, 100);
        assert.ok(result);
        assert.equal(result.distanceKm, 21.097);
        assert.ok(result.paceSecondsPerKm > 0);
    });

    it('нулевая дистанция → null', () => {
        assert.equal(calculatePaceMetrics(0, 1500, 100), null);
    });

    it('нулевое время → null', () => {
        assert.equal(calculatePaceMetrics(5000, 0, 100), null);
    });

    it('отрицательные значения → null', () => {
        assert.equal(calculatePaceMetrics(-5000, 1500, 100), null);
        assert.equal(calculatePaceMetrics(5000, -1500, 100), null);
        assert.equal(calculatePaceMetrics(5000, 1500, -100), null);
    });

    it('NaN, Infinity и строковые значения → null', () => {
        assert.equal(calculatePaceMetrics(NaN, 1500, 100), null);
        assert.equal(calculatePaceMetrics(5000, Infinity, 100), null);
        assert.equal(calculatePaceMetrics('5000', 1500, 100), null);
    });
});

describe('formatDuration', () => {
    it('0 секунд', () => {
        assert.equal(formatDuration(0), '0:00');
    });

    it('59 секунд', () => {
        assert.equal(formatDuration(59), '0:59');
    });

    it('60 секунд', () => {
        assert.equal(formatDuration(60), '1:00');
    });

    it('3599.6 секунды корректно округляются до 1:00:00', () => {
        assert.equal(formatDuration(3599.6), '1:00:00');
    });

    it('больше часа', () => {
        assert.equal(formatDuration(3661), '1:01:01');
    });

    it('результат никогда не содержит :60', () => {
        assert.ok(!formatDuration(59.6).includes(':60'));
        assert.ok(!formatDuration(3599.6).includes(':60'));
        assert.ok(!formatDuration(86399.6).includes(':60'));
    });
});

describe('buildSplits', () => {
    it('5 км → пять полных сплитов', () => {
        const splits = buildSplits(5000, 300);
        assert.equal(splits.length, 5);
        splits.forEach(s => assert.equal(s.partial, false));
    });

    it('5.5 км → пять полных и один partial', () => {
        const splits = buildSplits(5500, 300);
        assert.equal(splits.length, 6);
        assert.equal(splits[5].partial, true);
    });

    it('0.5 км → только один partial', () => {
        const splits = buildSplits(500, 300);
        assert.equal(splits.length, 1);
        assert.equal(splits[0].partial, true);
    });

    it('cumulativeSeconds возрастает', () => {
        const splits = buildSplits(5000, 300);
        for (let i = 1; i < splits.length; i++) {
            assert.ok(splits[i].cumulativeSeconds >= splits[i - 1].cumulativeSeconds);
        }
    });

    it('последний cumulativeSeconds равен расчётному общему времени', () => {
        const splits = buildSplits(5000, 300);
        assert.equal(splits[splits.length - 1].cumulativeSeconds, 1500);
    });

    it('входные значения не мутируются', () => {
        const dist = 5000;
        const pace = 300;
        buildSplits(dist, pace);
        assert.equal(dist, 5000);
        assert.equal(pace, 300);
    });

    it('некорректные данные возвращают пустой массив', () => {
        assert.deepEqual(buildSplits(0, 300), []);
        assert.deepEqual(buildSplits(5000, 0), []);
        assert.deepEqual(buildSplits(-1000, 300), []);
        assert.deepEqual(buildSplits(NaN, 300), []);
        assert.deepEqual(buildSplits(5000, Infinity), []);
    });
});
