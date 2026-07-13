const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'app.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'mini-app', 'index.html'), 'utf-8');

describe('calendar production code', () => {
    it('calendar button exists and is not disabled', () => {
        assert.ok(indexHtml.includes('menu-calendar'), 'menu-calendar must exist');
        assert.ok(!indexHtml.includes('menu-calendar" class="menu-item" disabled'),
            'calendar must not be disabled');
    });

    it('openCalendar function exists', () => {
        assert.ok(appJs.includes('function openCalendar'),
            'openCalendar must be defined');
    });

    it('calendar requests use apiUrl', () => {
        assert.ok(appJs.includes("apiUrl(`/api/calendar/runs"),
            'calendar must use apiUrl for runs endpoint');
    });

    it('calendar requests use getApiHeaders', () => {
        assert.ok(appJs.includes("getApiHeaders()"),
            'calendar must use getApiHeaders');
    });

    it('calendar navigation fetches new data', () => {
        assert.ok(appJs.includes('loadCalendarData'),
            'calendar must have loadCalendarData function');
        const navSection = appJs.substring(
            appJs.indexOf('cal-prev'),
            appJs.indexOf('cal-add-run')
        );
        assert.ok(navSection.includes('loadCalendarData'),
            'navigation must call loadCalendarData');
    });

    it('saveRun supports PUT for edit mode', () => {
        assert.ok(appJs.includes("method: 'PUT'") || appJs.includes("method: PUT"),
            'saveRun must support PUT method');
        assert.ok(appJs.includes('editingRunId'),
            'saveRun must track editingRunId');
    });

    it('saveRun sets saved_route_id to null when no route selected', () => {
        assert.ok(appJs.includes("body.saved_route_id = null"),
            'saveRun must explicitly set saved_route_id to null when empty');
    });

    it('outside Telegram calendar shows message', () => {
        assert.ok(appJs.includes('Календарь доступен только внутри Telegram'),
            'must show Telegram-only message');
        assert.ok(appJs.includes('function openCalendar'),
            'openCalendar must be defined');
    });

    it('calendar events use textContent, not innerHTML for data', () => {
        const renderSection = appJs.substring(
            appJs.indexOf('function renderDayEvents'),
            appJs.indexOf('function saveRun')
        );
        assert.ok(renderSection.includes('.textContent'),
            'renderDayEvents must use textContent');
    });

    it('calendar modal has calendar-modal id', () => {
        assert.ok(indexHtml.includes('id="calendar-modal"'),
            'calendar modal must have id calendar-modal');
    });

    it('run form modal has run-form-modal id', () => {
        assert.ok(indexHtml.includes('id="run-form-modal"'),
            'run form modal must have id run-form-modal');
    });

    it('save route button exists', () => {
        assert.ok(indexHtml.includes('save-route-btn'),
            'save-route-btn must exist');
    });

    it('save route uses apiUrl', () => {
        assert.ok(appJs.includes("apiUrl('/api/routes')"),
            'save route must use apiUrl');
    });

    it('save route limits to 10000 points', () => {
        assert.ok(appJs.includes('10000'),
            'save route must check 10000 point limit');
    });

    it('track time and accuracy preserved in save payload', () => {
        assert.ok(appJs.includes('pt.time') || appJs.includes('p.time'),
            'save payload must include time');
        assert.ok(appJs.includes('pt.accuracy') || appJs.includes('p.accuracy'),
            'save payload must include accuracy');
    });
});
