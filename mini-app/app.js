let map, routeLayer, startMarker, userLocation = null, selectedDistance = 5;
let currentRoute = null, selectedPaceDist = 5000;
let routeMode = 'auto'; // 'auto' | 'manual'
let manualPoints = [];
let manualMarkers = [];
let manualPolyline = null;
let routeSeed = 0;
let selectedLapDist = 400; // 200, 400, 800

// init moved to bottom of file

function initTelegram() {
    if (window.Telegram && window.Telegram.WebApp) {
        Telegram.WebApp.ready();
        Telegram.WebApp.expand();
        if (Telegram.WebApp.platform === 'ios') {
            document.body.style.webkitOverflowScrolling = 'touch';
        }
    }
}

function initMap() {
    map = L.map('map', {
        tap: true,
        tapTimeout: 300,
        bounceAtZoomLimits: false
    }).setView([55.7558, 37.6173], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 200);
    map.on('click', onMapClick);
}

function initTabs() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', e => {
        const tab = e.target.closest('.tab');
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        const isRoute = tab.dataset.tab === 'route';
        document.getElementById('tab-route').classList.toggle('hidden', !isRoute);
        document.getElementById('tab-pace').classList.toggle('hidden', isRoute);
        document.getElementById('map').classList.toggle('hidden', !isRoute);
        document.getElementById('route-info').classList.toggle('hidden', !isRoute || !currentRoute);
    }));
}

function onMapClick(e) {
    if (routeMode === 'manual') {
        addManualPoint(e.latlng.lat, e.latlng.lng);
        return;
    }
    userLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
    setStartMarker(userLocation.lat, userLocation.lng);
    map.setView([userLocation.lat, userLocation.lng], 15);
    document.getElementById('location-status').textContent =
        userLocation.lat.toFixed(5) + ', ' + userLocation.lng.toFixed(5);
    document.getElementById('location-status').className = 'status success';
    document.getElementById('generate-btn').disabled = false;
}

function setStartMarker(lat, lng) {
    if (startMarker) map.removeLayer(startMarker);
    startMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'waypoint-marker',
            html: '<div class="start-finish-marker" title="Старт / Финиш">▶◀</div>',
            iconSize: [36, 36], iconAnchor: [18, 18]
        })
    }).addTo(map);
    startMarker.bindTooltip('Старт / Финиш', { permanent: true, direction: 'top', offset: [0, -20] });
}

// === Route Mode Switch ===

function initRouteMode() {
    document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', e => {
        const btn = e.target.closest('.mode-btn');
        document.querySelectorAll('.mode-btn').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        const newMode = btn.dataset.mode;
        const prevMode = routeMode;
        routeMode = newMode;

        if (newMode === 'manual' && prevMode === 'auto' && userLocation && !manualPoints.length) {
            useStartForManual();
        } else {
            clearManualMode();
        }
        updateUIForMode();
    }));
    document.getElementById('clear-manual-btn').addEventListener('click', clearManualMode);
    document.getElementById('undo-manual-btn').addEventListener('click', undoLastPoint);
    document.getElementById('close-route-btn').addEventListener('click', closeManualRoute);
}

function useStartForManual() {
    if (!userLocation) return;

    showConfirmModal('Начать маршрут от текущей точки?').then(confirmed => {
        if (confirmed) {
            if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
            if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
            currentRoute = null;
            document.getElementById('route-info').classList.add('hidden');
            document.getElementById('regenerate-btn').classList.add('hidden');
            document.getElementById('download-btn').classList.add('hidden');
            document.getElementById('share-row').classList.add('hidden');

            addManualPoint(userLocation.lat, userLocation.lng);
            const hint = document.getElementById('hint-manual');
            hint.textContent = 'Точка старта добавлена. Нажмите чтобы поставить вторую';
            hint.classList.remove('hidden');
        } else {
            clearManualMode();
            if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
            userLocation = null;
            document.getElementById('location-status').textContent = '';
            document.getElementById('location-status').className = 'status';
            document.getElementById('generate-btn').disabled = true;
        }
    });
}

