const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Load config.js into a shared context
const code = fs.readFileSync(require('path').join(__dirname, '..', 'mini-app', 'config.js'), 'utf-8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const { apiUrl } = ctx;

describe('apiUrl', () => {
    it('returns path when base URL is empty', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = '';
        assert.equal(apiUrl('/api/me'), '/api/me');
    });

    it('returns path when base URL is undefined', () => {
        delete ctx.window.RUNROUTE_CONFIG.API_BASE_URL;
        assert.equal(apiUrl('/api/me'), '/api/me');
    });

    it('prepends base URL without trailing slash', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = 'https://api.example.com';
        assert.equal(apiUrl('/api/me'), 'https://api.example.com/api/me');
    });

    it('prepends base URL with trailing slash', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = 'https://api.example.com/';
        assert.equal(apiUrl('/api/me'), 'https://api.example.com/api/me');
    });

    it('does not produce double slashes between host and path', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = 'https://api.example.com/';
        const result = apiUrl('/api/me');
        assert.ok(!result.includes('example.com//'));
        assert.ok(!result.includes('.com//api'));
    });

    it('strips multiple trailing slashes', () => {
        ctx.window.RUNROUTE_CONFIG.API_BASE_URL = 'https://api.example.com///';
        assert.equal(apiUrl('/api/me'), 'https://api.example.com/api/me');
    });
});
