let map, routeLayer, startMarker, userLocation = null, selectedDistance = 5;
let currentRoute = null, selectedPaceDist = 5000;
let routeMode = 'auto'; // 'auto' | 'manual'
let manualPoints = [];
let manualMarkers = [];
let manualPolyline = null;
let manualRouteClosed = false;
let routeSeed = 0;
let selectedLapDist = 100; // 100, 200, 400

// === Live Tracking ===
let tracking = false;
let trackingWatchId = null;
let trackingPoints = [];
let trackingPolyline = null;
let trackingMarker = null;
let trackingLastValid = null;
const TRACK_MIN_DIST_M = 5;
const TRACK_MAX_SPEED_KMH = 20;
const TRACK_SMOOTH_N = 3;
const TRACK_MAX_ACCURACY_M = 50;

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

function isTelegramApp() {
    return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
}

function getTelegramInitData() {
    if (!isTelegramApp()) return null;
    return window.Telegram.WebApp.initData || null;
}

function getApiHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const initData = getTelegramInitData();
    if (initData) {
        headers['X-Telegram-Init-Data'] = initData;
    }
    return headers;
}

function initMap() {
    map = L.map('map', {
        tap: true,
        tapTimeout: 300,
        bounceAtZoomLimits: false
    }).setView([55.7558, 37.6173], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: false,
        subdomains: 'abcd',
        maxZoom: 19
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
        if (insertMode && manualPoints.length >= 2) {
            const insertIdx = findNearestSegmentIdx(e.latlng.lat, e.latlng.lng);
            if (insertIdx >= 0) {
                insertManualPointBetween(insertIdx, e.latlng.lat, e.latlng.lng);
                return;
            }
        }
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
            html: '<div class="map-pin">' +
                  '<div class="map-pin-inner"></div>' +
                  '</div>',
            iconSize: [32, 42], iconAnchor: [16, 42]
        }),
        draggable: true
    }).addTo(map);

    startMarker.on('dragend', function() {
        const pos = startMarker.getLatLng();
        userLocation = { lat: pos.lat, lng: pos.lng };
        document.getElementById('location-status').textContent =
            pos.lat.toFixed(5) + ', ' + pos.lng.toFixed(5);
        if (currentRoute) generateAutoRoute();
    });
}

// === Route Mode Switch ===

function initRouteMode() {
    document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', async e => {
        const btn = e.target.closest('.mode-btn');
        const nextMode = btn.dataset.mode;

        let plan = getModeTransitionPlan({
            previousMode: routeMode,
            nextMode: nextMode,
            trackingActive: tracking,
            hasGeneratedRoute: !!currentRoute,
            hasUserLocation: !!userLocation,
            manualPointCount: manualPoints.length
        });

        if (!plan.valid) return;

        if (!plan.modeChanged) return;

        if (plan.stopTracking) {
            stopTracking();
            // stopTracking may synchronously create currentRoute from recorded points
            plan = getModeTransitionPlan({
                previousMode: routeMode,
                nextMode: nextMode,
                trackingActive: tracking,
                hasGeneratedRoute: !!currentRoute,
                hasUserLocation: !!userLocation,
                manualPointCount: manualPoints.length
            });
        }

        if (plan.offerShareBeforeClear) {
            const result = await showConfirmModal('Маршрут будет удалён. Поделиться перед удалением?');
            if (result === 'yes') {
                const shareResult = await shareRoute();
                if (shareResult === 'cancelled' || shareResult === 'failed') return;
            }
        }

        if (plan.clearGeneratedRoute) {
            clearGeneratedRoute();
        }

        if (plan.clearManualMode) {
            clearManualMode(false);
        }

        if (plan.removeStartMarker) {
            if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
        }

        if (plan.seedManualStartPoint) {
            addManualPoint(userLocation.lat, userLocation.lng);
            const hint = document.getElementById('hint-manual');
            hint.textContent = 'Точка старта добавлена. Нажмите чтобы поставить вторую';
            hint.classList.remove('hidden');
        }

        document.querySelectorAll('.mode-btn').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        routeMode = nextMode;
        updateUIForMode();
    }));
    document.getElementById('clear-manual-btn').addEventListener('click', () => clearManualMode(true));
    document.getElementById('undo-manual-btn').addEventListener('click', undoLastPoint);
    document.getElementById('close-route-btn').addEventListener('click', closeManualRoute);
}

function useStartForManual() {
    if (!userLocation) return;

    showConfirmModal('Начать маршрут от текущей точки?').then(confirmed => {
        if (confirmed === 'yes') {
            clearGeneratedRoute();
            if (startMarker) { map.removeLayer(startMarker); startMarker = null; }

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

function showConfirmModal(text, options) {
    return new Promise(resolve => {
        const modal = document.getElementById('confirm-modal');
        const textEl = document.getElementById('confirm-text');
        const yesBtn = document.getElementById('confirm-yes');
        const middleBtn = document.getElementById('confirm-middle');
        const noBtn = document.getElementById('confirm-no');

        textEl.textContent = text;

        if (options && options.middle) {
            middleBtn.textContent = options.middle;
            middleBtn.classList.remove('hidden');
            if (options.middleClass) middleBtn.className = 'modal-btn ' + options.middleClass;
        } else {
            middleBtn.classList.add('hidden');
        }

        if (options && options.yesText) yesBtn.textContent = options.yesText;
        else yesBtn.textContent = 'Да';
        if (options && options.noText) noBtn.textContent = options.noText;
        else noBtn.textContent = 'Нет';

        modal.classList.remove('hidden');

        function cleanup(result) {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            middleBtn.removeEventListener('click', onMiddle);
            noBtn.removeEventListener('click', onNo);
            yesBtn.textContent = 'Да';
            noBtn.textContent = 'Нет';
            middleBtn.classList.add('hidden');
            middleBtn.className = 'modal-btn secondary';
            resolve(result);
        }
        function onYes() { cleanup('yes'); }
        function onMiddle() { cleanup('middle'); }
        function onNo() { cleanup('no'); }
        yesBtn.addEventListener('click', onYes);
        middleBtn.addEventListener('click', onMiddle);
        noBtn.addEventListener('click', onNo);
    });
}

function updateUIForMode() {
    const isAuto = routeMode === 'auto';
    const isManual = routeMode === 'manual';
    const isTrack = routeMode === 'track';
    document.getElementById('auto-controls').classList.toggle('hidden', !isAuto);
    document.getElementById('manual-controls').classList.toggle('hidden', !isManual);
    document.getElementById('track-controls').classList.toggle('hidden', !isTrack);
    document.getElementById('hint-auto').classList.toggle('hidden', !isAuto);
    document.getElementById('hint-manual').classList.add('hidden');
    document.getElementById('generate-btn').classList.toggle('hidden', isTrack);
    document.getElementById('regenerate-btn').classList.add('hidden');
    document.getElementById('share-btn').classList.add('hidden');
    document.getElementById('save-route-btn').classList.add('hidden');
}

function clearManualMode(clearGenerated = true) {
    manualPoints = [];
    manualMarkers.forEach(m => map.removeLayer(m));
    manualMarkers = [];
    manualRouteClosed = false;
    insertMode = false;
    document.getElementById('insert-mode-btn').classList.remove('active');
    document.body.classList.remove('insert-mode');
    if (manualPolyline) { map.removeLayer(manualPolyline); manualPolyline = null; }
    if (clearGenerated) {
        clearGeneratedRoute();
    }
    document.getElementById('generate-btn').disabled = true;
    updateManualCount();
}

function clearGeneratedRoute() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    currentRoute = null;
    document.getElementById('route-info').classList.add('hidden');
    document.getElementById('regenerate-btn').classList.add('hidden');
    document.getElementById('share-btn').classList.add('hidden');
    document.getElementById('save-route-btn').classList.add('hidden');
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
        }),
        draggable: true
    }).addTo(map);

    marker.on('click', function(e) {
        if (marker._justDragged) { marker._justDragged = false; return; }
        L.DomEvent.stop(e);
        removeManualPoint(idx);
    });

    marker.on('dragstart', function() {
        const pos = marker.getLatLng();
        marker._dragStartPos = { lat: pos.lat, lng: pos.lng };
    });

    marker.on('drag', function() {
        const pos = marker.getLatLng();
        manualPoints[idx] = { lat: pos.lat, lng: pos.lng };

        if (manualPolyline) {
            const coords = manualPoints.map(p => [p.lat, p.lng]);
            if (manualRouteClosed) coords.push([manualPoints[0].lat, manualPoints[0].lng]);
            manualPolyline.setLatLngs(coords);
        }

        if (manualRouteClosed) return;
        const isLast = idx === manualPoints.length - 1 && idx > 0;
        if (!isLast) return;

        const firstPos = manualMarkers[0].getLatLng();
        const dist = map.latLngToContainerPoint(pos)
            .distanceTo(map.latLngToContainerPoint(firstPos));

        const firstEl = manualMarkers[0].getElement();
        if (firstEl) {
            firstEl.querySelector('.manual-marker').classList.toggle('snap-highlight', dist < 40);
        }
    });

    marker.on('dragend', function() {
        marker._justDragged = true;
        const pos = marker.getLatLng();

        const isLast = idx === manualPoints.length - 1 && idx > 0;
        if (isLast && !manualRouteClosed) {
            const firstPos = manualMarkers[0].getLatLng();
            const dist = map.latLngToContainerPoint(pos)
                .distanceTo(map.latLngToContainerPoint(firstPos));

            const firstEl = manualMarkers[0].getElement();
            if (firstEl) {
                firstEl.querySelector('.manual-marker').classList.remove('snap-highlight');
            }

            if (dist < 40) {
                if (marker._dragStartPos) {
                    marker.setLatLng([marker._dragStartPos.lat, marker._dragStartPos.lng]);
                    manualPoints[idx] = { lat: marker._dragStartPos.lat, lng: marker._dragStartPos.lng };
                }
                closeManualRoute();
                return;
            }
        }

        manualPoints[idx] = { lat: pos.lat, lng: pos.lng };
        redrawManualPolyline();
        if (currentRoute && manualPoints.length >= 2) {
            generateManualRoute();
        }
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
            if (m._justDragged) { m._justDragged = false; return; }
            L.DomEvent.stop(e);
            removeManualPoint(i);
        });
        m.off('drag');
        m.on('drag', function() {
            const pos = m.getLatLng();
            manualPoints[i] = { lat: pos.lat, lng: pos.lng };
            if (manualPolyline) {
                const coords = manualPoints.map(p => [p.lat, p.lng]);
                if (manualRouteClosed) coords.push([manualPoints[0].lat, manualPoints[0].lng]);
                manualPolyline.setLatLngs(coords);
            }
        });
        m.off('dragend');
        m.on('dragend', function() {
            m._justDragged = true;
            const pos = m.getLatLng();
            manualPoints[i] = { lat: pos.lat, lng: pos.lng };
            redrawManualPolyline();
            if (currentRoute && manualPoints.length >= 2) {
                generateManualRoute();
            }
        });
    });
}

