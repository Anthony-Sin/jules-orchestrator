import test from 'node:test';
import assert from 'node:assert';
import { store, getQuotaLimit, setQuotaLimit, getQuotaUsed, quotaRemaining } from './store.js';

test('Quota functions', async (t) => {
  const mockData = new Map();

  // Mock store.get and store.set
  t.mock.method(store, 'get', (key, defaultValue) => {
    return mockData.has(key) ? mockData.get(key) : defaultValue;
  });

  t.mock.method(store, 'set', (key, value) => {
    mockData.set(key, value);
  });

  await t.test('getQuotaLimit returns null by default', () => {
    mockData.clear();
    assert.strictEqual(getQuotaLimit(), null);
  });

  await t.test('setQuotaLimit and getQuotaLimit', () => {
    mockData.clear();
    setQuotaLimit(50);
    assert.strictEqual(getQuotaLimit(), 50);
  });

  await t.test('getQuotaUsed returns 0 if not set', () => {
    mockData.clear();
    assert.strictEqual(getQuotaUsed(), 0);
  });

  await t.test('getQuotaUsed returns used value from quota object', () => {
    mockData.clear();
    mockData.set('quota', { used: 10 });
    assert.strictEqual(getQuotaUsed(), 10);
  });

  await t.test('quotaRemaining returns null if no limit', () => {
    mockData.clear();
    mockData.set('quota', { used: 10 });
    assert.strictEqual(quotaRemaining(), null);
  });

  await t.test('quotaRemaining returns difference if limit is set', () => {
    mockData.clear();
    mockData.set('quotaLimit', 100);
    mockData.set('quota', { used: 30 });
    assert.strictEqual(quotaRemaining(), 70);
  });
});