function showConfirmModal(text) {
    return new Promise(resolve => {
        const modal = document.getElementById('confirm-modal');
        const textEl = document.getElementById('confirm-text');
        const yesBtn = document.getElementById('confirm-yes');
        const noBtn = document.getElementById('confirm-no');

        textEl.textContent = text;
        modal.classList.remove('hidden');

        function cleanup(result) {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            resolve(result);
        }
        function onYes() { cleanup(true); }
        function onNo() { cleanup(false); }
        yesBtn.addEventListener('click', onYes);
        noBtn.addEventListener('click', onNo);
    });
}

function updateUIForMode() {
    const isAuto = routeMode === 'auto';
    document.getElementById('auto-controls').classList.toggle('hidden', !isAuto);
    document.getElementById('manual-controls').classList.toggle('hidden', isAuto);
    document.getElementById('hint-auto').classList.toggle('hidden', !isAuto);
    document.getElementById('hint-manual').classList.add('hidden');
}

function clearManualMode() {
    manualPoints = [];
    manualMarkers.forEach(m => map.removeLayer(m));
    manualMarkers = [];
    if (manualPolyline) { map.removeLayer(manualPolyline); manualPolyline = null; }
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    currentRoute = null;
    document.getElementById('generate-btn').disabled = true;
    document.getElementById('regenerate-btn').classList.add('hidden');
    document.getElementById('download-btn').classList.add('hidden');
    document.getElementById('share-row').classList.add('hidden');
    document.getElementById('route-info').classList.add('hidden');
    updateManualCount();
}

function updateManualCount() {
    const el = document.getElementById('manual-count-text');
    if (el) el.textContent = manualPoints.length + ' точек';
    const closeBtn = document.getElementById('close-route-btn');
    closeBtn.classList.toggle('hidden', manualPoints.length < 2);
}

function addManualPoint(lat, lng) {
    const idx = manualPoints.length;
    manualPoints.push({ lat, lng });
    const marker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'waypoint-marker',
            html: '<div class="manual-marker" data-idx="' + idx + '">' +
                  '<span class="manual-marker-num">' + (idx + 1) + '</span>' +
                  '<span class="manual-marker-del" data-idx="' + idx + '">&times;</span>' +
                  '</div>',
            iconSize: [30, 30], iconAnchor: [15, 15]
        })
    }).addTo(map);

    marker.on('click', function(e) {
        L.DomEvent.stop(e);
        removeManualPoint(idx);
    });

    manualMarkers.push(marker);
    redrawManualPolyline();
    updateManualCount();

    const hint = document.getElementById('hint-manual');
    if (manualPoints.length >= 2) {
        hint.classList.add('hidden');
    }

    document.getElementById('generate-btn').disabled = manualPoints.length < 2;
}

function removeManualPoint(idx) {
    if (idx < 0 || idx >= manualPoints.length) return;
    manualPoints.splice(idx, 1);
    map.removeLayer(manualMarkers[idx]);
    manualMarkers.splice(idx, 1);
    renumberMarkers();
    redrawManualPolyline();
    updateManualCount();
    document.getElementById('generate-btn').disabled = manualPoints.length < 2;
    if (manualPoints.length === 0) {
        document.getElementById('generate-btn').disabled = true;
    }
}

function undoLastPoint() {
    if (manualPoints.length === 0) return;
    removeManualPoint(manualPoints.length - 1);
}

function renumberMarkers() {
    manualMarkers.forEach((m, i) => {
        m.setIcon(L.divIcon({
            className: 'waypoint-marker',
            html: '<div class="manual-marker" data-idx="' + i + '">' +
                  '<span class="manual-marker-num">' + (i + 1) + '</span>' +
                  '<span class="manual-marker-del" data-idx="' + i + '">&times;</span>' +
                  '</div>',
            iconSize: [30, 30], iconAnchor: [15, 15]
        }));
        m.off('click');
        m.on('click', function(e) {
            L.DomEvent.stop(e);
            removeManualPoint(i);
        });
    });
}