function redrawManualPolyline() {
    if (manualPolyline) map.removeLayer(manualPolyline);
    if (manualPoints.length < 2) { manualPolyline = null; return; }
    const coords = manualPoints.map(p => [p.lat, p.lng]);
    if (manualRouteClosed) {
        coords.push([manualPoints[0].lat, manualPoints[0].lng]);
    }
    manualPolyline = L.polyline(
        coords,
        { color: '#39FF14', weight: 3, dashArray: '8,6', opacity: 0.8 }
    ).addTo(map);
}

function closeManualRoute() {
    if (manualPoints.length < 2) return;
    manualRouteClosed = true;
    redrawManualPolyline();
}

// === GPS Location ===

let locationManagerInited = false;
let lastKnownLocation = null;

function initGPS() {
    document.getElementById('gps-btn').addEventListener('click', onGPSClick);
    initLocationManager();
}

function initLocationManager() {
    if (!window.Telegram?.WebApp?.LocationManager) {
        requestBrowserGPS();
        return;
    }

    const lm = Telegram.WebApp.LocationManager;
    if (lm.isInited) {
        locationManagerInited = true;
        tryAutoRequestGPS();
        return;
    }

    lm.init(() => {
        locationManagerInited = true;
        tryAutoRequestGPS();
    });
}

function tryAutoRequestGPS() {
    const lm = Telegram.WebApp.LocationManager;
    if (!lm || !locationManagerInited) return;

    // Use cached location immediately if fresh (< 5 min)
    if (lastKnownLocation && (Date.now() - lastKnownLocation.timestamp < 300000)) {
        applyGPSLocation(lastKnownLocation.lat, lastKnownLocation.lng);
        return;
    }

    if (!lm.isLocationAvailable) {
        requestBrowserGPS();
        return;
    }

    if (lm.isAccessGranted) {
        requestTelegramLocation();
    } else if (!lm.isAccessRequested) {
        requestTelegramLocation();
    }
}

function requestTelegramLocation() {
    const lm = Telegram.WebApp.LocationManager;
    if (!lm || !locationManagerInited) {
        requestBrowserGPS();
        return;
    }

    const status = document.getElementById('location-status');
    status.textContent = 'Определение местоположения...';
    status.className = 'status loading';

    lm.getLocation((loc) => {
        if (loc && loc.latitude) {
            applyGPSLocation(loc.latitude, loc.longitude);
        } else if (!lm.isAccessGranted) {
            status.textContent = 'Геолокация недоступна. Нажмите для настроек';
            status.className = 'status error';
            status.onclick = () => {
                lm.openSettings();
                status.onclick = null;
            };
        } else {
            requestBrowserGPS();
        }
    });
}

function onGPSClick() {
    if (window.Telegram?.WebApp?.LocationManager && locationManagerInited) {
        requestTelegramLocation();
    } else {
        requestBrowserGPS();
    }
}

function requestBrowserGPS() {
    if (!navigator.geolocation) return;

    const status = document.getElementById('location-status');
    status.textContent = 'Определение местоположения...';
    status.className = 'status loading';

    // Stage 1: Fast location (WiFi/cell towers, ~1-2 sec)
    navigator.geolocation.getCurrentPosition(
        pos => {
            applyGPSLocation(pos.coords.latitude, pos.coords.longitude);
            // Stage 2: Upgrade to high accuracy in background
            navigator.geolocation.getCurrentPosition(
                pos2 => applyGPSLocation(pos2.coords.latitude, pos2.coords.longitude),
                () => {},
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        },
        () => {
            // Fallback: try high accuracy directly
            navigator.geolocation.getCurrentPosition(
                pos => applyGPSLocation(pos.coords.latitude, pos.coords.longitude),
                err => {
                    status.textContent = 'Не удалось определить местоположение';
                    status.className = 'status error';
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        },
        { enableHighAccuracy: false, timeout: 3000, maximumAge: 0 }
    );
}

function applyGPSLocation(lat, lng) {
    if (routeMode === 'manual' && manualPoints.length > 0) return;

    lastKnownLocation = { lat, lng, timestamp: Date.now() };
    userLocation = { lat, lng };
    if (routeMode === 'manual') {
        addManualPoint(lat, lng);
    } else {
        setStartMarker(lat, lng);
    }
    map.setView([lat, lng], 15);
    const status = document.getElementById('location-status');
    status.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    status.className = 'status success';
    document.getElementById('generate-btn').disabled = false;
}

// === Insert point between existing ===

let insertMode = false;

function initInsertMode() {
    document.getElementById('insert-mode-btn').addEventListener('click', toggleInsertMode);
}

function toggleInsertMode() {
    insertMode = !insertMode;
    document.getElementById('insert-mode-btn').classList.toggle('active', insertMode);
    document.body.classList.toggle('insert-mode', insertMode);
}

function findNearestSegmentIdx(lat, lng) {
    if (manualPoints.length < 2) return -1;

    let minDist = Infinity;
    let insertIdx = -1;

    for (let i = 0; i < manualPoints.length - 1; i++) {
        const p1 = manualPoints[i];
        const p2 = manualPoints[i + 1];
        const dist = distToSegment(lat, lng, p1.lat, p1.lng, p2.lat, p2.lng);
        if (dist < minDist) {
            minDist = dist;
            insertIdx = i + 1;
        }
    }

    if (manualRouteClosed && manualPoints.length > 2) {
        const p1 = manualPoints[manualPoints.length - 1];
        const p2 = manualPoints[0];
        const dist = distToSegment(lat, lng, p1.lat, p1.lng, p2.lat, p2.lng);
        if (dist < minDist) {
            minDist = dist;
            insertIdx = manualPoints.length;
        }
    }

    return minDist < 0.0003 ? insertIdx : -1;
}

function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function insertManualPointBetween(idx, lat, lng) {
    manualPoints.splice(idx, 0, { lat, lng });
    rebuildManualMarkers();
    redrawManualPolyline();
    updateManualCount();
    document.getElementById('generate-btn').disabled = manualPoints.length < 2;
}

function rebuildManualMarkers() {
    manualMarkers.forEach(m => map.removeLayer(m));
    manualMarkers = [];

    manualPoints.forEach((p, i) => {
        const marker = L.marker([p.lat, p.lng], {
            icon: L.divIcon({
                className: 'waypoint-marker',
                html: '<div class="manual-marker" data-idx="' + i + '">' +
                      '<span class="manual-marker-num">' + (i + 1) + '</span>' +
                      '<span class="manual-marker-del" data-idx="' + i + '">&times;</span>' +
                      '</div>',
                iconSize: [30, 30], iconAnchor: [15, 15]
            }),
            draggable: true
        }).addTo(map);

        marker.on('click', function(e) {
            if (marker._justDragged) { marker._justDragged = false; return; }
            L.DomEvent.stop(e);
            removeManualPoint(i);
        });

        marker.on('dragstart', function() {
            const pos = marker.getLatLng();
            marker._dragStartPos = { lat: pos.lat, lng: pos.lng };
        });

        marker.on('drag', function() {
            const pos = marker.getLatLng();
            manualPoints[i] = { lat: pos.lat, lng: pos.lng };
            if (manualPolyline) {
                const coords = manualPoints.map(p => [p.lat, p.lng]);
                if (manualRouteClosed) coords.push([manualPoints[0].lat, manualPoints[0].lng]);
                manualPolyline.setLatLngs(coords);
            }
            if (manualRouteClosed) return;
            const isLast = i === manualPoints.length - 1 && i > 0;
            if (!isLast) return;
            const firstPos = manualMarkers[0].getLatLng();
            const dist = map.latLngToContainerPoint(pos)
                .distanceTo(map.latLngToContainerPoint(firstPos));
            const firstEl = manualMarkers[0].getElement();
            if (firstEl) {
                firstEl.querySelector('.manual-marker').classList.toggle('snap-highlight', dist < 40);
            }
        });

        marker.on('dragend', function() {
            marker._justDragged = true;
            const pos = marker.getLatLng();
            const isLast = i === manualPoints.length - 1 && i > 0;
            if (isLast && !manualRouteClosed) {
                const firstPos = manualMarkers[0].getLatLng();
                const dist = map.latLngToContainerPoint(pos)
                    .distanceTo(map.latLngToContainerPoint(firstPos));
                const firstEl = manualMarkers[0].getElement();
                if (firstEl) {
                    firstEl.querySelector('.manual-marker').classList.remove('snap-highlight');
                }
                if (dist < 40) {
                    if (marker._dragStartPos) {
                        marker.setLatLng([marker._dragStartPos.lat, marker._dragStartPos.lng]);
                        manualPoints[i] = { lat: marker._dragStartPos.lat, lng: marker._dragStartPos.lng };
                    }
                    closeManualRoute();
                    return;
                }
            }
            manualPoints[i] = { lat: pos.lat, lng: pos.lng };
            redrawManualPolyline();
            if (currentRoute && manualPoints.length >= 2) {
                generateManualRoute();
            }
        });

        manualMarkers.push(marker);
    });
}

// === GPS Location ===

function detectLocation() {
    const btn = document.getElementById('gps-btn');
    const status = document.getElementById('location-status');
    btn.classList.add('loading');
    status.textContent = 'Определение местоположения...';
    status.className = 'status';

    if (window.Telegram?.WebApp?.LocationManager) {
        Telegram.WebApp.LocationManager.getLocation()
            .then(loc => {
                if (loc && loc.latitude) {
                    applyGPSLocation(loc.latitude, loc.longitude);
                } else {
                    requestBrowserGPS();
                }
            })
            .catch(() => requestBrowserGPS())
            .finally(() => btn.classList.remove('loading'));
    } else {
        requestBrowserGPS();
    }
}

function applyLocation(lat, lng) {
    userLocation = { lat, lng };
    if (routeMode === 'manual') {
        addManualPoint(lat, lng);
    } else {
        setStartMarker(lat, lng);
    }
    map.setView([lat, lng], 15);
    const status = document.getElementById('location-status');
    status.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    status.className = 'status success';
    document.getElementById('generate-btn').disabled = false;
}

// === Search ===

let searchDebounce = null;

function initSearch() {
    const input = document.getElementById('address-input');
    const suggestions = document.getElementById('address-suggestions');
    const clearBtn = document.getElementById('clear-input-btn');

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.add('hidden');
        hideSuggestions();
        input.focus();
    });

    document.getElementById('search-btn').addEventListener('click', searchAddress);
    input.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
            hideSuggestions();
            searchAddress();
        }
    });

    // Autocomplete
    input.addEventListener('input', () => {
        clearBtn.classList.toggle('hidden', input.value.length === 0);
        clearTimeout(searchDebounce);
        const query = input.value.trim();
        if (query.length < 3) {
            hideSuggestions();
            return;
        }
        searchDebounce = setTimeout(() => fetchSuggestions(query), 300);
    });

    // Hide on outside click
    document.addEventListener('click', e => {
        if (!e.target.closest('.search-box')) {
            hideSuggestions();
        }
    });

    // Hide on blur (with delay for click)
    input.addEventListener('blur', () => {
        setTimeout(hideSuggestions, 200);
    });
}

