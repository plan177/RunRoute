// Public profile upcoming lobbies — extracted for testability.
// Dependencies: document, fetch, apiUrl, getApiHeaders,
// safeCreateEl, safeAvatar, RunRouteLobbyUtils, RunRouteLobby.

(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.RunRoutePublicProfileLobbies = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {

    var _requestToken = 0;
    var _currentUserId = null;

    function _el(id) { return document.getElementById(id); }

    function _showLoading() {
        var el = _el('pp-lobbies-loading');
        if (el) el.classList.remove('hidden');
    }

    function _hideLoading() {
        var el = _el('pp-lobbies-loading');
        if (el) el.classList.add('hidden');
    }

    function _showEmpty() {
        var el = _el('pp-lobbies-empty');
        if (el) el.classList.remove('hidden');
    }

    function _hideEmpty() {
        var el = _el('pp-lobbies-empty');
        if (el) el.classList.add('hidden');
    }

    function _showError(msg) {
        var el = _el('pp-lobbies-status');
        if (!el) return;
        el.textContent = msg;
        el.className = 'profile-status error';
        el.classList.remove('hidden');
    }

    function _hideError() {
        var el = _el('pp-lobbies-status');
        if (el) el.classList.add('hidden');
    }

    function _clearContent() {
        var el = _el('pp-lobbies-items');
        if (el) el.innerHTML = '';
    }

    function _showSection() {
        var el = _el('public-profile-lobbies-section');
        if (el) el.classList.remove('hidden');
    }

    function _hideSection() {
        var el = _el('public-profile-lobbies-section');
        if (el) el.classList.add('hidden');
    }

    function _buildUrl(userId) {
        var params = new URLSearchParams();
        params.set('organizer_id', userId);
        params.set('limit', '3');
        return apiUrl('/api/lobbies?' + params.toString());
    }

    function _renderCard(lobby, container) {
        var card = safeCreateEl('div', { className: 'pp-lobby-card' });

        var title = safeCreateEl('div', { className: 'pp-lobby-card-title' });
        title.textContent = lobby.title || '';
        card.appendChild(title);

        var dateText = RunRouteLobbyUtils.formatLobbyDate(lobby.starts_at);
        if (dateText) {
            var dateEl = safeCreateEl('div', { className: 'pp-lobby-card-date' });
            dateEl.textContent = dateText;
            card.appendChild(dateEl);
        }

        var typeText = RunRouteLobbyUtils.formatRunType(lobby.run_type);
        if (typeText) {
            var typeEl = safeCreateEl('div', { className: 'pp-lobby-card-type' });
            typeEl.textContent = typeText;
            card.appendChild(typeEl);
        }

        var metaParts = [];
        if (lobby.city) metaParts.push(lobby.city);
        if (lobby.area_label) metaParts.push(lobby.area_label);
        if (metaParts.length > 0) {
            var placeEl = safeCreateEl('div', { className: 'pp-lobby-card-place' });
            placeEl.textContent = metaParts.join(', ');
            card.appendChild(placeEl);
        }

        if (lobby.distance_m != null) {
            var distEl = safeCreateEl('div', { className: 'pp-lobby-card-dist' });
            distEl.textContent = RunRouteLobbyUtils.formatDistanceM(lobby.distance_m);
            card.appendChild(distEl);
        }

        var participantsText = RunRouteLobbyUtils.formatParticipants(lobby.participant_count, lobby.capacity);
        if (participantsText) {
            var partEl = safeCreateEl('div', { className: 'pp-lobby-card-participants' });
            partEl.textContent = participantsText;
            card.appendChild(partEl);
        }

        card.dataset.lobbyId = lobby.id;

        card.addEventListener('click', function () {
            openLobby(lobby.id);
        });

        container.appendChild(card);
    }

    function _renderResults(items) {
        var container = _el('pp-lobbies-items');
        if (!container) return;
        container.innerHTML = '';

        if (!items || items.length === 0) {
            _showEmpty();
            return;
        }

        _hideEmpty();
        items.forEach(function (lobby) {
            _renderCard(lobby, container);
        });
    }

    async function load(userId) {
        _currentUserId = userId;
        var token = ++_requestToken;

        _showSection();
        _hideLoading();
        _hideEmpty();
        _hideError();
        _clearContent();
        _showLoading();

        try {
            var resp = await fetch(_buildUrl(userId), { headers: getApiHeaders() });
            if (token !== _requestToken) return;

            if (!resp.ok) {
                _hideLoading();
                _showError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0431\u0435\u0436\u043a\u0438');
                return;
            }

            var data = await resp.json();
            if (token !== _requestToken) return;

            _hideLoading();
            _renderResults(data.items || []);
        } catch (e) {
            if (token !== _requestToken) return;
            _hideLoading();
            _showError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0431\u0435\u0436\u043a\u0438');
        }
    }

    function invalidate() {
        ++_requestToken;
        _currentUserId = null;
        _hideSection();
        _hideLoading();
        _hideEmpty();
        _hideError();
        _clearContent();
    }

    function openLobby(lobbyId) {
        RunRouteLobby.openLobbyPanel();
        RunRouteLobby.openLobbyDetail(lobbyId);
    }

    function _getCurrentUserId() { return _currentUserId; }
    function _getRequestToken() { return _requestToken; }

    return {
        load: load,
        invalidate: invalidate,
        openLobby: openLobby,
        _buildUrl: _buildUrl,
        _renderCard: _renderCard,
        _renderResults: _renderResults,
        _getCurrentUserId: _getCurrentUserId,
        _getRequestToken: _getRequestToken,
    };
});