function redrawManualPolyline() {
    if (manualPolyline) map.removeLayer(manualPolyline);
    if (manualPoints.length < 2) { manualPolyline = null; return; }
    manualPolyline = L.polyline(
        manualPoints.map(p => [p.lat, p.lng]),
        { color: '#39FF14', weight: 3, dashArray: '8,6', opacity: 0.8 }
    ).addTo(map);
}

function closeManualRoute() {
    if (manualPoints.length < 2) return;
    const first = manualPoints[0];
    addManualPoint(first.lat, first.lng);
}

// === Search ===

function initSearch() {
    document.getElementById('search-btn').addEventListener('click', searchAddress);
    document.getElementById('address-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') searchAddress();
    });
}

function searchAddress() {
    const input = document.getElementById('address-input').value.trim();
    const status = document.getElementById('location-status');
    if (!input) {
        status.textContent = 'Введите адрес';
        status.className = 'status error';
        return;
    }

    const c = parseCoord(input);
    if (c) {
        userLocation = c;
        if (routeMode === 'manual') {
            addManualPoint(c.lat, c.lng);
        } else {
            setStartMarker(c.lat, c.lng);
        }
        map.setView([c.lat, c.lng], 15);
        status.textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5);
        status.className = 'status success';
        document.getElementById('generate-btn').disabled = false;
        return;
    }

    status.textContent = 'Ищу...';
    status.className = 'status';

    fetch('https://nominatim.openstreetmap.org/search?' +
        new URLSearchParams({ format: 'json', q: input, limit: 5, 'accept-language': 'ru' }),
        { headers: { 'User-Agent': 'RunRouteBot/1.0' } }
    )
    .then(r => r.json())
    .then(data => {
        if (data && data.length > 0) {
            const item = data[0];
            userLocation = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
            if (routeMode === 'manual') {
                addManualPoint(userLocation.lat, userLocation.lng);
            } else {
                setStartMarker(userLocation.lat, userLocation.lng);
            }
            map.setView([userLocation.lat, userLocation.lng], 15);
            status.textContent = item.display_name.split(',').slice(0, 3).join(',');
            status.className = 'status success';
            document.getElementById('generate-btn').disabled = false;
        } else {
            status.textContent = 'Не найдено';
            status.className = 'status error';
        }
    })
    .catch(() => {
        status.textContent = 'Ошибка сети';
        status.className = 'status error';
    });
}

function parseCoord(s) {
    const m = s.match(/^(-?\d+\.?\d*)[\s,]+(-?\d+\.?\d*)$/);
    return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
}

// === Route Generation ===

function initRouteControls() {
    document.getElementById('generate-btn').addEventListener('click', generateRoute);
    document.getElementById('regenerate-btn').addEventListener('click', regenerateRoute);
    document.getElementById('download-btn').addEventListener('click', downloadGPX);
    document.querySelectorAll('.distance-chips .chip[data-distance]').forEach(b => b.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        document.querySelectorAll('.distance-chips .chip[data-distance]').forEach(x => x.classList.remove('active'));
        chip.classList.add('active');
        selectedDistance = parseFloat(chip.dataset.distance);
    }));
}

async function generateRoute() {
    if (routeMode === 'manual') {
        await generateManualRoute();
    } else {
        await generateAutoRoute();
    }
}

function regenerateRoute() {
    if (routeMode === 'manual') {
        generateManualRoute();
    } else {
        routeSeed++;
        generateAutoRoute();
    }
}