function fetchSuggestions(query) {
    const suggestions = document.getElementById('address-suggestions');

    fetch('https://nominatim.openstreetmap.org/search?' +
        new URLSearchParams({ format: 'json', q: query, limit: 5, 'accept-language': 'ru' }),
        { headers: { 'User-Agent': 'RunRouteBot/1.0' } }
    )
    .then(r => r.json())
    .then(data => {
        if (!data || data.length === 0) {
            hideSuggestions();
            return;
        }

        let html = '';
        data.forEach(item => {
            const parts = item.display_name.split(',').map(s => s.trim());
            let street = '';
            let house = '';
            let city = '';
            for (const p of parts) {
                if (/^\d/.test(p) || /корпус|кв|стр|corp/i.test(p)) {
                    house = house ? house + ' ' + p : p;
                } else if (!street && /улица|проспект|бульвар|переулок|шоссе|набережная|площадь|проезд/i.test(p)) {
                    street = p;
                } else if (!city && p.length > 3) {
                    city = p;
                }
            }
            const display = [city, street, house].filter(Boolean).join(', ');
            html += '<div class="suggestion-item" data-lat="' + item.lat + '" data-lon="' + item.lon + '" data-display="' + escapeXml(display) + '">' +
                '<svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                '<div class="suggestion-text">' + escapeXml(display) + '</div>' +
                '</div>';
        });

        suggestions.innerHTML = html;
        suggestions.classList.remove('hidden');

        suggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const lat = parseFloat(item.dataset.lat);
                const lon = parseFloat(item.dataset.lon);
                const display = item.dataset.display;
                selectSuggestion(lat, lon, display);
            });
        });
    })
    .catch(() => hideSuggestions());
}

function selectSuggestion(lat, lon, display) {
    const input = document.getElementById('address-input');
    input.value = display;
    hideSuggestions();

    userLocation = { lat, lng: lon };
    if (routeMode === 'manual') {
        addManualPoint(lat, lon);
    } else {
        setStartMarker(lat, lon);
    }
    map.setView([lat, lon], 15);
    document.getElementById('location-status').textContent = display;
    document.getElementById('location-status').className = 'status success';
    document.getElementById('generate-btn').disabled = false;
}

function hideSuggestions() {
    document.getElementById('address-suggestions').classList.add('hidden');
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
    if (routeMode === 'track') return;
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
    const MAX_ITERATIONS = 8;
    const TOLERANCE_KM = 0.3;
    let bestRoute = null;
    let bestDiff = Infinity;
    let radiusKm = targetKm / (2 * Math.PI) * 1.2;

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

    const angleOffset = (routeSeed * 0.8) % (2 * Math.PI);
    const numPts = 5;
    const waypoints = [{ lat, lon: lng }];
    for (let i = 0; i < numPts; i++) {
        const angle = angleOffset + (2 * Math.PI * i) / numPts;
        waypoints.push({
            lat: lat + rLat * Math.sin(angle),
            lon: lng + rLng * Math.cos(angle)
        });
    }
    waypoints.push({ lat, lon: lng });

    return await valhallaRoute(waypoints);
}

async function valhallaRoute(waypoints) {
    const locations = waypoints.map((p, i) => ({
        lat: p.lat,
        lon: p.lon,
        type: i === 0 || i === waypoints.length - 1 ? 'break' : 'through'
    }));

    const body = {
        locations: locations,
        costing: 'pedestrian',
        directions_options: {
            units: 'kilometers',
            language: 'ru-RU'
        },
        costing_options: {
            pedestrian: {
                walking_speed: 5.0,
                use_roads: 0.9,
                use_tracks: 0.3,
                use_living_roads: 0.3,
                use_highways: 0.0,
                use_hills: 0.3,
                use_hills_mountain: 0.3,
                service_factor: 0.5,
                alley_factor: 1.0,
                driveway_factor: 0.0,
                parking_lot_factor: 0.0
            }
        }
    };

    try {
        const resp = await fetch('https://valhalla1.openstreetmap.de/route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();

        if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) return null;

        const leg = data.trip.legs[0];
        const shape = decodePolyline(leg.shape);

        // Считаем расстояние по точкам для точности
        const distance_km = haversineArr(shape);

        return { points: shape, distance_km };
    } catch {
        return null;
    }
}

function decodePolyline(encoded) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lat += ((result & 1) ? ~(result >> 1) : (result >> 1));

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lng += ((result & 1) ? ~(result >> 1) : (result >> 1));

        points.push({ lat: lat / 1e6, lng: lng / 1e6 });
    }
    return points;
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

const { haversine, haversineArr, interpolatePoints, addIntermediateWaypoints, escapeXml, makeGPX } = window.RunRouteUtils;
const { formatDuration, calculatePaceMetrics, buildSplits } = window.RunRoutePaceUtils;
const { getModeTransitionPlan } = window.RunRouteModeUtils;

