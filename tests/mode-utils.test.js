const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getModeTransitionPlan } = require('../mini-app/mode-utils.js');

describe('getModeTransitionPlan', () => {
    it('auto → auto', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto',
            nextMode: 'auto',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: true,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, false);
        assert.equal(plan.stopTracking, false);
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, false);
        assert.equal(plan.clearManualMode, false);
        assert.equal(plan.removeStartMarker, false);
        assert.equal(plan.seedManualStartPoint, false);
    });

    it('manual → manual', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'manual',
            nextMode: 'manual',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: true,
            manualPointCount: 3
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, false);
    });

    it('track → track при активном tracking', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track',
            nextMode: 'track',
            trackingActive: true,
            hasGeneratedRoute: false,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, false);
        assert.equal(plan.stopTracking, false);
    });

    it('auto → manual без маршрута', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto',
            nextMode: 'manual',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: true,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, false);
        assert.equal(plan.removeStartMarker, true);
        assert.equal(plan.seedManualStartPoint, true);
    });

    it('auto → manual с маршрутом', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto',
            nextMode: 'manual',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: true,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, true);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.removeStartMarker, true);
        assert.equal(plan.seedManualStartPoint, true);
    });

    it('manual → auto без маршрута', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'manual',
            nextMode: 'auto',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: true,
            manualPointCount: 3
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearManualMode, true);
    });

    it('manual → auto с маршрутом', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'manual',
            nextMode: 'auto',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: true,
            manualPointCount: 3
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, true);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.clearManualMode, true);
    });

    it('auto → track с маршрутом', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto',
            nextMode: 'track',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: true,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, true);
        assert.equal(plan.clearGeneratedRoute, true);
    });

    it('manual → track с маршрутом', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'manual',
            nextMode: 'track',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: true,
            manualPointCount: 3
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, true);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.clearManualMode, true);
    });

    it('track → auto с завершённым маршрутом', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track',
            nextMode: 'auto',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, true);
    });

    it('track → manual с завершённым маршрутом', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track',
            nextMode: 'manual',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.removeStartMarker, true);
    });

    it('track → auto при активном tracking', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track',
            nextMode: 'auto',
            trackingActive: true,
            hasGeneratedRoute: false,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.stopTracking, true);
    });

    it('track → manual при активном tracking', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track',
            nextMode: 'manual',
            trackingActive: true,
            hasGeneratedRoute: false,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.modeChanged, true);
        assert.equal(plan.stopTracking, true);
        assert.equal(plan.removeStartMarker, true);
    });

    it('auto → manual с userLocation и без manualPoints', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto',
            nextMode: 'manual',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: true,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.seedManualStartPoint, true);
    });

    it('auto → manual, когда manualPoints уже есть', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto',
            nextMode: 'manual',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: true,
            manualPointCount: 3
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.seedManualStartPoint, false);
    });

    it('неизвестный previousMode', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'unknown',
            nextMode: 'auto',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, false);
    });

    it('неизвестный nextMode', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto',
            nextMode: 'unknown',
            trackingActive: false,
            hasGeneratedRoute: false,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, false);
    });
});

