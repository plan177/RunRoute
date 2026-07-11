(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.RunRoutePaceUtils = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function formatDuration(totalSeconds) {
        if (typeof totalSeconds !== 'number' || !isFinite(totalSeconds) || isNaN(totalSeconds)) {
            return '0:00';
        }
        totalSeconds = Math.round(totalSeconds);
        if (totalSeconds < 0) totalSeconds = 0;
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        let s = totalSeconds % 60;
        if (s === 60) { s = 0; }
        if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
        return m + ':' + pad(s);
    }

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function calculatePaceMetrics(distanceMeters, totalSeconds, lapDistanceMeters) {
        if (typeof distanceMeters !== 'number' || typeof totalSeconds !== 'number' ||
            typeof lapDistanceMeters !== 'number') {
            return null;
        }
        if (!isFinite(distanceMeters) || !isFinite(totalSeconds) || !isFinite(lapDistanceMeters)) {
            return null;
        }
        if (isNaN(distanceMeters) || isNaN(totalSeconds) || isNaN(lapDistanceMeters)) {
            return null;
        }
        if (distanceMeters <= 0 || totalSeconds <= 0 || lapDistanceMeters <= 0) {
            return null;
        }

        const distanceKm = distanceMeters / 1000;
        const paceSecondsPerKm = totalSeconds / distanceKm;
        const paceText = formatDuration(paceSecondsPerKm);

        const speedKmh = distanceKm / (totalSeconds / 3600);
        const speedText = speedKmh.toFixed(1);

        const lapSeconds = paceSecondsPerKm * (lapDistanceMeters / 1000);
        const lapText = formatDuration(lapSeconds);

        return {
            distanceKm,
            paceSecondsPerKm,
            paceText,
            speedKmh,
            speedText,
            lapSeconds,
            lapText
        };
    }

    function buildSplits(distanceMeters, paceSecondsPerKm) {
        if (typeof distanceMeters !== 'number' || typeof paceSecondsPerKm !== 'number') {
            return [];
        }
        if (!isFinite(distanceMeters) || !isFinite(paceSecondsPerKm)) {
            return [];
        }
        if (isNaN(distanceMeters) || isNaN(paceSecondsPerKm)) {
            return [];
        }
        if (distanceMeters <= 0 || paceSecondsPerKm <= 0) {
            return [];
        }

        const distKm = distanceMeters / 1000;
        const fullKm = Math.floor(distKm);
        const partialKm = distKm - fullKm;
        const splits = [];
        let cumulative = 0;

        for (let km = 1; km <= fullKm; km++) {
            cumulative += paceSecondsPerKm;
            splits.push({
                label: km + '',
                segmentDistanceKm: 1,
                segmentSeconds: paceSecondsPerKm,
                segmentText: formatDuration(paceSecondsPerKm),
                cumulativeSeconds: cumulative,
                cumulativeText: formatDuration(cumulative),
                partial: false
            });
        }

        if (partialKm > 0.01) {
            const partialTime = paceSecondsPerKm * partialKm;
            cumulative += partialTime;
            splits.push({
                label: fullKm + '+' + partialKm.toFixed(1),
                segmentDistanceKm: partialKm,
                segmentSeconds: partialTime,
                segmentText: formatDuration(partialTime),
                cumulativeSeconds: cumulative,
                cumulativeText: formatDuration(cumulative),
                partial: true
            });
        }

        return splits;
    }

    return {
        formatDuration,
        pad,
        calculatePaceMetrics,
        buildSplits
    };
});