async function generateManualRoute() {
    if (manualPoints.length < 2) return;
    const btn = document.getElementById('generate-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Построение...';

    try {
        let waypoints = manualPoints.map(p => ({ lat: p.lat, lon: p.lng }));
        if (manualRouteClosed && waypoints.length > 1) {
            waypoints.push({ lat: waypoints[0].lat, lon: waypoints[0].lon });
        }
        waypoints = addIntermediateWaypoints(waypoints);
        const result = await valhallaRoute(waypoints);

        if (!result) {
            alert('Маршрут не найден. Попробуйте другие точки.');
            return;
        }

        if (manualPolyline) { map.removeLayer(manualPolyline); manualPolyline = null; }

        currentRoute = {
            points: result.points,
            distance_km: result.distance_km,
            accuracy: 0,
            gpx: makeGPX(result.points, 'Manual Route')
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

function showRouteButtons(mode) {
    document.getElementById('route-info').classList.remove('hidden');
    document.getElementById('share-btn').classList.remove('hidden');
    if (mode === 'saved') {
        document.getElementById('regenerate-btn').classList.add('hidden');
        document.getElementById('save-route-btn').classList.add('hidden');
        document.getElementById('generate-btn').classList.add('hidden');
    } else if (mode === 'track') {
        document.getElementById('regenerate-btn').classList.add('hidden');
        document.getElementById('save-route-btn').classList.remove('hidden');
        document.getElementById('generate-btn').classList.add('hidden');
    } else {
        document.getElementById('regenerate-btn').classList.remove('hidden');
        document.getElementById('save-route-btn').classList.remove('hidden');
        document.getElementById('generate-btn').classList.remove('hidden');
    }
}

function displayRoute(route) {
    if (routeLayer) map.removeLayer(routeLayer);
    const pts = route.points.map(p => [p.lat, p.lng]);
    const segments = [];
    const segSize = Math.max(1, Math.floor(pts.length / 20));
    for (let i = 0; i < pts.length - 1; i += segSize) {
        const chunk = pts.slice(i, i + segSize + 1);
        if (chunk.length < 2) continue;
        const t = i / (pts.length - 1);
        const r = Math.round(57 + t * (0 - 57));
        const g = Math.round(255 + t * (212 - 255));
        const b = Math.round(20 + t * (255 - 20));
        segments.push(L.polyline(chunk, {
            color: `rgb(${r},${g},${b})`,
            weight: 4,
            opacity: 0.9
        }));
    }
    routeLayer = L.layerGroup(segments).addTo(map);
    const bounds = L.latLngBounds(pts);
    map.fitBounds(bounds, { padding: [40, 40] });

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

    const metrics = calculatePaceMetrics(selectedPaceDist, totalSec, selectedLapDist);
    if (!metrics) return;

    document.getElementById('result-pace').textContent = metrics.paceText;
    document.getElementById('result-speed').textContent = metrics.speedText;
    document.getElementById('result-lap').textContent = metrics.lapText;

    renderSplits(metrics.distanceKm, metrics.paceSecondsPerKm);
}

function renderSplits(distKm, paceSec) {
    const container = document.getElementById('splits-container');
    if (!container) return;

    const splits = buildSplits(distKm * 1000, paceSec);

    let html = '<div class="splits-table">';
    html += '<div class="split-header"><span>Км</span><span>Время</span><span>Суммарно</span></div>';

    for (const split of splits) {
        html += '<div class="split-row' + (split.partial ? ' partial' : '') + '"><span>' + split.label + '</span><span>' +
            split.segmentText + '</span><span>' + split.cumulativeText + '</span></div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

// === Utilities ===

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

// === Share ===

function initShare() {
    document.getElementById('share-btn').addEventListener('click', shareRoute);
}

async function shareRoute() {
    if (!currentRoute || !currentRoute.gpx) return 'failed';

    const dist = currentRoute.distance_km.toFixed(1);
    const fileName = 'route_' + dist + 'km.gpx';
    const file = new File([currentRoute.gpx], fileName, { type: 'application/gpx+xml' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'Маршрут ' + dist + ' км',
                text: '🏃 Маршрут ' + dist + ' км построен в @run_route_bot'
            });
            showToast('Маршрут отправлен');
            return 'shared';
        } catch (e) {
            if (e.name === 'AbortError') {
                return 'cancelled';
            }
            downloadGPX();
            showToast('GPX скачан');
            return 'downloaded';
        }
    } else {
        downloadGPX();
        showToast('GPX скачан');
        return 'downloaded';
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

// === Live Tracking ===

function startTracking() {
    if (!navigator.geolocation) {
        alert('Геолокация не поддерживается');
        return;
    }

    tracking = true;
    trackingPoints = [];
    trackingLastValid = null;

    if (trackingPolyline) { map.removeLayer(trackingPolyline); trackingPolyline = null; }

    document.getElementById('track-start-btn').classList.add('hidden');
    document.getElementById('track-stop-btn').classList.remove('hidden');

    trackingWatchId = navigator.geolocation.watchPosition(
        pos => onTrackingPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp),
        err => {
            console.warn('Tracking GPS error:', err.message);
            const status = document.getElementById('track-status');
            if (status) {
                status.textContent = 'GPS недоступен. Проверьте разрешения.';
                status.className = 'track-status error';
            }
        },
        { enableHighAccuracy: true, maximumAge: 1000 }
    );
}

function stopTracking() {
    tracking = false;
    if (trackingWatchId !== null) {
        navigator.geolocation.clearWatch(trackingWatchId);
        trackingWatchId = null;
    }

    if (trackingMarker) { map.removeLayer(trackingMarker); trackingMarker = null; }
    if (trackingPolyline) { map.removeLayer(trackingPolyline); trackingPolyline = null; }

    document.getElementById('track-start-btn').classList.remove('hidden');
    document.getElementById('track-stop-btn').classList.add('hidden');

    if (trackingPoints.length < 2) {
        alert('Недостаточно точек для маршрута');
        return;
    }

    const totalDist = haversineArr(trackingPoints);
    currentRoute = {
        points: trackingPoints,
        distance_km: totalDist,
        accuracy: 0,
        gpx: makeGPX(trackingPoints, 'Live Track ' + totalDist.toFixed(1) + 'km')
    };
    displayRoute(currentRoute);
    showRouteButtons('track');
}

function onTrackingPosition(lat, lng, accuracy, timestamp) {
    if (!tracking) return;

    if (accuracy > TRACK_MAX_ACCURACY_M) {
        console.warn('GPS point rejected: accuracy', accuracy, 'm >', TRACK_MAX_ACCURACY_M, 'm');
        return;
    }

    const point = { lat, lng, time: timestamp || Date.now(), accuracy };

    if (trackingLastValid) {
        if (timestamp && trackingLastValid.time && timestamp <= trackingLastValid.time) {
            console.warn('GPS point rejected: timestamp not advancing');
            return;
        }

        const dist = haversine(trackingLastValid.lat, trackingLastValid.lng, lat, lng);
        const timeMs = timestamp && trackingLastValid.time ? timestamp - trackingLastValid.time : Date.now() - trackingLastValid.time;
        const timeSec = timeMs / 1000;
        if (timeSec > 0) {
            const speedKmh = (dist / timeSec) * 3600;
            if (speedKmh > TRACK_MAX_SPEED_KMH) {
                console.warn('GPS point rejected: speed', speedKmh.toFixed(1), 'km/h >', TRACK_MAX_SPEED_KMH, 'km/h');
                return;
            }
        }
        if (dist * 1000 < TRACK_MIN_DIST_M) return;
    }

    const smoothed = smoothPoint(point);
    trackingLastValid = { lat: smoothed.lat, lng: smoothed.lng, time: point.time, accuracy: point.accuracy };
    trackingPoints.push(smoothed);

    if (trackingPolyline) map.removeLayer(trackingPolyline);
    trackingPolyline = L.polyline(
        trackingPoints.map(p => [p.lat, p.lng]),
        { color: '#39FF14', weight: 4, opacity: 0.9 }
    ).addTo(map);

    if (!trackingMarker) {
        trackingMarker = L.circleMarker([smoothed.lat, smoothed.lng], {
            radius: 8,
            color: '#39FF14',
            fillColor: '#39FF14',
            fillOpacity: 0.5,
            weight: 2
        }).addTo(map);
    } else {
        trackingMarker.setLatLng([smoothed.lat, smoothed.lng]);
    }

    map.setView([smoothed.lat, smoothed.lng], map.getZoom());
}

function smoothPoint(point) {
    if (trackingPoints.length < TRACK_SMOOTH_N) return point;
    const recent = trackingPoints.slice(-TRACK_SMOOTH_N);
    recent.push(point);
    const avgLat = recent.reduce((s, p) => s + p.lat, 0) / recent.length;
    const avgLng = recent.reduce((s, p) => s + p.lng, 0) / recent.length;
    return { lat: avgLat, lng: avgLng, time: point.time, accuracy: point.accuracy };
}

// === Feedback ===

function openFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    const textarea = document.getElementById('feedback-text');
    textarea.value = '';
    modal.classList.remove('hidden');
    textarea.focus();
}

function initFeedback() {
    const modal = document.getElementById('feedback-modal');
    const sendBtn = document.getElementById('feedback-send');
    const cancelBtn = document.getElementById('feedback-cancel');

    cancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    sendBtn.addEventListener('click', async () => {
        const textarea = document.getElementById('feedback-text');
        const text = textarea.value.trim();
        if (!text) return;

        sendBtn.disabled = true;
        sendBtn.textContent = 'Отправка...';

        try {
            const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
            const resp = await fetch(apiUrl('/api/feedback'), {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    message: text,
                    user_id: user?.id || null,
                    username: user?.username || null
                })
            });

            const data = await resp.json();

            if (resp.ok) {
                modal.classList.add('hidden');
                showToast('Отправлено');
            } else {
                alert('Ошибка: ' + (data.error || 'Не удалось отправить'));
            }
        } catch (e) {
            alert('Ошибка сети: ' + e.message);
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Отправить';
        }
    });
}

// === User profile ===

let currentUser = null;

async function loadCurrentUser() {
    if (!isTelegramApp()) {
        return;
    }
    try {
        const resp = await fetch(apiUrl('/api/me'), { headers: getApiHeaders() });
        if (resp.ok) {
            const data = await resp.json();
            currentUser = data.user;
        } else if (resp.status === 401) {
            console.warn('Telegram auth failed — running outside Telegram or invalid initData');
        }
    } catch (e) {
        console.warn('Could not load user:', e.message);
    }
}

// === User menu ===

function initMenu() {
    const btn = document.getElementById('menu-btn');
    const menu = document.getElementById('user-menu');
    const profileBtn = document.getElementById('menu-profile');
    const calendarBtn = document.getElementById('menu-calendar');
    const feedbackBtn = document.getElementById('menu-feedback');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        menu.classList.add('hidden');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            menu.classList.add('hidden');
        }
    });

    menu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    profileBtn.addEventListener('click', () => {
        menu.classList.add('hidden');
        openProfileModal();
    });

    calendarBtn.addEventListener('click', () => {
        menu.classList.add('hidden');
        openCalendar();
    });

    feedbackBtn.addEventListener('click', () => {
        menu.classList.add('hidden');
        openFeedbackModal();
    });
}

// === Profile modal ===

function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    const loading = document.getElementById('profile-loading');
    const form = document.getElementById('profile-form');
    const status = document.getElementById('profile-status');

    if (!isTelegramApp()) {
        modal.classList.remove('hidden');
        loading.classList.add('hidden');
        form.classList.add('hidden');
        status.textContent = 'Профиль доступен только внутри Telegram';
        status.className = 'profile-status error';
        status.classList.remove('hidden');
        return;
    }

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    form.classList.add('hidden');
    status.classList.add('hidden');

    loadProfileData();
}

// === Save route ===

function buildSaveRoutePayload() {
    if (!currentRoute || !currentRoute.points || currentRoute.points.length < 2) return null;
    const points = currentRoute.points.map(p => {
        const pt = { lat: p.lat, lng: p.lng };
        if (p.time) pt.time = p.time;
        if (p.accuracy != null) pt.accuracy = p.accuracy;
        return pt;
    });
    if (points.length > 10000) return null;
    return {
        name: document.getElementById('save-route-name').value.trim() || ('Маршрут — ' + new Date().toLocaleDateString('ru')),
        route_mode: routeMode,
        distance_m: Math.round(currentRoute.distance_km * 1000),
        points: points,
    };
}

