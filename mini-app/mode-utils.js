(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.RunRouteModeUtils = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const VALID_MODES = ['auto', 'manual', 'track'];

    function isValidMode(mode) {
        return VALID_MODES.includes(mode);
    }

    function getModeTransitionPlan(input) {
        const {
            previousMode,
            nextMode,
            trackingActive,
            hasGeneratedRoute,
            hasUserLocation,
            manualPointCount
        } = input;

        if (!isValidMode(previousMode) || !isValidMode(nextMode)) {
            return {
                valid: false,
                modeChanged: false,
                stopTracking: false,
                offerShareBeforeClear: false,
                clearGeneratedRoute: false,
                clearManualMode: false,
                removeStartMarker: false,
                seedManualStartPoint: false
            };
        }

        if (previousMode === nextMode) {
            return {
                valid: true,
                modeChanged: false,
                stopTracking: false,
                offerShareBeforeClear: false,
                clearGeneratedRoute: false,
                clearManualMode: false,
                removeStartMarker: false,
                seedManualStartPoint: false
            };
        }

        const shouldStopTracking = trackingActive && previousMode === 'track' && nextMode !== 'track';
        const shouldOfferShare = hasGeneratedRoute && nextMode !== 'track';
        const shouldClearGeneratedRoute = shouldOfferShare;
        const shouldClearManualMode = previousMode === 'manual' && nextMode !== 'manual';
        const shouldRemoveStartMarker = nextMode === 'manual';
        const shouldSeedManualStartPoint = previousMode === 'auto' && nextMode === 'manual' && hasUserLocation && manualPointCount === 0;

        return {
            valid: true,
            modeChanged: true,
            stopTracking: shouldStopTracking,
            offerShareBeforeClear: shouldOfferShare,
            clearGeneratedRoute: shouldClearGeneratedRoute,
            clearManualMode: shouldClearManualMode,
            removeStartMarker: shouldRemoveStartMarker,
            seedManualStartPoint: shouldSeedManualStartPoint
        };
    }

    return {
        VALID_MODES,
        isValidMode,
        getModeTransitionPlan
    };
});
