// Runner directory controller — extracted for testability.
// Dependencies: document, window.Telegram, fetch, apiUrl,
// getApiHeaders, safeCreateEl, safeAvatar, openPublicProfile.

(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.RunRouteRunners = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {

    // --- State ---
    var _nextCursor = null;
    var _busy = false;
    var _requestToken = 0;
    var _shownIds = new Set();

    // --- Helpers ---
    function _el(id) { return document.getElementById(id); }

    function _showStatus(text, isError) {
        var el = _el('runners-list-status');
        el.textContent = text;
        el.className = isError ? 'profile-status error' : 'profile-status';
        el.classList.remove('hidden');
    }

    // --- Card rendering ---
    function _buildRunnerCard(runner) {
        var card = safeCreateEl('div', { className: 'runner-card' });
        card.dataset.userId = runner.user_id;

        var header = safeCreateEl('div', { className: 'runner-card-header' });
        var avatarWrap = safeCreateEl('div', { className: 'runner-card-avatar' });
        avatarWrap.appendChild(safeAvatar(runner.avatar_url, 48));
        header.appendChild(avatarWrap);

        var info = safeCreateEl('div', { className: 'runner-card-info' });
        info.appendChild(safeCreateEl('div', { className: 'runner-card-name', textContent: runner.display_name || '\u0411\u0435\u0437 \u0438\u043c\u0435\u043d\u0438' }));

        var meta = safeCreateEl('div', { className: 'runner-card-meta' });
        if (runner.city) {
            meta.appendChild(safeCreateEl('span', { className: 'runner-card-city', textContent: runner.city }));
        }
        if (runner.club_name) {
            meta.appendChild(safeCreateEl('span', { className: 'runner-card-club', textContent: runner.club_name }));
        }
        info.appendChild(meta);
        header.appendChild(info);
        card.appendChild(header);

        if (runner.bio) {
            var bioText = runner.bio.length > 100 ? runner.bio.substring(0, 100) + '\u2026' : runner.bio;
            card.appendChild(safeCreateEl('div', { className: 'runner-card-bio', textContent: bioText }));
        }

        var footer = safeCreateEl('div', { className: 'runner-card-footer' });
        var followersText = runner.followers_count + ' ' + _pluralize(runner.followers_count, '\u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a', '\u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a\u0430', '\u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a\u043e\u0432');
        footer.appendChild(safeCreateEl('span', { className: 'runner-card-followers', textContent: followersText }));

        if (runner.is_following) {
            footer.appendChild(safeCreateEl('span', { className: 'runner-card-following-badge', textContent: '\u0412 \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0435' }));
        }

        var profileBtn = safeCreateEl('button', { className: 'modal-btn secondary runner-card-profile-btn', textContent: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c' });
        profileBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openPublicProfile(runner.user_id);
        });
        footer.appendChild(profileBtn);
        card.appendChild(footer);

        return card;
    }

    function _pluralize(n, one, few, many) {
        var mod10 = n % 10;
        var mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 19) return many;
        if (mod10 === 1) return one;
        if (mod10 >= 2 && mod10 <= 4) return few;
        return many;
    }

    // --- List loading ---
    async function loadRunnerList(reset) {
        if (reset) {
            _busy = false;
        }
        if (_busy) return;
        _busy = true;

        var itemsEl = _el('runners-list-items');
        var loadingEl = _el('runners-list-loading');
        var emptyEl = _el('runners-list-empty');
        var loadMoreEl = _el('runners-list-load-more');
        var statusEl = _el('runners-list-status');

        if (reset) {
            itemsEl.innerHTML = '';
            _nextCursor = null;
            _shownIds.clear();
        }

        statusEl.classList.add('hidden');
        loadingEl.classList.remove('hidden');
        emptyEl.classList.add('hidden');
        loadMoreEl.classList.add('hidden');

        var q = _el('runners-filter-q').value.trim() || null;
        var city = _el('runners-filter-city').value.trim() || null;
        var club = _el('runners-filter-club').value.trim() || null;

        var params = new URLSearchParams();
        if (q) params.set('q', q);
        if (city) params.set('city', city);
        if (club) params.set('club', club);
        params.set('limit', '20');
        if (_nextCursor) params.set('cursor', _nextCursor);

        var myToken = ++_requestToken;

        try {
            var resp = await fetch(apiUrl('/api/public-profiles?' + params.toString()), {
                headers: getApiHeaders(),
            });
            if (myToken !== _requestToken) return;

            if (!resp.ok) {
                var errBody = await resp.json().catch(function () { return {}; });
                if (myToken !== _requestToken) return;
                var msg = errBody.detail || '\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d';
                _showStatus(msg, true);
                loadingEl.classList.add('hidden');
                return;
            }
            var data = await resp.json();
            if (myToken !== _requestToken) return;

            var items = data.items || [];
            _nextCursor = data.next_cursor || null;

            if (items.length === 0 && !reset && itemsEl.children.length > 0) {
                loadingEl.classList.add('hidden');
                return;
            }

            if (items.length === 0) {
                loadingEl.classList.add('hidden');
                emptyEl.classList.remove('hidden');
                return;
            }

            items.forEach(function (runner) {
                if (_shownIds.has(runner.user_id)) return;
                _shownIds.add(runner.user_id);
                itemsEl.appendChild(_buildRunnerCard(runner));
            });

            loadingEl.classList.add('hidden');
            if (_nextCursor) loadMoreEl.classList.remove('hidden');
        } catch (e) {
            if (myToken !== _requestToken) return;
            loadingEl.classList.add('hidden');
            _showStatus('\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d', true);
        } finally {
            _busy = false;
        }
    }

    // --- Panel open/close ---
    function openRunnersPanel() {
        _el('runners-panel').classList.remove('hidden');
        loadRunnerList(true);
    }

    function closeRunnersPanel() {
        _el('runners-panel').classList.add('hidden');
        ++_requestToken;
    }

    function applyFilters() {
        loadRunnerList(true);
    }

    function resetFilters() {
        _el('runners-filter-q').value = '';
        _el('runners-filter-city').value = '';
        _el('runners-filter-club').value = '';
        loadRunnerList(true);
    }

    function loadMore() {
        return loadRunnerList(false);
    }

    // --- Follow state sync ---
    function updateRunnerFollowState(userId, state) {
        var cards = _el('runners-list-items').querySelectorAll('.runner-card');
        cards.forEach(function (card) {
            if (card.dataset.userId !== userId) return;
            var footer = card.querySelector('.runner-card-footer');
            if (!footer) return;

            // Update followers count
            var followersEl = card.querySelector('.runner-card-followers');
            if (followersEl && state.followers_count != null) {
                var count = state.followers_count;
                safeSetText(followersEl, count + ' ' + _pluralize(count, '\u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a', '\u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a\u0430', '\u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a\u043e\u0432'));
            }

            // Update following badge
            var existingBadge = card.querySelector('.runner-card-following-badge');
            if (state.is_following) {
                if (!existingBadge) {
                    footer.insertBefore(
                        safeCreateEl('span', { className: 'runner-card-following-badge', textContent: '\u0412 \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0435' }),
                        footer.firstChild
                    );
                }
            } else {
                if (existingBadge) existingBadge.remove();
            }
        });
    }

    // --- Public API ---
    return {
        openRunnersPanel: openRunnersPanel,
        closeRunnersPanel: closeRunnersPanel,
        applyFilters: applyFilters,
        resetFilters: resetFilters,
        loadMore: loadMore,
        loadRunnerList: loadRunnerList,
        updateRunnerFollowState: updateRunnerFollowState,
        _buildRunnerCard: _buildRunnerCard,
        get _shownIds() { return _shownIds; },
        get _nextCursor() { return _nextCursor; },
        get _requestToken() { return _requestToken; },
    };
});