function initSaveRoute() {
    const modal = document.getElementById('save-route-modal');
    const confirmBtn = document.getElementById('save-route-confirm');
    const cancelBtn = document.getElementById('save-route-cancel');
    const nameInput = document.getElementById('save-route-name');
    const status = document.getElementById('save-route-status');

    document.getElementById('share-btn').addEventListener('click', () => {
        if (!currentRoute || !currentRoute.points || currentRoute.points.length < 2) return;
    });

    cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    confirmBtn.addEventListener('click', async () => {
        if (!isTelegramApp()) {
            status.textContent = 'Сохранение доступно внутри Telegram';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
            return;
        }
        const payload = buildSaveRoutePayload();
        if (!payload) {
            status.textContent = 'Нет данных маршрута';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
            return;
        }
        if (payload.points.length > 10000) {
            status.textContent = 'Максимум 10 000 точек';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
            return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Сохранение...';
        status.classList.add('hidden');
        try {
            const resp = await fetch(apiUrl('/api/routes'), {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify(payload),
            });
            if (resp.ok) {
                const saved = await resp.json();
                calRoutes.unshift({
                    id: saved.id,
                    name: saved.name,
                    route_mode: saved.route_mode,
                    distance_m: saved.distance_m,
                    created_at: saved.created_at,
                    updated_at: saved.updated_at,
                    points_count: saved.points ? saved.points.length : 0,
                });
                modal.classList.add('hidden');
                showToast('Маршрут сохранён');
            } else {
                const data = await resp.json().catch(() => ({}));
                status.textContent = data.detail || 'Ошибка сохранения';
                status.className = 'profile-status error';
                status.classList.remove('hidden');
            }
        } catch (e) {
            status.textContent = 'Ошибка сети';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Сохранить';
        }
    });
}

function openSaveRouteModal() {
    if (!currentRoute || !currentRoute.points || currentRoute.points.length < 2) return;
    if (!isTelegramApp()) {
        showToast('Сохранение доступно внутри Telegram');
        return;
    }
    const nameInput = document.getElementById('save-route-name');
    nameInput.value = 'Маршрут — ' + new Date().toLocaleDateString('ru');
    document.getElementById('save-route-status').classList.add('hidden');
    document.getElementById('save-route-modal').classList.remove('hidden');
    nameInput.focus();
}

// === Calendar ===

const {
    getMonthStart: calGetMonthStart,
    getMonthEnd: calGetMonthEnd,
    formatDatetimeLocal,
    datetimeLocalToISO,
    isSameDay,
    getRunDayKey,
    formatRouteMode,
    formatDistanceM,
    formatDate,
    dedupRoutesById,
    buildRouteDetailUrl,
    buildRouteUpdateUrl,
    buildRouteDeleteUrl,
    buildCurrentRouteFromApi,
    buildCalendarRunsUrl,
    fetchCalendarData,
    validateSavedRouteForDisplay,
    classifyHttpError,
    getOpenSavedRouteErrorMessage,
} = window.RunRouteCalendarUtils;

let calYear, calMonth, calSelectedDate, calRuns = [], calRoutes = [];
let editingRunId = null;
let calRequestSeq = 0;

function initCalendar() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();

    initCalendarTabs();

    document.getElementById('cal-prev').addEventListener('click', async () => {
        calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
        const result = await loadCalendarData();
        const status = document.getElementById('calendar-status');
        const runsStatus = document.getElementById('cal-runs-status');
        const errorMessages = {
            auth: 'Не удалось подтвердить авторизацию Telegram',
            not_found: 'Календарь ещё не доступен на сервере',
            server: 'Сервис календаря временно недоступен',
            network: 'Не удалось подключиться к серверу',
        };
        if (result.runsError && result.routesError) {
            const msg = result.runsError === result.routesError
                ? errorMessages[result.runsError]
                : 'Не удалось загрузить данные';
            status.textContent = msg || 'Не удалось загрузить данные';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
        } else {
            status.classList.add('hidden');
        }
        if (result.runsError) {
            safeSetText(runsStatus, errorMessages[result.runsError] || 'Ошибка загрузки пробежек');
            runsStatus.className = 'profile-status error';
            runsStatus.classList.remove('hidden');
        } else {
            runsStatus.classList.add('hidden');
        }
        renderCalendar();
    });
    document.getElementById('cal-next').addEventListener('click', async () => {
        calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
        const result = await loadCalendarData();
        const status = document.getElementById('calendar-status');
        const runsStatus = document.getElementById('cal-runs-status');
        const errorMessages = {
            auth: 'Не удалось подтвердить авторизацию Telegram',
            not_found: 'Календарь ещё не доступен на сервере',
            server: 'Сервис календаря временно недоступен',
            network: 'Не удалось подключиться к серверу',
        };
        if (result.runsError && result.routesError) {
            const msg = result.runsError === result.routesError
                ? errorMessages[result.runsError]
                : 'Не удалось загрузить данные';
            status.textContent = msg || 'Не удалось загрузить данные';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
        } else {
            status.classList.add('hidden');
        }
        if (result.runsError) {
            safeSetText(runsStatus, errorMessages[result.runsError] || 'Ошибка загрузки пробежек');
            runsStatus.className = 'profile-status error';
            runsStatus.classList.remove('hidden');
        } else {
            runsStatus.classList.add('hidden');
        }
        renderCalendar();
    });
    document.getElementById('cal-add-run').addEventListener('click', openRunForm);
    document.getElementById('calendar-close').addEventListener('click', () => document.getElementById('calendar-modal').classList.add('hidden'));
    document.getElementById('calendar-modal').addEventListener('click', e => { if (e.target.id === 'calendar-modal') e.target.classList.add('hidden'); });

    document.getElementById('run-form-save').addEventListener('click', saveRun);
    document.getElementById('run-form-cancel').addEventListener('click', () => document.getElementById('run-form-modal').classList.add('hidden'));
    document.getElementById('run-form-modal').addEventListener('click', e => { if (e.target.id === 'run-form-modal') e.target.classList.add('hidden'); });
}

async function loadCalendarData() {
    const seq = ++calRequestSeq;
    const from = calGetMonthStart(calYear, calMonth);
    const to = calGetMonthEnd(calYear, calMonth);

    let runsResult, routesResult;
    try {
        [runsResult, routesResult] = await Promise.allSettled([
            fetch(apiUrl(buildCalendarRunsUrl(from, to)), { headers: getApiHeaders() }),
            fetch(apiUrl('/api/routes'), { headers: getApiHeaders() }),
        ]);
    } catch {
        if (seq !== calRequestSeq) return { runsError: null, routesError: null };
        return { runsError: 'network', routesError: 'network' };
    }

    if (seq !== calRequestSeq) return { runsError: null, routesError: null };

    const runsFetch = runsResult.status === 'fulfilled' ? runsResult.value : { _networkError: true };
    const routesFetch = routesResult.status === 'fulfilled' ? routesResult.value : { _networkError: true };

    const result = await fetchCalendarData(runsFetch, routesFetch, dedupRoutesById);

    calRuns = result.runs;
    calRoutes = result.routes;

    return { runsError: result.runsError, routesError: result.routesError };
}

async function openCalendar() {
    const modal = document.getElementById('calendar-modal');
    const loading = document.getElementById('calendar-loading');
    const content = document.getElementById('calendar-content');
    const status = document.getElementById('calendar-status');
    const runsStatus = document.getElementById('cal-runs-status');

    if (!isTelegramApp()) {
        modal.classList.remove('hidden');
        loading.classList.add('hidden');
        content.classList.add('hidden');
        status.textContent = 'Календарь доступен только внутри Telegram';
        status.className = 'profile-status error';
        status.classList.remove('hidden');
        return;
    }

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    content.classList.add('hidden');
    status.classList.add('hidden');
    if (runsStatus) { runsStatus.classList.add('hidden'); safeSetText(runsStatus, ''); }
    const routesStatus = document.getElementById('cal-routes-status');
    if (routesStatus) { routesStatus.classList.add('hidden'); safeSetText(routesStatus, ''); }

    const result = await loadCalendarData();
    loading.classList.add('hidden');

    const errorMessages = {
        auth: 'Не удалось подтвердить авторизацию Telegram',
        not_found: 'Календарь ещё не доступен на сервере',
        server: 'Сервис календаря временно недоступен',
        network: 'Не удалось подключиться к серверу',
    };

    if (result.runsError && result.routesError) {
        // Both failed
        const msg = result.runsError === result.routesError
            ? errorMessages[result.runsError]
            : 'Не удалось загрузить данные';
        status.textContent = msg || 'Не удалось загрузить данные';
        status.className = 'profile-status error';
        status.classList.remove('hidden');
        return;
    }

    // At least one succeeded — show content
    content.classList.remove('hidden');
    renderCalendar();

    if (result.runsError) {
        safeSetText(runsStatus, errorMessages[result.runsError] || 'Ошибка загрузки пробежек');
        runsStatus.className = 'profile-status error';
        runsStatus.classList.remove('hidden');
    }

    if (result.routesError) {
        safeSetText(routesStatus, errorMessages[result.routesError] || 'Ошибка загрузки маршрутов');
        routesStatus.className = 'profile-status error';
        routesStatus.classList.remove('hidden');
    }
}

function renderCalendar() {
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    if (calSelectedDate && calSelectedDate > daysInMonth) calSelectedDate = null;

    document.getElementById('cal-month-label').textContent = new Date(calYear, calMonth).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
    const daysContainer = document.getElementById('cal-days');
    daysContainer.innerHTML = '';
    const runDayKeys = new Set(calRuns.filter(r => r.status !== 'cancelled').map(r => getRunDayKey(r.starts_at)));
    for (let d = 1; d <= daysInMonth; d++) {
        const el = document.createElement('div');
        const dayKey = `${calYear}-${calMonth}-${d}`;
        el.className = 'cal-day' + (runDayKeys.has(dayKey) ? ' has-run' : '') + (calSelectedDate === d ? ' selected' : '');
        el.textContent = d;
        el.addEventListener('click', () => { calSelectedDate = d; renderCalendar(); renderDayEvents(); });
        daysContainer.appendChild(el);
    }
    renderDayEvents();
}

