// Lobby controller — extracted for testability.
// Dependencies: document, window.Telegram, navigator, fetch, apiUrl,
// getApiHeaders, safeCreateEl, safeAvatar, RunRouteLobbyUtils,
// lastKnownLocation, openProfileModal, showToast, loadCurrentUser.

(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.RunRouteLobby = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {

    // --- State ---
    let lobbyNextCursor = null;
    let lobbyCurrentFilters = {};
    let lobbyMeetingPoint = null;
    let lobbyPointSource = null;
    let lobbyShownIds = new Set();
    let lobbyRequestToken = 0;
    let lobbyDetailRequestToken = 0;
    let lobbyLoadMoreBusy = false;
    let lobbyBusyActions = new Set();
    let _lobbyLocationManagerBusy = false;

    function lobbyIsBusy(action) { return lobbyBusyActions.has(action); }
    function lobbySetBusy(action) { lobbyBusyActions.add(action); }
    function lobbyClearBusy(action) { lobbyBusyActions.delete(action); }

    // --- View helpers ---
    function _el(id) { return document.getElementById(id); }

    function showLobbyList() {
        _el('lobby-list-view').classList.remove('hidden');
        _el('lobby-detail-view').classList.add('hidden');
        _el('lobby-create-view').classList.add('hidden');
    }
    function showLobbyDetail() {
        _el('lobby-list-view').classList.add('hidden');
        _el('lobby-detail-view').classList.remove('hidden');
        _el('lobby-create-view').classList.add('hidden');
    }
    function showLobbyCreate() {
        _el('lobby-list-view').classList.add('hidden');
        _el('lobby-detail-view').classList.add('hidden');
        _el('lobby-create-view').classList.remove('hidden');
    }

    function lobbyShowStatus(text, isError) {
        const el = _el('lobby-list-status');
        el.textContent = text;
        el.className = isError ? 'profile-status error' : 'profile-status';
        el.classList.remove('hidden');
    }

    function lobbyShowDetailStatus(text, isError) {
        const el = _el('lobby-detail-status');
        el.textContent = text;
        el.className = isError ? 'profile-status error' : 'profile-status';
        el.classList.remove('hidden');
    }

    function lobbyShowDetailStatusHtml(html, isError) {
        const el = _el('lobby-detail-status');
        el.innerHTML = '';
        const parts = html.split('__PROFILE_LINK__');
        el.appendChild(document.createTextNode(parts[0]));
        if (parts.length > 1) {
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = 'Открыть профиль';
            link.style.color = 'var(--accent)';
            link.addEventListener('click', function (e) { e.preventDefault(); openProfileModal(); });
            el.appendChild(link);
            el.appendChild(document.createTextNode(parts[1]));
        }
        el.className = isError ? 'profile-status error' : 'profile-status';
        el.classList.remove('hidden');
    }

    function lobbyShowCreateStatus(text) {
        const el = _el('lobby-create-status');
        el.textContent = text;
        el.className = 'profile-status error';
        el.classList.remove('hidden');
    }

    // --- Detail rendering ---
    function buildLobbyDetailDom(container, lobby, participants) {
        var L = RunRouteLobbyUtils;

        var nameEl = safeCreateEl('div', { className: 'lobby-detail-name', textContent: lobby.title || '' });
        container.appendChild(nameEl);
        var typeEl = safeCreateEl('div', { className: 'lobby-detail-type', textContent: L.formatRunType(lobby.run_type) });
        container.appendChild(typeEl);

        function addSection(label, valueText) {
            var section = safeCreateEl('div', { className: 'lobby-detail-section' });
            section.appendChild(safeCreateEl('div', { className: 'lobby-detail-label', textContent: label }));
            section.appendChild(safeCreateEl('div', { className: 'lobby-detail-value', textContent: valueText }));
            container.appendChild(section);
        }

        addSection('\u0414\u0430\u0442\u0430 \u0438 \u0432\u0440\u0435\u043c\u044f', L.formatLobbyDate(lobby.starts_at));
        var placeText = lobby.area_label ? (lobby.city || '') + ', ' + lobby.area_label : (lobby.city || '');
        addSection('\u041c\u0435\u0441\u0442\u043e', placeText);
        if (lobby.distance_m != null) addSection('\u0414\u0438\u0441\u0442\u0430\u043d\u0446\u0438\u044f', L.formatDistanceM(lobby.distance_m));

        if (lobby.pace_min_sec_per_km != null || lobby.pace_max_sec_per_km != null) {
            var section = safeCreateEl('div', { className: 'lobby-detail-section' });
            section.appendChild(safeCreateEl('div', { className: 'lobby-detail-label', textContent: '\u0422\u0435\u043c\u043f' }));
            var valEl = safeCreateEl('div', { className: 'lobby-detail-value' });
            if (lobby.pace_min_sec_per_km != null && lobby.pace_max_sec_per_km != null) {
                valEl.textContent = L.formatPace(lobby.pace_min_sec_per_km) + ' \u2014 ' + L.formatPace(lobby.pace_max_sec_per_km);
            } else if (lobby.pace_min_sec_per_km != null) {
                valEl.textContent = '\u043e\u0442 ' + L.formatPace(lobby.pace_min_sec_per_km);
            } else {
                valEl.textContent = '\u0434\u043e ' + L.formatPace(lobby.pace_max_sec_per_km);
            }
            section.appendChild(valEl);
            container.appendChild(section);
        }

        if (lobby.duration_minutes != null) addSection('\u0414\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c', lobby.duration_minutes + ' \u043c\u0438\u043d');
        addSection('\u0423\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438', L.formatParticipants(lobby.participant_count, lobby.capacity));

        if (lobby.description) {
            var dsection = safeCreateEl('div', { className: 'lobby-detail-section' });
            dsection.appendChild(safeCreateEl('div', { className: 'lobby-detail-label', textContent: '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435' }));
            var descEl = safeCreateEl('div', { className: 'lobby-detail-desc' });
            descEl.textContent = lobby.description;
            dsection.appendChild(descEl);
            container.appendChild(dsection);
        }

        if (lobby.organizer) {
            var org = lobby.organizer;
            var osection = safeCreateEl('div', { className: 'lobby-detail-section' });
            osection.appendChild(safeCreateEl('div', { className: 'lobby-detail-label', textContent: '\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0442\u043e\u0440' }));
            var orgDiv = safeCreateEl('div', { className: 'lobby-detail-org' });
            var av = safeAvatar(org.avatar_url, 36);
            av.className = 'lobby-detail-org-avatar';
            orgDiv.appendChild(av);
            var orgInfo = safeCreateEl('div');
            orgInfo.appendChild(safeCreateEl('div', { className: 'lobby-detail-org-name', textContent: org.display_name || '\u0411\u0435\u0437 \u0438\u043c\u0435\u043d\u0438' }));
            if (org.city) {
                var metaText = org.club_name ? org.city + ' \u00B7 ' + org.club_name : org.city;
                orgInfo.appendChild(safeCreateEl('div', { className: 'lobby-detail-org-meta', textContent: metaText }));
            }
            orgDiv.appendChild(orgInfo);
            osection.appendChild(orgDiv);
            container.appendChild(osection);
        }

        var actionsDiv = safeCreateEl('div', { className: 'lobby-actions' });
        if (lobby.can_join) {
            actionsDiv.appendChild(safeCreateEl('button', { id: 'lobby-join-btn', className: 'modal-btn primary', textContent: '\u041f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d\u0438\u0442\u044c\u0441\u044f' }));
        }
        if (lobby.can_leave) {
            actionsDiv.appendChild(safeCreateEl('button', { id: 'lobby-leave-btn', className: 'modal-btn secondary', textContent: '\u0412\u044b\u0439\u0442\u0438 \u0438\u0437 \u043f\u0440\u043e\u0431\u0435\u0436\u043a\u0438' }));
        }
        if (lobby.viewer_role === 'organizer') {
            actionsDiv.appendChild(safeCreateEl('button', { id: 'lobby-cancel-btn', className: 'modal-btn btn-cancel-lobby', textContent: '\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0440\u043e\u0431\u0435\u0436\u043a\u0443' }));
        }
        if (actionsDiv.children.length > 0) container.appendChild(actionsDiv);

        if (participants.length > 0) {
            container.appendChild(safeCreateEl('div', { className: 'lobby-participants-title', textContent: '\u0423\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438 (' + participants.length + ')' }));
            participants.forEach(function (p) {
                var row = safeCreateEl('div', { className: 'lobby-participant' });
                var pav = safeAvatar(p.avatar_url, 28);
                pav.className = 'lobby-participant-avatar';
                row.appendChild(pav);
                row.appendChild(safeCreateEl('span', { className: 'lobby-participant-name', textContent: p.display_name || '\u0411\u0435\u0437 \u0438\u043c\u0435\u043d\u0438' }));
                if (p.role === 'organizer') {
                    row.appendChild(safeCreateEl('span', { className: 'lobby-participant-role', textContent: '\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0442\u043e\u0440' }));
                }
                container.appendChild(row);
            });
        }
    }

    function _refreshDetailButtons(contentEl, lobbyId) {
        var joinBtn = contentEl.querySelector('#lobby-join-btn');
        var leaveBtn = contentEl.querySelector('#lobby-leave-btn');
        var cancelBtn = contentEl.querySelector('#lobby-cancel-btn');
        if (joinBtn) joinBtn.addEventListener('click', function () { joinLobby(lobbyId); });
        if (leaveBtn) leaveBtn.addEventListener('click', function () { leaveLobbyAction(lobbyId); });
        if (cancelBtn) cancelBtn.addEventListener('click', function () { cancelLobbyAction(lobbyId); });
    }

    // --- Public profile error ---
    function lobbyHandlePrivateProfile(status, detail) {
        if (!RunRouteLobbyUtils.isPrivateProfileError(status, detail)) return false;
        var text = RunRouteLobbyUtils.getLobbyErrorText(status, detail);
        lobbyShowDetailStatusHtml(text + ' __PROFILE_LINK__', true);
        return true;
    }

    // --- openLobbyDetail ---
    async function openLobbyDetail(lobbyId) {
        showLobbyDetail();
        var contentEl = _el('lobby-detail-content');
        var loadingEl = _el('lobby-detail-loading');
        var statusEl = _el('lobby-detail-status');

        loadingEl.classList.remove('hidden');
        contentEl.innerHTML = '';
        contentEl.classList.add('hidden');
        statusEl.classList.add('hidden');

        var token = ++lobbyDetailRequestToken;

        try {
            var results = await Promise.all([
                fetch(apiUrl('/api/lobbies/' + lobbyId), { headers: getApiHeaders() }),
                fetch(apiUrl('/api/lobbies/' + lobbyId + '/participants'), { headers: getApiHeaders() })
            ]);
            var lobbyResp = results[0], participantsResp = results[1];
            if (token !== lobbyDetailRequestToken) return;
            loadingEl.classList.add('hidden');
            if (!lobbyResp.ok) {
                lobbyShowDetailStatus(RunRouteLobbyUtils.getLobbyErrorText(lobbyResp.status), true);
                return;
            }
            var lobby = await lobbyResp.json();
            var participants = [];
            if (participantsResp.ok) {
                var pData = await participantsResp.json();
                participants = pData.participants || [];
            }
            if (token !== lobbyDetailRequestToken) return;
            contentEl.innerHTML = '';
            buildLobbyDetailDom(contentEl, lobby, participants);
            contentEl.classList.remove('hidden');
            _refreshDetailButtons(contentEl, lobbyId);
        } catch (e) {
            if (token !== lobbyDetailRequestToken) return;
            loadingEl.classList.add('hidden');
            lobbyShowDetailStatus('\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d', true);
        }
    }

    // --- refreshLobbyListItem ---
    async function refreshLobbyListItem(lobbyId, lobby) {
        if (!lobby) {
            try {
                var resp = await fetch(apiUrl('/api/lobbies/' + lobbyId), { headers: getApiHeaders() });
                if (!resp.ok) return;
                lobby = await resp.json();
            } catch (e) { return; }
        }
        var existing = document.querySelector('.lobby-card[data-lobby-id="' + lobbyId + '"]');
        if (!existing) return;
        var newCard = RunRouteLobbyUtils.renderLobbyCard(lobby, safeCreateEl, safeAvatar);
        existing.replaceWith(newCard);
    }

    // --- joinLobby ---
    async function joinLobby(lobbyId) {
        var busyKey = 'join:' + lobbyId;
        if (lobbyIsBusy(busyKey)) return;
        lobbySetBusy(busyKey);
        var statusEl = _el('lobby-detail-status');
        statusEl.classList.add('hidden');
        var myToken = lobbyDetailRequestToken;
        try {
            var resp = await fetch(apiUrl('/api/lobbies/' + lobbyId + '/join'), {
                method: 'POST', headers: getApiHeaders()
            });
            if (myToken !== lobbyDetailRequestToken) return;
            if (!resp.ok) {
                var body = await resp.json().catch(function () { return {}; });
                if (lobbyHandlePrivateProfile(resp.status, body.detail)) return;
                lobbyShowDetailStatus(RunRouteLobbyUtils.getLobbyErrorText(resp.status, body.detail), true);
                return;
            }
            if (myToken !== lobbyDetailRequestToken) return;
            var lobbyResp = await fetch(apiUrl('/api/lobbies/' + lobbyId), { headers: getApiHeaders() });
            if (myToken !== lobbyDetailRequestToken) return;
            if (!lobbyResp.ok) return;
            var lobby = await lobbyResp.json();
            if (myToken !== lobbyDetailRequestToken) return;
            var participantsResp = await fetch(apiUrl('/api/lobbies/' + lobbyId + '/participants'), { headers: getApiHeaders() });
            if (myToken !== lobbyDetailRequestToken) return;
            var participants = [];
            if (participantsResp.ok) {
                var pData = await participantsResp.json();
                if (myToken !== lobbyDetailRequestToken) return;
                participants = pData.participants || [];
            }
            var contentEl = _el('lobby-detail-content');
            contentEl.innerHTML = '';
            buildLobbyDetailDom(contentEl, lobby, participants);
            contentEl.classList.remove('hidden');
            _refreshDetailButtons(contentEl, lobbyId);
            await refreshLobbyListItem(lobbyId, lobby);
        } catch (e) {
            if (myToken !== lobbyDetailRequestToken) return;
            lobbyShowDetailStatus('\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d', true);
        } finally {
            lobbyClearBusy(busyKey);
        }
    }

    // --- leaveLobbyAction ---
    async function leaveLobbyAction(lobbyId) {
        var busyKey = 'leave:' + lobbyId;
        if (lobbyIsBusy(busyKey)) return;
        lobbySetBusy(busyKey);
        var statusEl = _el('lobby-detail-status');
        statusEl.classList.add('hidden');
        var confirmEl = _el('confirm-modal');
        var textEl = _el('confirm-text');
        var yesBtn = _el('confirm-yes');
        var noBtn = _el('confirm-no');

        textEl.textContent = '\u0412\u044b\u0439\u0442\u0438 \u0438\u0437 \u043f\u0440\u043e\u0431\u0435\u0436\u043a\u0438?';
        confirmEl.classList.remove('hidden');

        var myToken = lobbyDetailRequestToken;

        var cleanup = function () {
            confirmEl.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            confirmEl.removeEventListener('click', onOverlay);
            lobbyClearBusy(busyKey);
        };
        var onNo = function () { cleanup(); };
        var onOverlay = function (e) { if (e.target === confirmEl) cleanup(); };
        var onYes = async function () {
            cleanup();
            lobbySetBusy(busyKey);
            try {
                var resp = await fetch(apiUrl('/api/lobbies/' + lobbyId + '/leave'), {
                    method: 'POST', headers: getApiHeaders()
                });
                if (myToken !== lobbyDetailRequestToken) return;
                if (!resp.ok) {
                    var body = await resp.json().catch(function () { return {}; });
                    lobbyShowDetailStatus(RunRouteLobbyUtils.getLobbyErrorText(resp.status, body.detail), true);
                    return;
                }
                if (myToken !== lobbyDetailRequestToken) return;
                var lobbyResp = await fetch(apiUrl('/api/lobbies/' + lobbyId), { headers: getApiHeaders() });
                if (myToken !== lobbyDetailRequestToken) return;
                if (!lobbyResp.ok) return;
                var lobby = await lobbyResp.json();
                if (myToken !== lobbyDetailRequestToken) return;
                var participantsResp = await fetch(apiUrl('/api/lobbies/' + lobbyId + '/participants'), { headers: getApiHeaders() });
                if (myToken !== lobbyDetailRequestToken) return;
                var participants = [];
                if (participantsResp.ok) {
                    var pData = await participantsResp.json();
                    if (myToken !== lobbyDetailRequestToken) return;
                    participants = pData.participants || [];
                }
                var contentEl = _el('lobby-detail-content');
                contentEl.innerHTML = '';
                buildLobbyDetailDom(contentEl, lobby, participants);
                contentEl.classList.remove('hidden');
                _refreshDetailButtons(contentEl, lobbyId);
                await refreshLobbyListItem(lobbyId, lobby);
            } catch (e) {
                if (myToken !== lobbyDetailRequestToken) return;
                lobbyShowDetailStatus('\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d', true);
            } finally {
                lobbyClearBusy(busyKey);
            }
        };

        yesBtn.addEventListener('click', onYes);
        noBtn.addEventListener('click', onNo);
        confirmEl.addEventListener('click', onOverlay);
    }

    // --- cancelLobbyAction ---
    async function cancelLobbyAction(lobbyId) {
        var busyKey = 'cancel:' + lobbyId;
        if (lobbyIsBusy(busyKey)) return;
        lobbySetBusy(busyKey);
        var statusEl = _el('lobby-detail-status');
        statusEl.classList.add('hidden');
        var confirmEl = _el('confirm-modal');
        var textEl = _el('confirm-text');
        var yesBtn = _el('confirm-yes');
        var noBtn = _el('confirm-no');

        textEl.textContent = '\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0440\u043e\u0431\u0435\u0436\u043a\u0443? \u042d\u0442\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043d\u0435\u043e\u0431\u0440\u0430\u0442\u0438\u043c\u043e.';
        confirmEl.classList.remove('hidden');

        var myToken = lobbyDetailRequestToken;

        var cleanup = function () {
            confirmEl.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            confirmEl.removeEventListener('click', onOverlay);
            lobbyClearBusy(busyKey);
        };
        var onNo = function () { cleanup(); };
        var onOverlay = function (e) { if (e.target === confirmEl) cleanup(); };
        var onYes = async function () {
            cleanup();
            lobbySetBusy(busyKey);
            try {
                var resp = await fetch(apiUrl('/api/lobbies/' + lobbyId + '/cancel'), {
                    method: 'POST', headers: getApiHeaders()
                });
                if (myToken !== lobbyDetailRequestToken) return;
                if (!resp.ok) {
                    var body = await resp.json().catch(function () { return {}; });
                    lobbyShowDetailStatus(RunRouteLobbyUtils.getLobbyErrorText(resp.status, body.detail), true);
                    return;
                }
                showLobbyList();
                await loadLobbyList();
            } catch (e) {
                if (myToken !== lobbyDetailRequestToken) return;
                lobbyShowDetailStatus('\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d', true);
            } finally {
                lobbyClearBusy(busyKey);
            }
        };

        yesBtn.addEventListener('click', onYes);
        noBtn.addEventListener('click', onNo);
        confirmEl.addEventListener('click', onOverlay);
    }

    // --- submitLobbyCreate ---
    async function submitLobbyCreate() {
        if (lobbyIsBusy('create')) return;
        var statusEl = _el('lobby-create-status');
        statusEl.classList.add('hidden');

        var title = _el('lobby-form-title').value.trim();
        var runType = _el('lobby-form-type').value;
        var dateVal = _el('lobby-form-date').value;
        var city = _el('lobby-form-city').value.trim();
        var areaLabel = _el('lobby-form-area').value.trim();
        var routeId = _el('lobby-form-route').value;
        var distanceM = _el('lobby-form-distance').value;
        var paceMinStr = _el('lobby-form-pace-min').value.trim();
        var paceMaxStr = _el('lobby-form-pace-max').value.trim();
        var duration = _el('lobby-form-duration').value;
        var capacity = _el('lobby-form-capacity').value;
        var description = _el('lobby-form-desc').value.trim();

        if (!title) { lobbyShowCreateStatus('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043f\u0440\u043e\u0431\u0435\u0436\u043a\u0438'); return; }
        if (!dateVal) { lobbyShowCreateStatus('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0430\u0442\u0443 \u0438 \u0432\u0440\u0435\u043c\u044f'); return; }
        if (!city) { lobbyShowCreateStatus('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0433\u043e\u0440\u043e\u0434'); return; }
        if (!RunRouteLobbyUtils.validateFutureDate(dateVal)) { lobbyShowCreateStatus('\u0414\u0430\u0442\u0430 \u0438 \u0432\u0440\u0435\u043c\u044f \u0434\u043e\u043b\u0436\u043d\u044b \u0431\u044b\u0442\u044c \u0432 \u0431\u0443\u0434\u0443\u0449\u0435\u043c'); return; }
        if (lobbyMeetingPoint == null) { lobbyShowCreateStatus('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043e\u0447\u043a\u0443 \u0432\u0441\u0442\u0440\u0435\u0447\u0438: \u0433\u0435\u043e\u043f\u043e\u0437\u0438\u0446\u0438\u044e \u0438\u043b\u0438 \u043c\u0430\u0440\u0448\u0440\u0443\u0442'); return; }

        if (capacity && !RunRouteLobbyUtils.validateCapacity(capacity)) {
            lobbyShowCreateStatus('\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u043e\u0432: \u0446\u0435\u043b\u043e\u0435 \u0447\u0438\u0441\u043b\u043e \u043e\u0442 2 \u0434\u043e 100');
            return;
        }
        if (distanceM && !RunRouteLobbyUtils.validateDistanceM(distanceM)) {
            lobbyShowCreateStatus('\u0414\u0438\u0441\u0442\u0430\u043d\u0446\u0438\u044f \u0434\u043e\u043b\u0436\u043d\u0430 \u0431\u044b\u0442\u044c \u043f\u043e\u043b\u043e\u0436\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u043c \u0446\u0435\u043b\u044b\u043c \u0447\u0438\u0441\u043b\u043e\u043c');
            return;
        }
        if (duration && !RunRouteLobbyUtils.validateDuration(duration)) {
            lobbyShowCreateStatus('\u0414\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c: \u0446\u0435\u043b\u043e\u0435 \u0447\u0438\u0441\u043b\u043e \u043e\u0442 1 \u0434\u043e 1440 \u043c\u0438\u043d\u0443\u0442');
            return;
        }

        var paceMinResult = RunRouteLobbyUtils.validatePaceInput(paceMinStr);
        if (!paceMinResult.valid) { lobbyShowCreateStatus(paceMinResult.error); return; }
        var paceMaxResult = RunRouteLobbyUtils.validatePaceInput(paceMaxStr);
        if (!paceMaxResult.valid) { lobbyShowCreateStatus(paceMaxResult.error); return; }

        if (paceMinResult.value != null && paceMaxResult.value != null && paceMinResult.value > paceMaxResult.value) {
            lobbyShowCreateStatus('\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u044b\u0439 \u0442\u0435\u043c\u043f \u043d\u0435 \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435 \u043c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u044c\u043d\u043e\u0433\u043e');
            return;
        }

        var distVal = RunRouteLobbyUtils.parseStrictInteger(distanceM);
        var durVal = RunRouteLobbyUtils.parseStrictInteger(duration);
        var capVal = RunRouteLobbyUtils.parseStrictInteger(capacity);

        var payload = RunRouteLobbyUtils.buildLobbyCreatePayload({
            title: title, runType: runType,
            startsAt: new Date(dateVal).toISOString(),
            city: city, meetingLat: lobbyMeetingPoint.lat, meetingLng: lobbyMeetingPoint.lng,
            areaLabel: areaLabel || undefined,
            savedRouteId: routeId || undefined,
            distanceM: distVal,
            paceMin: paceMinResult.value,
            paceMax: paceMaxResult.value,
            durationMinutes: durVal,
            capacity: capVal,
            description: description || undefined,
        });

        lobbySetBusy('create');
        var submitBtn = _el('lobby-create-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435...';

        try {
            var resp = await fetch(apiUrl('/api/lobbies'), {
                method: 'POST', headers: getApiHeaders(),
                body: JSON.stringify(payload)
            });
            if (!resp.ok) {
                var body = await resp.json().catch(function () { return {}; });
                if (RunRouteLobbyUtils.isPrivateProfileError(resp.status, body.detail)) {
                    var text = RunRouteLobbyUtils.getLobbyErrorText(resp.status, body.detail);
                    lobbyShowCreateStatus(text + ' \u2014 ');
                    var statusEl2 = _el('lobby-create-status');
                    var link = document.createElement('a');
                    link.href = '#';
                    link.textContent = '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c';
                    link.style.color = 'var(--accent)';
                    link.addEventListener('click', function (e) { e.preventDefault(); openProfileModal(); });
                    statusEl2.appendChild(link);
                    return;
                }
                lobbyShowCreateStatus(RunRouteLobbyUtils.getLobbyErrorText(resp.status, body.detail));
                return;
            }
            var lobby = await resp.json();
            resetLobbyCreateForm();
            showLobbyList();
            await loadLobbyList();
            await openLobbyDetail(lobby.id);
        } catch (e) {
            lobbyShowCreateStatus('\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d');
        } finally {
            lobbyClearBusy('create');
            submitBtn.disabled = false;
            submitBtn.textContent = '\u0421\u043e\u0437\u0434\u0430\u0442\u044c';
        }
    }

    // --- Filters & list ---
    function applyLobbyFilters() {
        lobbyCurrentFilters = {};
        var city = _el('lobby-filter-city').value.trim();
        var type = _el('lobby-filter-type').value;
        var period = _el('lobby-filter-period').value;
        if (city) lobbyCurrentFilters.city = city;
        if (type) lobbyCurrentFilters.run_type = type;
        lobbyNextCursor = null;
        lobbyShownIds.clear();
        loadLobbyList(false, period);
    }

    function resetLobbyFilters() {
        _el('lobby-filter-city').value = '';
        _el('lobby-filter-type').value = '';
        _el('lobby-filter-period').value = '7';
        lobbyCurrentFilters = {};
        lobbyNextCursor = null;
        lobbyShownIds.clear();
        loadLobbyList(false, '7');
    }

    async function loadLobbyList(append, periodOverride) {
        var itemsEl = _el('lobby-list-items');
        var loadingEl = _el('lobby-list-loading');
        var emptyEl = _el('lobby-list-empty');
        var loadMoreEl = _el('lobby-list-load-more');

        if (!append) {
            itemsEl.innerHTML = '';
            lobbyShownIds.clear();
            loadingEl.classList.remove('hidden');
            emptyEl.classList.add('hidden');
            _el('lobby-list-status').classList.add('hidden');
        }
        loadMoreEl.classList.add('hidden');

        var period = periodOverride != null ? periodOverride : _el('lobby-filter-period').value;
        var params = RunRouteLobbyUtils.buildLobbyQueryParams(lobbyCurrentFilters, period, lobbyNextCursor);
        var token = ++lobbyRequestToken;

        try {
            var resp = await fetch(apiUrl('/api/lobbies?' + params.toString()), { headers: getApiHeaders() });
            if (token !== lobbyRequestToken) return;
            loadingEl.classList.add('hidden');
            if (!resp.ok) {
                lobbyShowStatus(RunRouteLobbyUtils.getLobbyErrorText(resp.status), true);
                return;
            }
            var data = await resp.json();
            if (token !== lobbyRequestToken) return;
            var items = data.items || [];
            lobbyNextCursor = data.next_cursor || null;

            if (!append && items.length === 0) {
                emptyEl.classList.remove('hidden');
                return;
            }
            items.forEach(function (lobby) {
                if (lobbyShownIds.has(lobby.id)) return;
                lobbyShownIds.add(lobby.id);
                itemsEl.appendChild(RunRouteLobbyUtils.renderLobbyCard(lobby, safeCreateEl, safeAvatar));
            });
            if (lobbyNextCursor) loadMoreEl.classList.remove('hidden');
        } catch (e) {
            if (token !== lobbyRequestToken) return;
            loadingEl.classList.add('hidden');
            lobbyShowStatus('\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d', true);
        }
    }

    function loadMoreLobbies() {
        if (lobbyLoadMoreBusy) return;
        lobbyLoadMoreBusy = true;
        var btn = _el('lobby-list-load-more-btn');
        btn.disabled = true;
        btn.textContent = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...';
        loadLobbyList(true).finally(function () {
            lobbyLoadMoreBusy = false;
            btn.disabled = false;
            btn.textContent = '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0435\u0449\u0451';
        });
    }

    // --- Form ---
    function resetLobbyCreateForm() {
        _el('lobby-form-title').value = '';
        _el('lobby-form-type').value = 'easy';
        _el('lobby-form-date').value = '';
        _el('lobby-form-city').value = '';
        _el('lobby-form-area').value = '';
        _el('lobby-form-route').value = '';
        _el('lobby-form-distance').value = '';
        _el('lobby-form-pace-min').value = '';
        _el('lobby-form-pace-max').value = '';
        _el('lobby-form-duration').value = '';
        _el('lobby-form-capacity').value = '10';
        _el('lobby-form-desc').value = '';
        lobbyMeetingPoint = null;
        lobbyPointSource = null;
        _el('lobby-point-status').textContent = '\u0422\u043e\u0447\u043a\u0430 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u0430';
        _el('lobby-point-status').className = 'lobby-point-status';
        _el('lobby-create-status').classList.add('hidden');
        _el('lobby-route-point-hint').classList.add('hidden');
        _el('lobby-form-route-add-btn').classList.add('hidden');
    }

    async function openLobbyCreateForm() {
        showLobbyCreate();
        resetLobbyCreateForm();
        var now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        _el('lobby-form-date').min = now.toISOString().slice(0, 16);
        var routeSelect = _el('lobby-form-route');
        routeSelect.innerHTML = '<option value="">\u0411\u0435\u0437 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0430</option>';
        try {
            var resp = await fetch(apiUrl('/api/routes'), { headers: getApiHeaders() });
            if (resp.ok) {
                var data = await resp.json();
                (data.routes || []).forEach(function (r) {
                    var opt = document.createElement('option');
                    opt.value = r.id;
                    var dist = r.distance_m != null ? ' (' + (r.distance_m / 1000).toFixed(1) + ' \u043a\u043c)' : '';
                    opt.textContent = r.name + dist;
                    opt.dataset.distanceM = r.distance_m || '';
                    routeSelect.appendChild(opt);
                });
            }
        } catch (e) { /* silent */ }
    }

    function onLobbyRouteSelect() {
        var sel = _el('lobby-form-route');
        var addBtn = _el('lobby-form-route-add-btn');
        var hint = _el('lobby-route-point-hint');
        if (sel.value) {
            addBtn.classList.remove('hidden');
            hint.classList.remove('hidden');
        } else {
            addBtn.classList.add('hidden');
            hint.classList.add('hidden');
            if (lobbyPointSource === 'saved_route') {
                lobbyMeetingPoint = null;
                lobbyPointSource = null;
                _el('lobby-point-status').textContent = '\u0422\u043e\u0447\u043a\u0430 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u0430';
                _el('lobby-point-status').className = 'lobby-point-status';
            }
        }
    }

    async function useRouteStartForLobby() {
        var routeId = _el('lobby-form-route').value;
        if (!routeId) return;
        var el = _el('lobby-point-status');
        el.textContent = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0430...';
        el.className = 'lobby-point-status';
        try {
            var resp = await fetch(apiUrl('/api/routes/' + routeId), { headers: getApiHeaders() });
            if (!resp.ok) throw new Error();
            var route = await resp.json();
            var pt = RunRouteLobbyUtils.getFirstRoutePoint(route);
            if (!pt) {
                el.textContent = '\u041c\u0430\u0440\u0448\u0440\u0443\u0442 \u043d\u0435 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u0432\u0430\u043b\u0438\u0434\u043d\u044b\u0445 \u0442\u043e\u0447\u0435\u043a';
                el.className = 'lobby-point-status error';
                return;
            }
            lobbyMeetingPoint = pt;
            lobbyPointSource = 'saved_route';
            el.textContent = '\u0412\u044b\u0431\u0440\u0430\u043d \u0441\u0442\u0430\u0440\u0442 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0430';
            el.className = 'lobby-point-status success';
        } catch (e) {
            el.textContent = '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043c\u0430\u0440\u0448\u0440\u0443\u0442';
            el.className = 'lobby-point-status error';
        }
    }

    // --- GPS ---
    function _useBrowserGeolocation(el, onComplete) {
        if (!navigator.geolocation) {
            el.textContent = '\u0413\u0435\u043e\u043b\u043e\u043a\u0430\u0446\u0438\u044f \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f';
            el.className = 'lobby-point-status error';
            if (onComplete) onComplete();
            return;
        }
        el.textContent = '\u041e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u0435 \u043c\u0435\u0441\u0442\u043e\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u044f...';
        el.className = 'lobby-point-status';
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                var lat = pos.coords.latitude, lng = pos.coords.longitude;
                if (!RunRouteLobbyUtils.lobbyCoordsValid(lat, lng)) {
                    el.textContent = '\u041f\u043e\u043b\u0443\u0447\u0435\u043d\u044b \u043d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0435 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b';
                    el.className = 'lobby-point-status error';
                    if (onComplete) onComplete();
                    return;
                }
                lobbyMeetingPoint = { lat: lat, lng: lng };
                lobbyPointSource = 'gps';
                el.textContent = '\u0412\u044b\u0431\u0440\u0430\u043d\u0430 \u0442\u0435\u043a\u0443\u0449\u0430\u044f \u0433\u0435\u043e\u043f\u043e\u0437\u0438\u0446\u0438\u044f';
                el.className = 'lobby-point-status success';
                if (onComplete) onComplete();
            },
            function (err) {
                if (err.code === 1) {
                    el.textContent = '\u0414\u043e\u0441\u0442\u0443\u043f \u043a \u0433\u0435\u043e\u043f\u043e\u0437\u0438\u0446\u0438\u0438 \u0437\u0430\u043f\u0440\u0435\u0449\u0451\u043d. \u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435 \u0434\u043e\u0441\u0442\u0443\u043f \u0432 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445.';
                } else if (err.code === 2) {
                    el.textContent = '\u041c\u0435\u0441\u0442\u043e\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e';
                } else {
                    el.textContent = '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u043c\u0435\u0441\u0442\u043e\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435';
                }
                el.className = 'lobby-point-status error';
                if (onComplete) onComplete();
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    function useGpsForLobby() {
        var el = _el('lobby-point-status');

        // 1. Fresh lastKnownLocation
        if (lastKnownLocation && (Date.now() - lastKnownLocation.timestamp < 300000)) {
            var ll = lastKnownLocation;
            if (RunRouteLobbyUtils.lobbyCoordsValid(ll.lat, ll.lng)) {
                lobbyMeetingPoint = { lat: ll.lat, lng: ll.lng };
                lobbyPointSource = 'gps';
                el.textContent = '\u0412\u044b\u0431\u0440\u0430\u043d\u0430 \u0442\u0435\u043a\u0443\u0449\u0430\u044f \u0433\u0435\u043e\u043f\u043e\u0437\u0438\u0446\u0438\u044f';
                el.className = 'lobby-point-status success';
                return;
            }
        }

        // 2. Telegram LocationManager
        var tgApp = window.Telegram && window.Telegram.WebApp;
        var lm = tgApp && tgApp.LocationManager;
        if (lm) {
            if (_lobbyLocationManagerBusy) return;
            _lobbyLocationManagerBusy = true;
            el.textContent = '\u041e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u0435 \u043c\u0435\u0441\u0442\u043e\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u044f...';
            el.className = 'lobby-point-status';

            function _gpsDone() { _lobbyLocationManagerBusy = false; }

            var onLocation = function (locationData) {
                if (!locationData) {
                    _useBrowserGeolocation(el, _gpsDone);
                    return;
                }
                var lat = locationData.latitude;
                var lng = locationData.longitude;
                if (lat == null || lng == null || !RunRouteLobbyUtils.lobbyCoordsValid(lat, lng)) {
                    _useBrowserGeolocation(el, _gpsDone);
                    return;
                }
                lobbyMeetingPoint = { lat: lat, lng: lng };
                lobbyPointSource = 'gps';
                el.textContent = '\u0412\u044b\u0431\u0430\u043d\u0430 \u0442\u0435\u043a\u0443\u0449\u0430\u044f \u0433\u0435\u043e\u043f\u043e\u0437\u0438\u0446\u0438\u044f';
                el.className = 'lobby-point-status success';
                _gpsDone();
            };

            try {
                if (lm.isInited) {
                    lm.getLocation(onLocation);
                } else {
                    lm.init(function () { lm.getLocation(onLocation); });
                }
            } catch (e) {
                _useBrowserGeolocation(el, _gpsDone);
            }
            return;
        }

        // 3. Browser geolocation fallback
        _lobbyLocationManagerBusy = true;
        _useBrowserGeolocation(el, function () { _lobbyLocationManagerBusy = false; });
    }

    // --- Panel open/close ---
    function openLobbyPanel() {
        _el('lobby-panel').classList.remove('hidden');
        showLobbyList();
        var period = _el('lobby-filter-period').value;
        if (period && Object.keys(lobbyCurrentFilters).length === 0 && lobbyShownIds.size === 0) {
            lobbyCurrentFilters = {};
            applyLobbyFilters();
        } else {
            loadLobbyList();
        }
    }

    function closeLobbyPanel() {
        _el('lobby-panel').classList.add('hidden');
        lobbyNextCursor = null;
        lobbyShownIds.clear();
        ++lobbyRequestToken;
        ++lobbyDetailRequestToken;
    }

    // --- Public API ---
    return {
        // State accessors (for tests)
        get lobbyBusyActions() { return lobbyBusyActions; },
        get lobbyDetailRequestToken() { return lobbyDetailRequestToken; },
        get lobbyRequestToken() { return lobbyRequestToken; },
        get lobbyMeetingPoint() { return lobbyMeetingPoint; },
        get lobbyPointSource() { return lobbyPointSource; },
        get lobbyNextCursor() { return lobbyNextCursor; },
        lobbyIsBusy: lobbyIsBusy,
        lobbySetBusy: lobbySetBusy,
        lobbyClearBusy: lobbyClearBusy,

        // Functions
        initLobby: function () { /* wired in app.js */ },
        openLobbyPanel: openLobbyPanel,
        closeLobbyPanel: closeLobbyPanel,
        showLobbyList: showLobbyList,
        showLobbyDetail: showLobbyDetail,
        showLobbyCreate: showLobbyCreate,
        applyLobbyFilters: applyLobbyFilters,
        resetLobbyFilters: resetLobbyFilters,
        loadLobbyList: loadLobbyList,
        loadMoreLobbies: loadMoreLobbies,
        openLobbyDetail: openLobbyDetail,
        openLobbyCreateForm: openLobbyCreateForm,
        joinLobby: joinLobby,
        leaveLobbyAction: leaveLobbyAction,
        cancelLobbyAction: cancelLobbyAction,
        submitLobbyCreate: submitLobbyCreate,
        useGpsForLobby: useGpsForLobby,
        useRouteStartForLobby: useRouteStartForLobby,
        onLobbyRouteSelect: onLobbyRouteSelect,
        resetLobbyCreateForm: resetLobbyCreateForm,
        refreshLobbyListItem: refreshLobbyListItem,
        buildLobbyDetailDom: buildLobbyDetailDom,
        lobbyShowDetailStatus: lobbyShowDetailStatus,
        lobbyShowDetailStatusHtml: lobbyShowDetailStatusHtml,
        lobbyShowCreateStatus: lobbyShowCreateStatus,
        lobbyShowStatus: lobbyShowStatus,
        _useBrowserGeolocation: _useBrowserGeolocation,

        // Test helpers
        get _vmCtx() { return null; }, // placeholder, real ctx injected by VM
    };
});
