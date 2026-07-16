/**
 * Pure utility functions for public profile and follow logic.
 * Extracted for testability — no DOM or network dependencies.
 */

function buildPublicProfileUrl(userId) {
    return '/api/users/' + userId + '/profile';
}

function buildFollowRequestUrl(userId) {
    return '/api/users/' + userId + '/follow';
}

function buildNotificationsRequestUrl(userId) {
    return '/api/users/' + userId + '/follow/notifications';
}

function getFollowMethod(isFollowing) {
    return isFollowing ? 'DELETE' : 'POST';
}

function applyFollowResponse(previousState, response) {
    const isFollowing = response.is_following != null ? response.is_following : !previousState.isFollowing;
    return {
        isFollowing: isFollowing,
        runNotificationsEnabled: response.run_notifications_enabled,
        followersCount: response.followers_count != null ? response.followers_count : previousState.followersCount,
    };
}

function applyNotificationResponse(previousEnabled, response) {
    if (response.run_notifications_enabled != null) {
        return response.run_notifications_enabled;
    }
    return previousEnabled;
}

function getPublicProfileActionError(status, detail) {
    if (status === 404) return 'Профиль больше недоступен';
    if (status >= 500) return 'Сервис временно недоступен';
    if (detail) return detail;
    return 'Не удалось изменить подписку';
}

function getNotificationActionError(detail) {
    if (detail) return detail;
    return 'Не удалось изменить настройку';
}

function getNetworkError() {
    return 'Не удалось подключиться к серверу';
}

function shouldShowNotifications(isFollowing, value) {
    return isFollowing && value !== undefined && value !== null;
}

function buildFollowersCountText(count) {
    return count != null ? count : 0;
}

function buildFollowingCountText(count) {
    return count != null ? count : 0;
}

// Export for Node.js tests and browser
if (typeof window !== 'undefined') {
    window.RunRoutePublicProfileUtils = {
        buildPublicProfileUrl,
        buildFollowRequestUrl,
        buildNotificationsRequestUrl,
        getFollowMethod,
        applyFollowResponse,
        applyNotificationResponse,
        getPublicProfileActionError,
        getNotificationActionError,
        getNetworkError,
        shouldShowNotifications,
        buildFollowersCountText,
        buildFollowingCountText,
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildPublicProfileUrl,
        buildFollowRequestUrl,
        buildNotificationsRequestUrl,
        getFollowMethod,
        applyFollowResponse,
        applyNotificationResponse,
        getPublicProfileActionError,
        getNotificationActionError,
        getNetworkError,
        shouldShowNotifications,
        buildFollowersCountText,
        buildFollowingCountText,
    };
}