function renderDayEvents() {
    const container = document.getElementById('cal-events');
    container.innerHTML = '';
    if (!calSelectedDate) { container.innerHTML = '<p class="cal-empty">Выберите день</p>'; return; }
    const dayRuns = calRuns.filter(r => isSameDay(r.starts_at, calYear, calMonth, calSelectedDate));
    if (dayRuns.length === 0) { container.innerHTML = '<p class="cal-empty">Нет пробежек</p>'; return; }
    dayRuns.forEach(run => {
        const div = document.createElement('div');
        div.className = 'cal-event' + (run.status === 'cancelled' ? ' cancelled' : '');
        const time = new Date(run.starts_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(run.starts_at).toLocaleDateString('ru');
        const route = calRoutes.find(r => r.id === run.saved_route_id);
        div.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'cal-event-title';
        title.textContent = run.title;
        div.appendChild(title);
        const timeEl = document.createElement('div');
        timeEl.className = 'cal-event-time';
        timeEl.textContent = date + ', ' + time + (run.duration_minutes ? ' · ' + run.duration_minutes + ' мин' : '');
        div.appendChild(timeEl);
        if (route) {
            const routeEl = document.createElement('div');
            routeEl.className = 'cal-event-route';
            routeEl.textContent = route.name + ' (' + (route.distance_m / 1000).toFixed(1) + ' км)';
            div.appendChild(routeEl);
        }
        if (run.status !== 'cancelled') {
            const actions = document.createElement('div');
            actions.className = 'cal-event-actions';
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Ред.';
            editBtn.addEventListener('click', () => editRun(run));
            actions.appendChild(editBtn);
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'cancel-btn';
            cancelBtn.textContent = 'Отменить';
            cancelBtn.addEventListener('click', () => cancelRun(run));
            actions.appendChild(cancelBtn);
            div.appendChild(actions);
        }
        const statusEl = document.createElement('div');
        statusEl.className = 'cal-event-time';
        statusEl.textContent = run.status === 'cancelled' ? 'Отменена' : '';
        div.appendChild(statusEl);
        container.appendChild(div);
    });
}

async function saveRun() {
    if (!isTelegramApp()) return;
    const saveBtn = document.getElementById('run-form-save');
    const status = document.getElementById('run-form-status');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохранение...';
    status.classList.add('hidden');
    const title = document.getElementById('run-title').value.trim();
    const dateVal = document.getElementById('run-date').value;
    if (!title || !dateVal) {
        status.textContent = 'Заполните название и дату';
        status.className = 'profile-status error';
        status.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = editingRunId ? 'Сохранить' : 'Создать';
        return;
    }
    const body = {
        title: title,
        starts_at: datetimeLocalToISO(dateVal),
        duration_minutes: parseInt(document.getElementById('run-duration').value) || null,
        notes: document.getElementById('run-notes').value.trim() || null,
        reminder_minutes: document.getElementById('run-reminder').value ? parseInt(document.getElementById('run-reminder').value) : null,
        notifications_enabled: document.getElementById('run-notifications').checked,
    };
    const routeId = document.getElementById('run-route-select').value;
    if (routeId) body.saved_route_id = routeId; else body.saved_route_id = null;
    const isEdit = !!editingRunId;
    const url = isEdit ? `/api/calendar/runs/${editingRunId}` : '/api/calendar/runs';
    const method = isEdit ? 'PUT' : 'POST';
    try {
        const resp = await fetch(apiUrl(url), {
            method, headers: getApiHeaders(), body: JSON.stringify(body),
        });
        if (resp.ok) {
            document.getElementById('run-form-modal').classList.add('hidden');
            showToast(isEdit ? 'Пробежка обновлена' : 'Пробежка создана');
            editingRunId = null;
            await loadCalendarData();
            renderCalendar();
        } else {
            const data = await resp.json().catch(() => ({}));
            status.textContent = data.detail || 'Ошибка';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
        }
    } catch (e) {
        status.textContent = 'Ошибка сети';
        status.className = 'profile-status error';
        status.classList.remove('hidden');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Сохранить' : 'Создать';
    }
}

function openRunForm(editRun) {
    editingRunId = editRun ? editRun.id : null;
    document.getElementById('run-title').value = editRun ? editRun.title : '';
    document.getElementById('run-date').value = editRun ? formatDatetimeLocal(new Date(editRun.starts_at)) : '';
    document.getElementById('run-duration').value = editRun && editRun.duration_minutes ? editRun.duration_minutes : '';
    document.getElementById('run-notes').value = editRun && editRun.notes ? editRun.notes : '';
    document.getElementById('run-reminder').value = editRun && editRun.reminder_minutes != null ? editRun.reminder_minutes : '';
    document.getElementById('run-notifications').checked = editRun ? editRun.notifications_enabled : true;
    const select = document.getElementById('run-route-select');
    select.innerHTML = '<option value="">Без маршрута</option>';
    calRoutes.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name + ' (' + (r.distance_m / 1000).toFixed(1) + ' км)';
        if (editRun && editRun.saved_route_id === r.id) opt.selected = true;
        select.appendChild(opt);
    });
    document.getElementById('run-form-status').classList.add('hidden');
    document.getElementById('run-form-save').textContent = editRun ? 'Сохранить' : 'Создать';
    document.getElementById('run-form-modal').classList.remove('hidden');
}

async function editRun(run) { openRunForm(run); }

async function cancelRun(run) {
    const result = await showConfirmModal('Отменить пробежку «' + run.title + '»?');
    if (result !== 'yes') return;
    try {
        const resp = await fetch(apiUrl(`/api/calendar/runs/${run.id}/cancel`), {
            method: 'POST', headers: getApiHeaders(),
        });
        if (resp.ok) {
            showToast('Пробежка отменена');
            await loadCalendarData();
            renderCalendar();
        }
    } catch (e) { /* silent */ }
}

// === Saved Routes Management ===

let calActiveTab = 'calendar';

function initCalendarTabs() {
    document.querySelectorAll('.cal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.calTab;
            if (target === calActiveTab) return;
            calActiveTab = target;
            document.querySelectorAll('.cal-tab').forEach(t => t.classList.toggle('active', t.dataset.calTab === target));
            document.getElementById('cal-panel-calendar').classList.toggle('hidden', target !== 'calendar');
            document.getElementById('cal-panel-routes').classList.toggle('hidden', target !== 'routes');
            if (target === 'routes') loadSavedRoutes();
        });
    });
}

async function loadSavedRoutes() {
    const loading = document.getElementById('cal-routes-loading');
    const list = document.getElementById('cal-routes-list');
    const empty = document.getElementById('cal-routes-empty');
    const status = document.getElementById('cal-routes-status');

    loading.classList.remove('hidden');
    list.innerHTML = '';
    empty.classList.add('hidden');
    status.classList.add('hidden');

    try {
        const resp = await fetch(apiUrl('/api/routes'), { headers: getApiHeaders() });
        if (!resp.ok) {
            throw new Error(resp.status >= 500 ? 'server' : 'unknown');
        }
        const data = await resp.json();
        calRoutes = dedupRoutesById(data.routes || []);
        loading.classList.add('hidden');
        renderSavedRoutes();
    } catch (e) {
        loading.classList.add('hidden');
        list.innerHTML = '';
        const messages = { server: 'Сервис временно недоступен', unknown: 'Не удалось загрузить маршруты' };
        status.textContent = messages[e.message] || 'Не удалось загрузить маршруты';
        status.className = 'profile-status error';
        status.classList.remove('hidden');
    }
}

function renderSavedRoutes() {
    const list = document.getElementById('cal-routes-list');
    const empty = document.getElementById('cal-routes-empty');
    list.innerHTML = '';

    if (calRoutes.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    calRoutes.forEach(route => {
        const card = document.createElement('div');
        card.className = 'cal-route-card';
        card.dataset.routeId = route.id;

        const name = document.createElement('div');
        name.className = 'cal-route-name';
        name.textContent = route.name;
        card.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'cal-route-meta';
        const modeSpan = document.createElement('span');
        modeSpan.textContent = formatRouteMode(route.route_mode);
        meta.appendChild(modeSpan);
        const distSpan = document.createElement('span');
        distSpan.textContent = formatDistanceM(route.distance_m);
        meta.appendChild(distSpan);
        const dateSpan = document.createElement('span');
        dateSpan.textContent = formatDate(route.created_at);
        meta.appendChild(dateSpan);
        if (route.points_count != null) {
            const ptsSpan = document.createElement('span');
            ptsSpan.textContent = route.points_count + ' точек';
            meta.appendChild(ptsSpan);
        }
        card.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'cal-route-actions';

        const openBtn = document.createElement('button');
        openBtn.textContent = 'Открыть';
        openBtn.className = 'route-action-primary';
        openBtn.addEventListener('click', () => openSavedRoute(route.id));
        actions.appendChild(openBtn);

        const planBtn = document.createElement('button');
        planBtn.textContent = 'Запланировать';
        planBtn.addEventListener('click', () => planRunWithRoute(route.id));
        actions.appendChild(planBtn);

        const renameBtn = document.createElement('button');
        renameBtn.textContent = 'Переименовать';
        renameBtn.addEventListener('click', () => renameSavedRoute(route.id, route.name));
        actions.appendChild(renameBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Удалить';
        deleteBtn.className = 'route-action-danger';
        deleteBtn.addEventListener('click', () => deleteSavedRoute(route.id, route.name));
        actions.appendChild(deleteBtn);

        card.appendChild(actions);
        list.appendChild(card);
    });
}

async function openSavedRoute(routeId) {
    if (!isTelegramApp()) return;

    const routeCard = document.querySelector('[data-route-id="' + routeId + '"]');
    const openBtn = routeCard ? routeCard.querySelector('.route-action-primary') : null;
    if (openBtn) { openBtn.disabled = true; openBtn.textContent = 'Загрузка…'; }

    let modalClosed = false;
    const modal = document.getElementById('calendar-modal');
    const prevCurrentRoute = currentRoute;

    try {
        const resp = await fetch(apiUrl(buildRouteDetailUrl(routeId)), { headers: getApiHeaders() });
        if (!resp.ok) throw new Error(classifyHttpError(resp.status));
        const route = await resp.json();
        const validated = validateSavedRouteForDisplay(route);
        const nextRoute = buildCurrentRouteFromApi(validated, makeGPX);

        modal.classList.add('hidden');
        modalClosed = true;

        await new Promise(r => { requestAnimationFrame(() => requestAnimationFrame(r)); });
        map.invalidateSize();

        currentRoute = nextRoute;
        displayRoute(currentRoute);
        showRouteButtons('saved');

        const mapElement = document.getElementById('map');
        if (mapElement) {
            mapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        showToast('Маршрут открыт');
    } catch (e) {
        if (modalClosed) {
            modal.classList.remove('hidden');
            currentRoute = prevCurrentRoute;
        }
        showToast(getOpenSavedRouteErrorMessage(e));
    } finally {
        if (openBtn) { openBtn.disabled = false; openBtn.textContent = 'Открыть'; }
    }
}

function renameSavedRoute(routeId, currentName) {
    const modal = document.getElementById('rename-route-modal');
    const input = document.getElementById('rename-route-name');
    const status = document.getElementById('rename-route-status');
    input.value = currentName;
    status.classList.add('hidden');
    modal.classList.remove('hidden');
    input.focus();

    const confirmBtn = document.getElementById('rename-route-confirm');
    const cancelBtn = document.getElementById('rename-route-cancel');

    function cleanup() {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onOverlay);
    }
    function onOverlay(e) { if (e.target === modal) cleanup(); }
    async function onConfirm() {
        const newName = input.value.trim();
        if (!newName || newName.length > 100) {
            status.textContent = 'Название 1–100 символов';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
            return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Сохранение...';
        try {
            const resp = await fetch(apiUrl(buildRouteUpdateUrl(routeId)), {
                method: 'PUT',
                headers: getApiHeaders(),
                body: JSON.stringify({ name: newName }),
            });
            if (resp.ok) {
                const updated = await resp.json();
                const idx = calRoutes.findIndex(r => r.id === routeId);
                if (idx >= 0) calRoutes[idx] = { ...calRoutes[idx], name: updated.name };
                renderSavedRoutes();
                cleanup();
                showToast('Маршрут переименован');
            } else {
                const data = await resp.json().catch(() => ({}));
                status.textContent = data.detail || 'Ошибка';
                status.className = 'profile-status error';
                status.classList.remove('hidden');
            }
        } catch (e) {
            status.textContent = 'Ошибка сети';
            status.className = 'profile-status error';
            status.classList.remove('hidden');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Сохранить';
        }
    }
    function onCancel() { cleanup(); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
}

async function deleteSavedRoute(routeId, routeName) {
    const result = await showConfirmModal(
        'Удалить маршрут \u00AB' + routeName + '\u00BB?\nЗапланированные пробежки сохранятся, но будут отвязаны от маршрута',
    );
    if (result !== 'yes') return;
    try {
        const resp = await fetch(apiUrl(buildRouteDeleteUrl(routeId)), {
            method: 'DELETE', headers: getApiHeaders(),
        });
        if (resp.ok) {
            calRoutes = calRoutes.filter(r => r.id !== routeId);
            renderSavedRoutes();
            showToast('Маршрут удалён');
        } else {
            showToast('Не удалось удалить маршрут');
        }
    } catch (e) {
        showToast('Ошибка сети');
    }
}

function planRunWithRoute(routeId) {
    calActiveTab = 'calendar';
    document.querySelectorAll('.cal-tab').forEach(t => t.classList.toggle('active', t.dataset.calTab === 'calendar'));
    document.getElementById('cal-panel-calendar').classList.remove('hidden');
    document.getElementById('cal-panel-routes').classList.add('hidden');
    openRunForm(null);
    const select = document.getElementById('run-route-select');
    for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === routeId) {
            select.selectedIndex = i;
            break;
        }
    }
}

// === Safe DOM helpers ===

function safeSetText(el, text) {
    el.textContent = text != null ? String(text) : '';
}

function safeCreateEl(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'textContent') el.textContent = v;
            else if (k === 'className') el.className = v;
            else el.setAttribute(k, v);
        }
    }
    return el;
}