describe('инварианты', () => {
    it('offerShareBeforeClear => clearGeneratedRoute', () => {
        const inputs = [
            { previousMode: 'auto', nextMode: 'manual', hasGeneratedRoute: true },
            { previousMode: 'manual', nextMode: 'auto', hasGeneratedRoute: true },
            { previousMode: 'track', nextMode: 'auto', hasGeneratedRoute: true },
            { previousMode: 'track', nextMode: 'manual', hasGeneratedRoute: true }
        ];
        for (const input of inputs) {
            const plan = getModeTransitionPlan({
                ...input,
                trackingActive: false,
                hasUserLocation: false,
                manualPointCount: 0
            });
            if (plan.offerShareBeforeClear) {
                assert.equal(plan.clearGeneratedRoute, true, 
                    `offerShareBeforeClear=true требует clearGeneratedRoute=true для ${input.previousMode} → ${input.nextMode}`);
            }
        }
    });

    it('seedManualStartPoint возможен только при nextMode === manual', () => {
        const inputs = [
            { previousMode: 'auto', nextMode: 'auto', hasUserLocation: true, manualPointCount: 0 },
            { previousMode: 'auto', nextMode: 'track', hasUserLocation: true, manualPointCount: 0 },
            { previousMode: 'manual', nextMode: 'auto', hasUserLocation: true, manualPointCount: 0 }
        ];
        for (const input of inputs) {
            const plan = getModeTransitionPlan({
                ...input,
                trackingActive: false,
                hasGeneratedRoute: false
            });
            assert.equal(plan.seedManualStartPoint, false, 
                `seedManualStartPoint=false для ${input.previousMode} → ${input.nextMode}`);
        }
    });

    it('stopTracking возможен только при выходе из track', () => {
        const inputs = [
            { previousMode: 'auto', nextMode: 'manual', trackingActive: true },
            { previousMode: 'manual', nextMode: 'auto', trackingActive: true },
            { previousMode: 'auto', nextMode: 'track', trackingActive: true }
        ];
        for (const input of inputs) {
            const plan = getModeTransitionPlan({
                ...input,
                hasGeneratedRoute: false,
                hasUserLocation: false,
                manualPointCount: 0
            });
            assert.equal(plan.stopTracking, false, 
                `stopTracking=false для ${input.previousMode} → ${input.nextMode}`);
        }
    });

    it('переход auto/manual → track с маршрутом предлагает share', () => {
        const inputs = [
            { previousMode: 'auto', nextMode: 'track' },
            { previousMode: 'manual', nextMode: 'track' }
        ];
        for (const input of inputs) {
            const plan = getModeTransitionPlan({
                ...input,
                trackingActive: false,
                hasGeneratedRoute: true,
                hasUserLocation: false,
                manualPointCount: 0
            });
            assert.equal(plan.offerShareBeforeClear, true,
                `offerShareBeforeClear=true для ${input.previousMode} → ${input.nextMode}`);
            assert.equal(plan.clearGeneratedRoute, true,
                `clearGeneratedRoute=true для ${input.previousMode} → ${input.nextMode}`);
        }
    });

    it('переход track → auto/manual не предлагает share', () => {
        const inputs = [
            { previousMode: 'track', nextMode: 'auto' },
            { previousMode: 'track', nextMode: 'manual' }
        ];
        for (const input of inputs) {
            const plan = getModeTransitionPlan({
                ...input,
                trackingActive: false,
                hasGeneratedRoute: true,
                hasUserLocation: false,
                manualPointCount: 0
            });
            assert.equal(plan.offerShareBeforeClear, false,
                `offerShareBeforeClear=false для ${input.previousMode} → ${input.nextMode}`);
        }
    });

    it('same-mode переход не содержит destructive-действий', () => {
        const modes = ['auto', 'manual', 'track'];
        for (const mode of modes) {
            const plan = getModeTransitionPlan({
                previousMode: mode,
                nextMode: mode,
                trackingActive: mode === 'track',
                hasGeneratedRoute: true,
                hasUserLocation: true,
                manualPointCount: 3
            });
            assert.equal(plan.stopTracking, false, `stopTracking=false для ${mode} → ${mode}`);
            assert.equal(plan.offerShareBeforeClear, false, `offerShareBeforeClear=false для ${mode} → ${mode}`);
            assert.equal(plan.clearGeneratedRoute, false, `clearGeneratedRoute=false для ${mode} → ${mode}`);
            assert.equal(plan.clearManualMode, false, `clearManualMode=false для ${mode} → ${mode}`);
            assert.equal(plan.removeStartMarker, false, `removeStartMarker=false для ${mode} → ${mode}`);
            assert.equal(plan.seedManualStartPoint, false, `seedManualStartPoint=false для ${mode} → ${mode}`);
        }
    });

    it('manual → track с маршрутом: clearGeneratedRoute=true', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'manual',
            nextMode: 'track',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: false,
            manualPointCount: 3
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.clearManualMode, true);
    });

    it('manual → auto с маршрутом: clearGeneratedRoute=true', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'manual',
            nextMode: 'auto',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: false,
            manualPointCount: 3
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.clearManualMode, true);
    });

    it('track → auto при активном tracking без маршрута: no share', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track',
            nextMode: 'auto',
            trackingActive: true,
            hasGeneratedRoute: false,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.stopTracking, true);
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, false);
    });

    it('track → auto после остановки с маршрутом: no share (offer only when leaving non-track)', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track',
            nextMode: 'auto',
            trackingActive: false,
            hasGeneratedRoute: true,
            hasUserLocation: false,
            manualPointCount: 0
        });
        assert.equal(plan.valid, true);
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, true);
    });
});

describe('Share/Track transition', () => {
    it('auto с маршрутом → track: offerShare=true, clearRoute=true', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto', nextMode: 'track',
            trackingActive: false, hasGeneratedRoute: true,
            hasUserLocation: true, manualPointCount: 0
        });
        assert.equal(plan.offerShareBeforeClear, true);
        assert.equal(plan.clearGeneratedRoute, true);
    });

    it('manual с маршрутом → track: offerShare=true, clearRoute=true, clearManual=true', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'manual', nextMode: 'track',
            trackingActive: false, hasGeneratedRoute: true,
            hasUserLocation: true, manualPointCount: 3
        });
        assert.equal(plan.offerShareBeforeClear, true);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.clearManualMode, true);
    });

    it('auto без маршрута → track: no offer, no clear', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto', nextMode: 'track',
            trackingActive: false, hasGeneratedRoute: false,
            hasUserLocation: true, manualPointCount: 0
        });
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, false);
    });

    it('track -> auto: no offer (track does not offer share), but clear route', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track', nextMode: 'auto',
            trackingActive: false, hasGeneratedRoute: true,
            hasUserLocation: false, manualPointCount: 0
        });
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, true);
    });

    it('track -> manual: no offer, but clear route and remove start marker', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track', nextMode: 'manual',
            trackingActive: false, hasGeneratedRoute: true,
            hasUserLocation: false, manualPointCount: 0
        });
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, true);
        assert.equal(plan.removeStartMarker, true);
    });

    it('auto → manual с маршрутом: offer share (not track transition)', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'auto', nextMode: 'manual',
            trackingActive: false, hasGeneratedRoute: true,
            hasUserLocation: true, manualPointCount: 0
        });
        assert.equal(plan.offerShareBeforeClear, true);
        assert.equal(plan.clearGeneratedRoute, true);
    });

    it('track → auto после остановки: clear but no share offer', () => {
        const plan = getModeTransitionPlan({
            previousMode: 'track', nextMode: 'auto',
            trackingActive: false, hasGeneratedRoute: true,
            hasUserLocation: false, manualPointCount: 0
        });
        assert.equal(plan.offerShareBeforeClear, false);
        assert.equal(plan.clearGeneratedRoute, true);
    });
});