async function generateAutoRoute() {
    if (!userLocation) return;
    const btn = document.getElementById('generate-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Построение...';
    try {
        currentRoute = await buildPreciseRoute(userLocation.lat, userLocation.lng, selectedDistance);
        displayRoute(currentRoute);
        showRouteButtons();
    } catch (e) {
        console.error(e);
        alert('Не удалось построить маршрут. Попробуйте другую точку.');
    } finally {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Построить маршрут';
        btn.disabled = false;
    }
}

async function buildPreciseRoute(lat, lng, targetKm) {
    const MAX_ITERATIONS = 15;
    const TOLERANCE_KM = 0.1;
    let bestRoute = null;
    let bestDiff = Infinity;
    let radiusKm = targetKm / (2 * Math.PI);

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const route = await tryBuildTrip(lat, lng, radiusKm);
        if (!route) {
            radiusKm *= 1.15;
            continue;
        }

        const diff = Math.abs(route.distance_km - targetKm);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestRoute = route;
        }

        if (diff <= TOLERANCE_KM) break;
        radiusKm *= targetKm / route.distance_km;
    }

    if (!bestRoute) {
        bestRoute = buildPerfectCircle(lat, lng, targetKm);
    }

    bestRoute.accuracy = Math.abs(bestRoute.distance_km - targetKm) / targetKm * 100;
    bestRoute.gpx = makeGPX(bestRoute.points, 'Run ' + targetKm + 'km');
    return bestRoute;
}

async function tryBuildTrip(lat, lng, radiusKm) {
    const latRad = lat * Math.PI / 180;
    const latDegPerKm = 1 / 111.32;
    const lngDegPerKm = 1 / (111.32 * Math.cos(latRad));
    const rLat = radiusKm * latDegPerKm;
    const rLng = radiusKm * lngDegPerKm;

    const angleOffset = (routeSeed * 0.7) % (2 * Math.PI);
    const numPts = 8;
    const waypoints = [[lng, lat]];
    for (let i = 0; i < numPts; i++) {
        const angle = angleOffset + (2 * Math.PI * i) / numPts;
        waypoints.push([
            lng + rLng * Math.cos(angle),
            lat + rLat * Math.sin(angle)
        ]);
    }
    waypoints.push([lng, lat]);

    const coords = waypoints.map(p => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(';');
    const url = 'https://router.project-osrm.org/route/v1/foot/' + coords +
        '?overview=full&geometries=geojson&steps=false';

    try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;
        const route = data.routes[0];
        const points = route.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
        const distance_km = haversineArr(points);
        return { points, distance_km };
    } catch {
        return null;
    }
}

function buildPerfectCircle(lat, lng, targetKm) {
    const numPts = 200;
    const radiusKm = targetKm / (2 * Math.PI);
    const latDegPerKm = 1 / 111.32;
    const lngDegPerKm = 1 / (111.32 * Math.cos(lat * Math.PI / 180));
    const rLat = radiusKm * latDegPerKm;
    const rLng = radiusKm * lngDegPerKm;
    const angleOffset = (routeSeed * 0.7) % (2 * Math.PI);

    const points = [{ lat, lng }];
    for (let i = 0; i <= numPts; i++) {
        const angle = angleOffset + (2 * Math.PI * i) / numPts;
        points.push({
            lat: lat + rLat * Math.sin(angle),
            lng: lng + rLng * Math.cos(angle)
        });
    }
    points.push({ lat, lng });

    const distance_km = haversineArr(points);
    return { points, distance_km };
}

// --- Manual mode ---