function safeAvatar(url, size) {
    const wrap = safeCreateEl('div', { className: 'follow-list-avatar-placeholder' });
    safeSetText(wrap, '\u{1F3C3}');
    if (!url) return wrap;
    try {
        const parsed = new URL(url, location.href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return wrap;
    } catch {
        return wrap;
    }
    const img = safeCreateEl('img', {
        src: url,
        alt: '',
        width: String(size || 40),
        height: String(size || 40),
    });
    img.onerror = function () { img.replaceWith(wrap); };
    return img;
}

function safeSocialLink(label, url) {
    if (!url) return null;
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const a = safeCreateEl('a', {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        textContent: label,
    });
    return a;
}

// === Profile: is_public + counters ===

async function loadProfileData() {
    const loading = document.getElementById('profile-loading');
    const form = document.getElementById('profile-form');

    try {
        const resp = await fetch(apiUrl('/api/profile'), { headers: getApiHeaders() });
        if (!resp.ok) throw new Error('Failed to load profile');

        const data = await resp.json();
        const profile = data.profile || {};

        document.getElementById('profile-display-name').value = profile.display_name || '';
        document.getElementById('profile-bio').value = profile.bio || '';
        document.getElementById('profile-city').value = profile.city || '';
        document.getElementById('profile-club-name').value = profile.club_name || '';
        document.getElementById('profile-avatar-url').value = profile.avatar_url || '';

        const sl = profile.social_links || {};
        document.getElementById('profile-social-telegram').value = sl.telegram || '';
        document.getElementById('profile-social-instagram').value = sl.instagram || '';
        document.getElementById('profile-social-strava').value = sl.strava || '';
        document.getElementById('profile-social-vk').value = sl.vk || '';
        document.getElementById('profile-social-website').value = sl.website || '';

        document.getElementById('profile-is-public').checked = !!profile.is_public;

        const fc = document.getElementById('profile-followers-count');
        const fgc = document.getElementById('profile-following-count');
        if (fc) safeSetText(fc, profile.followers_count != null ? profile.followers_count : 0);
        if (fgc) safeSetText(fgc, profile.following_count != null ? profile.following_count : 0);

        loading.classList.add('hidden');
        form.classList.remove('hidden');
    } catch (e) {
        loading.classList.add('hidden');
        const status = document.getElementById('profile-status');
        safeSetText(status, 'Не удалось загрузить профиль');
        status.className = 'profile-status error';
        status.classList.remove('hidden');
        form.classList.remove('hidden');
    }
}

function initProfile() {
    const modal = document.getElementById('profile-modal');
    const saveBtn = document.getElementById('profile-save');
    const cancelBtn = document.getElementById('profile-cancel');
    const status = document.getElementById('profile-status');

    cancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
        }
    });

    const followersBtn = document.getElementById('profile-followers-btn');
    const followingBtn = document.getElementById('profile-following-btn');
    if (followersBtn) followersBtn.addEventListener('click', () => openFollowList('followers'));
    if (followingBtn) followingBtn.addEventListener('click', () => openFollowList('following'));

    saveBtn.addEventListener('click', async () => {
        if (!isTelegramApp()) return;

        saveBtn.disabled = true;
        safeSetText(saveBtn, 'Сохранение...');
        status.classList.add('hidden');

        const body = {
            display_name: document.getElementById('profile-display-name').value || null,
            bio: document.getElementById('profile-bio').value || null,
            city: document.getElementById('profile-city').value || null,
            club_name: document.getElementById('profile-club-name').value || null,
            avatar_url: document.getElementById('profile-avatar-url').value || null,
            social_links: {
                telegram: document.getElementById('profile-social-telegram').value || null,
                instagram: document.getElementById('profile-social-instagram').value || null,
                strava: document.getElementById('profile-social-strava').value || null,
                vk: document.getElementById('profile-social-vk').value || null,
                website: document.getElementById('profile-social-website').value || null,
            },
            is_public: document.getElementById('profile-is-public').checked,
        };

        try {
            const resp = await fetch(apiUrl('/api/profile'), {
                method: 'PUT',
                headers: getApiHeaders(),
                body: JSON.stringify(body)
            });

            if (resp.ok) {
                const result = await resp.json();
                const p = result.profile || {};
                document.getElementById('profile-is-public').checked = !!p.is_public;
                safeSetText(status, 'Профиль сохранён');
                status.className = 'profile-status success';
                status.classList.remove('hidden');
            } else {
                const data = await resp.json().catch(() => ({}));
                safeSetText(status, data.detail || 'Ошибка сохранения');
                status.className = 'profile-status error';
                status.classList.remove('hidden');
            }
        } catch (e) {
            safeSetText(status, 'Ошибка сети');
            status.className = 'profile-status error';
            status.classList.remove('hidden');
        } finally {
            saveBtn.disabled = false;
            safeSetText(saveBtn, 'Сохранить');
        }
    });
}

// === Public Profile Modal ===

async function openPublicProfile(userId) {
    const modal = document.getElementById('public-profile-modal');
    const loading = document.getElementById('public-profile-loading');
    const content = document.getElementById('public-profile-content');
    const status = document.getElementById('public-profile-status');

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    content.classList.add('hidden');
    status.classList.add('hidden');

    if (!isTelegramApp()) {
        loading.classList.add('hidden');
        safeSetText(status, 'Доступно только внутри Telegram');
        status.className = 'profile-status error';
        status.classList.remove('hidden');
        return;
    }

    try {
        const resp = await fetch(apiUrl('/api/users/' + userId + '/profile'), { headers: getApiHeaders() });
        if (!resp.ok) throw new Error(resp.status === 404 ? 'not_found' : 'error');

        const data = await resp.json();
        const profile = data.profile || {};

        const avatarWrap = document.getElementById('public-profile-avatar-wrap');
        avatarWrap.innerHTML = '';
        avatarWrap.appendChild(safeAvatar(profile.avatar_url, 72));

        safeSetText(document.getElementById('public-profile-display-name'), profile.display_name || 'Без имени');
        safeSetText(document.getElementById('public-profile-bio'), profile.bio || '');

        const meta = document.getElementById('public-profile-meta');
        meta.innerHTML = '';
        if (profile.city) {
            const citySpan = safeCreateEl('span', { className: 'meta-item', textContent: profile.city });
            meta.appendChild(citySpan);
        }
        if (profile.club_name) {
            const clubSpan = safeCreateEl('span', { className: 'meta-item', textContent: profile.club_name });
            meta.appendChild(clubSpan);
        }

        const socialEl = document.getElementById('public-profile-social');
        socialEl.innerHTML = '';
        const sl = profile.social_links || {};
        const socialMap = { telegram: 'Telegram', instagram: 'Instagram', strava: 'Strava', vk: 'VK', website: 'Website' };
        for (const [key, label] of Object.entries(socialMap)) {
            const link = safeSocialLink(label, sl[key]);
            if (link) socialEl.appendChild(link);
        }

        safeSetText(document.getElementById('public-followers-count'), data.followers_count != null ? data.followers_count : 0);
        safeSetText(document.getElementById('public-following-count'), data.following_count != null ? data.following_count : 0);

        updatePublicFollowUI(data.is_following, data.run_notifications_enabled, userId);

        loading.classList.add('hidden');
        content.classList.remove('hidden');

        RunRoutePublicProfileLobbies.load(userId);
    } catch (e) {
        loading.classList.add('hidden');
        safeSetText(status, e.message === 'not_found' ? 'Профиль не найден' : 'Ошибка загрузки');
        status.className = 'profile-status error';
        status.classList.remove('hidden');
        RunRoutePublicProfileLobbies.invalidate();
    }
}

function updatePublicFollowUI(isFollowing, runNotifs, userId) {
    const followBtn = document.getElementById('public-follow-btn');
    const notifArea = document.getElementById('public-notifications-area');
    const notifToggle = document.getElementById('public-notifications-toggle');
    const status = document.getElementById('public-profile-status');

    safeSetText(followBtn, isFollowing ? 'Отписаться' : 'Подписаться');
    followBtn.className = isFollowing ? 'modal-btn secondary' : 'modal-btn primary';

    followBtn.onclick = async () => {
        if (!isTelegramApp()) return;
        followBtn.disabled = true;
        status.classList.add('hidden');
        const prevFollowing = isFollowing;
        const prevNotifs = runNotifs;
        try {
            const method = isFollowing ? 'DELETE' : 'POST';
            const resp = await fetch(apiUrl('/api/users/' + userId + '/follow'), {
                method,
                headers: getApiHeaders(),
            });
            if (resp.ok) {
                const result = await resp.json();
                isFollowing = result.is_following != null ? result.is_following : !prevFollowing;
                runNotifs = result.run_notifications_enabled;
                updatePublicFollowUI(isFollowing, runNotifs, userId);
                safeSetText(document.getElementById('public-followers-count'),
                    result.followers_count != null ? result.followers_count : 0);
                status.classList.add('hidden');
            } else {
                let msg = 'Не удалось изменить подписку';
                try {
                    const data = await resp.json();
                    if (resp.status === 404) msg = 'Профиль больше недоступен';
                    else if (resp.status >= 500) msg = 'Сервис временно недоступен';
                    else if (data.detail) msg = data.detail;
                } catch {}
                safeSetText(status, msg);
                status.className = 'profile-status error';
                status.classList.remove('hidden');
            }
        } catch (e) {
            safeSetText(status, 'Не удалось подключиться к серверу');
            status.className = 'profile-status error';
            status.classList.remove('hidden');
        } finally {
            followBtn.disabled = false;
        }
    };

    if (isFollowing && runNotifs !== undefined && runNotifs !== null) {
        notifArea.classList.remove('hidden');
        notifToggle.checked = !!runNotifs;
        notifToggle.onchange = async () => {
            const prevChecked = notifToggle.checked;
            notifToggle.disabled = true;
            status.classList.add('hidden');
            try {
                const resp = await fetch(apiUrl('/api/users/' + userId + '/follow/notifications'), {
                    method: 'PUT',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ enabled: notifToggle.checked }),
                });
                if (resp.ok) {
                    const result = await resp.json();
                    notifToggle.checked = result.run_notifications_enabled != null
                        ? result.run_notifications_enabled
                        : prevChecked;
                    runNotifs = notifToggle.checked;
                    status.classList.add('hidden');
                } else {
                    notifToggle.checked = !prevChecked;
                    let msg = 'Не удалось изменить настройку';
                    try {
                        const data = await resp.json();
                        if (data.detail) msg = data.detail;
                    } catch {}
                    safeSetText(status, msg);
                    status.className = 'profile-status error';
                    status.classList.remove('hidden');
                }
            } catch (e) {
                notifToggle.checked = !prevChecked;
                safeSetText(status, 'Не удалось подключиться к серверу');
                status.className = 'profile-status error';
                status.classList.remove('hidden');
            } finally {
                notifToggle.disabled = false;
            }
        };
    } else {
        notifArea.classList.add('hidden');
    }
}

function initPublicProfile() {
    const modal = document.getElementById('public-profile-modal');
    const closeBtn = document.getElementById('public-profile-close');

    closeBtn.addEventListener('click', () => { modal.classList.add('hidden'); RunRoutePublicProfileLobbies.invalidate(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.add('hidden'); RunRoutePublicProfileLobbies.invalidate(); } });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); RunRoutePublicProfileLobbies.invalidate(); }
    });
}

// === Follow List Modal ===

let followListMode = null;
let followListCursor = null;
let followListSeenIds = new Set();

async function openFollowList(mode) {
    followListMode = mode;
    followListCursor = null;
    followListSeenIds = new Set();

    const modal = document.getElementById('follow-list-modal');
    const loading = document.getElementById('follow-list-loading');
    const content = document.getElementById('follow-list-content');
    const items = document.getElementById('follow-list-items');
    const empty = document.getElementById('follow-list-empty');
    const status = document.getElementById('follow-list-status');
    const loadMore = document.getElementById('follow-list-load-more');

    safeSetText(document.getElementById('follow-list-title'),
        mode === 'followers' ? 'Подписчики' : 'Подписки');

    items.innerHTML = '';
    empty.classList.add('hidden');
    status.classList.add('hidden');
    loadMore.classList.add('hidden');

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    content.classList.add('hidden');

    await loadFollowPage();
}

async function loadFollowPage() {
    const loading = document.getElementById('follow-list-loading');
    const content = document.getElementById('follow-list-content');
    const items = document.getElementById('follow-list-items');
    const empty = document.getElementById('follow-list-empty');
    const status = document.getElementById('follow-list-status');
    const loadMore = document.getElementById('follow-list-load-more');

    const endpoint = followListMode === 'followers' ? '/api/me/followers' : '/api/me/following';
    let url = apiUrl(endpoint + '?limit=20');
    if (followListCursor) url += '&cursor=' + encodeURIComponent(followListCursor);

    try {
        const resp = await fetch(url, { headers: getApiHeaders() });
        if (!resp.ok) throw new Error(resp.status >= 500 ? 'server' : 'error');

        const data = await resp.json();
        const users = data.users || [];

        loading.classList.add('hidden');
        content.classList.remove('hidden');

        if (users.length === 0 && followListSeenIds.size === 0) {
            empty.classList.remove('hidden');
            return;
        }

        for (const user of users) {
            if (followListSeenIds.has(user.user_id)) continue;
            followListSeenIds.add(user.user_id);
            items.appendChild(buildFollowCard(user));
        }

        followListCursor = data.next_cursor;
        loadMore.classList.toggle('hidden', !followListCursor);
    } catch (e) {
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        const messages = { server: 'Сервис временно недоступен' };
        safeSetText(status, messages[e.message] || 'Не удалось загрузить список');
        status.className = 'profile-status error';
        status.classList.remove('hidden');
    }
}

function buildFollowCard(user) {
    const card = safeCreateEl('div', { className: 'follow-list-item' });
    card.appendChild(safeAvatar(user.avatar_url, 40));

    const info = safeCreateEl('div', { className: 'follow-list-info' });
    info.appendChild(safeCreateEl('div', { className: 'follow-list-name', textContent: user.display_name || 'Без имени' }));
    const details = [user.city, user.club_name].filter(Boolean).join(' · ');
    if (details) info.appendChild(safeCreateEl('div', { className: 'follow-list-detail', textContent: details }));
    card.appendChild(info);

    if (followListMode === 'following' && user.run_notifications_enabled) {
        card.appendChild(safeCreateEl('div', { className: 'follow-list-notif', textContent: 'Уведомления' }));
    }

    card.addEventListener('click', () => {
        document.getElementById('follow-list-modal').classList.add('hidden');
        openPublicProfile(user.user_id);
    });

    return card;
}

function initFollowList() {
    const modal = document.getElementById('follow-list-modal');
    const closeBtn = document.getElementById('follow-list-close');
    const loadMoreBtn = document.getElementById('follow-list-load-more-btn');

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) modal.classList.add('hidden');
    });
    loadMoreBtn.addEventListener('click', loadFollowPage);
}

// === Lobby (delegated to lobby-controller.js) ===

function initLobby() {
    var L = RunRouteLobby;
    document.getElementById('menu-lobby').addEventListener('click', function () {
        document.getElementById('user-menu').classList.add('hidden');
        L.openLobbyPanel();
    });
    document.getElementById('lobby-close-btn').addEventListener('click', function () { L.closeLobbyPanel(); });
    document.getElementById('lobby-create-btn').addEventListener('click', function () { L.openLobbyCreateForm(); });
    document.getElementById('lobby-back-btn').addEventListener('click', function () { L.showLobbyList(); });
    document.getElementById('lobby-create-back-btn').addEventListener('click', function () { L.showLobbyList(); });
    document.getElementById('lobby-create-cancel').addEventListener('click', function () { L.showLobbyList(); });
    document.getElementById('lobby-filter-apply').addEventListener('click', function () { L.applyLobbyFilters(); });
    document.getElementById('lobby-filter-reset').addEventListener('click', function () { L.resetLobbyFilters(); });
    document.getElementById('lobby-list-load-more-btn').addEventListener('click', function () { L.loadMoreLobbies(); });
    document.getElementById('lobby-create-submit').addEventListener('click', function () { L.submitLobbyCreate(); });
    document.getElementById('lobby-use-gps-btn').addEventListener('click', function () { L.useGpsForLobby(); });
    document.getElementById('lobby-list-items').addEventListener('click', function (e) {
        var card = e.target.closest('.lobby-card');
        if (card) L.openLobbyDetail(card.dataset.lobbyId);
    });
    document.getElementById('lobby-form-route').addEventListener('change', function () { L.onLobbyRouteSelect(); });
    document.getElementById('lobby-form-route-add-btn').addEventListener('click', function () { L.useRouteStartForLobby(); });
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
    initFeedback();
    initMenu();
    initProfile();
    initSaveRoute();
    initCalendar();
    initInsertMode();
    initGPS();
    initPublicProfile();
    initFollowList();
    initLobby();
    loadCurrentUser();
    document.getElementById('track-start-btn').addEventListener('click', startTracking);
    document.getElementById('track-stop-btn').addEventListener('click', stopTracking);
    updateUIForMode();
});