async function generateManualRoute() {
    if (manualPoints.length < 2) return;
    const btn = document.getElementById('generate-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Построение...';

    try {
        const coords = manualPoints.map(p => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
        const url = 'https://router.project-osrm.org/route/v1/foot/' + coords +
            '?overview=full&geometries=geojson&steps=false';

        const resp = await fetch(url);
        const data = await resp.json();

        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            alert('Маршрут не найден. Попробуйте другие точки.');
            return;
        }

        const route = data.routes[0];
        const points = route.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
        const distance_km = haversineArr(points);

        if (manualPolyline) { map.removeLayer(manualPolyline); manualPolyline = null; }

        currentRoute = {
            points,
            distance_km,
            accuracy: 0,
            gpx: makeGPX(points, 'Manual Route')
        };

        displayRoute(currentRoute);
        showRouteButtons();
    } catch (e) {
        console.error(e);
        alert('Ошибка построения маршрута.');
    } finally {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Построить маршрут';
        btn.disabled = false;
    }
}

function showRouteButtons() {
    document.getElementById('regenerate-btn').classList.remove('hidden');
    document.getElementById('download-btn').classList.remove('hidden');
    document.getElementById('share-row').classList.remove('hidden');
    document.getElementById('route-info').classList.remove('hidden');
}

function displayRoute(route) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.polyline(
        route.points.map(p => [p.lat, p.lng]),
        { color: '#39FF14', weight: 4, opacity: 0.9 }
    ).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

    document.getElementById('route-distance').textContent = route.distance_km.toFixed(2) + ' км';
    const accEl = document.getElementById('route-accuracy');
    if (route.accuracy !== undefined) {
        const acc = route.accuracy;
        accEl.textContent = '±' + acc.toFixed(1) + '%';
        accEl.style.color = acc < 1 ? '#39FF14' : acc < 5 ? '#FFD700' : '#FF3B5C';
    } else {
        accEl.textContent = 'точный';
        accEl.style.color = '#39FF14';
    }
}

// === Pace Calculator ===

function initPace() {
    // Auto-select on focus for all number inputs
    document.querySelectorAll('.num-input').forEach(input => {
        input.addEventListener('focus', () => {
            setTimeout(() => input.select(), 0);
        });
    });

    document.querySelectorAll('.distance-chips .chip[data-dist]').forEach(b => b.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        document.querySelectorAll('.distance-chips .chip[data-dist]').forEach(x => x.classList.remove('active'));
        chip.classList.add('active');
        selectedPaceDist = parseInt(chip.dataset.dist);
        updatePaceDistInputs();
        calcPace();
    }));

    document.getElementById('pace-dist-km').addEventListener('input', onPaceDistInput);
    document.getElementById('pace-dist-m').addEventListener('input', onPaceDistInput);
    document.getElementById('pace-h').addEventListener('input', calcPace);
    document.getElementById('pace-m').addEventListener('input', calcPace);
    document.getElementById('pace-s').addEventListener('input', calcPace);

    document.querySelectorAll('.lap-tab').forEach(b => b.addEventListener('click', e => {
        const tab = e.target.closest('.lap-tab');
        document.querySelectorAll('.lap-tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        selectedLapDist = parseInt(tab.dataset.lap);
        document.getElementById('lap-label').textContent = selectedLapDist + 'м';
        calcPace();
    }));

    calcPace();
}

function onPaceDistInput() {
    const km = parseInt(document.getElementById('pace-dist-km').value) || 0;
    const m = parseInt(document.getElementById('pace-dist-m').value) || 0;
    selectedPaceDist = km * 1000 + m;
    document.querySelectorAll('.distance-chips .chip[data-dist]').forEach(x => x.classList.remove('active'));
    calcPace();
}

function updatePaceDistInputs() {
    const km = Math.floor(selectedPaceDist / 1000);
    const m = selectedPaceDist % 1000;
    document.getElementById('pace-dist-km').value = km;
    document.getElementById('pace-dist-m').value = m;
}

function calcPace() {
    const h = parseInt(document.getElementById('pace-h').value) || 0;
    const m = parseInt(document.getElementById('pace-m').value) || 0;
    const s = parseInt(document.getElementById('pace-s').value) || 0;
    const totalSec = h * 3600 + m * 60 + s;
    if (totalSec <= 0 || selectedPaceDist <= 0) return;

    const distKm = selectedPaceDist / 1000;
    const paceSec = totalSec / distKm;
    const paceMin = Math.floor(paceSec / 60);
    const paceRem = Math.round(paceSec % 60);
    document.getElementById('result-pace').textContent = paceMin + ':' + pad(paceRem);

    const speed = distKm / (totalSec / 3600);
    document.getElementById('result-speed').textContent = speed.toFixed(1);

    const lapSec = paceSec * (selectedLapDist / 1000);
    const lapMin = Math.floor(lapSec / 60);
    const lapRem = Math.round(lapSec % 60);
    document.getElementById('result-lap').textContent = lapMin + ':' + pad(lapRem);

    renderSplits(distKm, paceSec);
}

function renderSplits(distKm, paceSec) {
    const container = document.getElementById('splits-container');
    if (!container) return;

    const fullKm = Math.floor(distKm);
    const partialKm = distKm - fullKm;

    let html = '<div class="splits-table">';
    html += '<div class="split-header"><span>Км</span><span>Время</span><span>Суммарно</span></div>';

    let cumulative = 0;
    for (let km = 1; km <= fullKm; km++) {
        cumulative += paceSec;
        html += '<div class="split-row"><span>' + km + '</span><span>' +
            formatTime(paceSec) + '</span><span>' + formatTime(cumulative) + '</span></div>';
    }

    if (partialKm > 0.01) {
        const partialTime = paceSec * partialKm;
        cumulative += partialTime;
        html += '<div class="split-row partial"><span>' + fullKm + '+' +
            partialKm.toFixed(1) + '</span><span>' + formatTime(partialTime) +
            '</span><span>' + formatTime(cumulative) + '</span></div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

// === Utilities ===

function haversineArr(pts) {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        total += haversine(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
    }
    return total;
}

function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function makeGPX(points, name) {
    const now = new Date().toISOString();
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gpx += '<gpx version="1.1" creator="RunRouteBot" ';
    gpx += 'xmlns="http://www.topografix.com/GPX/1/1" ';
    gpx += 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
    gpx += 'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n';
    gpx += '  <metadata>\n';
    gpx += '    <name>' + escapeXml(name) + '</name>\n';
    gpx += '    <time>' + now + '</time>\n';
    gpx += '  </metadata>\n';
    gpx += '  <trk>\n';
    gpx += '    <name>' + escapeXml(name) + '</name>\n';
    gpx += '    <type>running</type>\n';
    gpx += '    <trkseg>\n';
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const offset = i * 5;
        const t = new Date(Date.now() + offset * 1000).toISOString();
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

function downloadGPX() {
    if (!currentRoute || !currentRoute.gpx) return;
    const blob = new Blob([currentRoute.gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'route_' + currentRoute.distance_km.toFixed(1) + 'km.gpx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function formatTime(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.round(totalSec % 60);
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// === Share ===

function initShare() {
    document.getElementById('share-btn').addEventListener('click', shareRoute);
}

async function shareRoute() {
    if (!currentRoute || !currentRoute.gpx) return;

    const dist = currentRoute.distance_km.toFixed(1);
    const fileName = 'route_' + dist + 'km.gpx';
    const file = new File([currentRoute.gpx], fileName, { type: 'application/gpx+xml' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'Маршрут ' + dist + ' км',
                text: '🏃 Маршрут ' + dist + ' км — RunRouteBot'
            });
            showToast('Маршрут отправлен');
        } catch (e) {
            if (e.name !== 'AbortError') {
                downloadGPX();
                showToast('GPX скачан');
            }
        }
    } else {
        downloadGPX();
        showToast('GPX скачан');
    }
}

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

function showToast(msg) {
    const el = document.getElementById('share-toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2500);
}

// === Init all ===

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initTabs();
    initSearch();
    initRouteControls();
    initRouteMode();
    initPace();
    initTelegram();
    initShare();
    updateUIForMode();
});
