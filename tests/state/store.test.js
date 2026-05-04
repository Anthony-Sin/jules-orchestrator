import test from 'node:test';
import assert from 'node:assert';
import {
  store,
  getSessions,
  upsertSession,
  removeSession,
  getActiveSessions,
  getFileLocks,
  lockFiles,
  unlockFiles,
  checkFileLockConflicts,
  getQueue,
  setQueue,
  getConfig,
  setConfig,
  getArchitectureDiagrams
} from '../../src/state/store.js';

test('Session functions', async (t) => {
  const mockData = new Map();

  t.mock.method(store, 'get', (key, defaultValue) => {
    return mockData.has(key) ? mockData.get(key) : defaultValue;
  });

  t.mock.method(store, 'set', (key, value) => {
    mockData.set(key, value);
  });

  await t.test('getSessions returns empty array by default', () => {
    mockData.clear();
    assert.deepStrictEqual(getSessions(), []);
  });

  await t.test('upsertSession adds a new session', () => {
    mockData.clear();
    upsertSession({ id: '1', title: 'Test' });
    assert.deepStrictEqual(getSessions(), [{ id: '1', title: 'Test' }]);
  });

  await t.test('upsertSession updates an existing session', () => {
    mockData.clear();
    mockData.set('sessions', [{ id: '1', title: 'Old' }]);
    upsertSession({ id: '1', title: 'New' });
    assert.deepStrictEqual(getSessions(), [{ id: '1', title: 'New' }]);
  });

  await t.test('upsertSession strips undefined values and preserves existing values', () => {
    mockData.clear();
    mockData.set('sessions', [{ id: '1', title: 'Test', state: 'QUEUED' }]);
    upsertSession({ id: '1', title: undefined, state: 'COMPLETED' });
    assert.deepStrictEqual(getSessions(), [{ id: '1', title: 'Test', state: 'COMPLETED' }]);
  });

  await t.test('removeSession removes a session by id', () => {
    mockData.clear();
    mockData.set('sessions', [{ id: '1' }, { id: '2' }]);
    removeSession('1');
    assert.deepStrictEqual(getSessions(), [{ id: '2' }]);
  });

  await t.test('getActiveSessions filters out COMPLETED, FAILED, KILLED', () => {
    mockData.clear();
    mockData.set('sessions', [
      { id: '1', state: 'QUEUED' },
      { id: '2', state: 'IN_PROGRESS' },
      { id: '3', state: 'COMPLETED' },
      { id: '4', state: 'FAILED' },
      { id: '5', state: 'KILLED' },
      { id: '6', state: 'AWAITING_USER_FEEDBACK' }
    ]);
    const active = getActiveSessions();
    assert.strictEqual(active.length, 3);
    assert.deepStrictEqual(active.map(s => s.id), ['1', '2', '6']);
  });
});

test('File Lock functions', async (t) => {
  const mockData = new Map();

  t.mock.method(store, 'get', (key, defaultValue) => {
    return mockData.has(key) ? mockData.get(key) : defaultValue;
  });

  t.mock.method(store, 'set', (key, value) => {
    mockData.set(key, value);
  });

  await t.test('getFileLocks returns empty object by default', () => {
    mockData.clear();
    assert.deepStrictEqual(getFileLocks(), {});
  });

  await t.test('lockFiles adds file locks for a session', () => {
    mockData.clear();
    lockFiles('session-1', ['src/app.js', 'src/utils.js']);
    assert.deepStrictEqual(getFileLocks(), {
      'src/app.js': 'session-1',
      'src/utils.js': 'session-1'
    });
  });

  await t.test('unlockFiles removes locks associated with a session', () => {
    mockData.clear();
    mockData.set('fileLocks', {
      'src/app.js': 'session-1',
      'src/utils.js': 'session-1',
      'src/other.js': 'session-2'
    });
    unlockFiles('session-1');
    assert.deepStrictEqual(getFileLocks(), {
      'src/other.js': 'session-2'
    });
  });

  await t.test('checkFileLockConflicts handles no locks or no files', () => {
    mockData.clear();
    assert.deepStrictEqual(checkFileLockConflicts(['src/app.js']), []);
    mockData.set('fileLocks', { 'src/app.js': 'session-1' });
    assert.deepStrictEqual(checkFileLockConflicts([]), []);
  });

  await t.test('checkFileLockConflicts detects exact matches', () => {
    mockData.clear();
    mockData.set('fileLocks', { 'src/app.js': 'session-1' });
    const conflicts = checkFileLockConflicts(['src/app.js']);
    assert.deepStrictEqual(conflicts, [{ file: 'src/app.js', lockedBy: 'session-1' }]);
  });

  await t.test('checkFileLockConflicts detects path overlaps (directory locked)', () => {
    mockData.clear();
    mockData.set('fileLocks', { 'src/components': 'session-1' });
    const conflicts = checkFileLockConflicts(['src/components/Button.js']);
    assert.deepStrictEqual(conflicts, [{ file: 'src/components/Button.js', lockedBy: 'session-1' }]);
  });

  await t.test('checkFileLockConflicts detects path overlaps (file locked, directory requested)', () => {
    mockData.clear();
    mockData.set('fileLocks', { 'src/components/Button.js': 'session-1' });
    const conflicts = checkFileLockConflicts(['src/components']);
    assert.deepStrictEqual(conflicts, [{ file: 'src/components', lockedBy: 'session-1' }]);
  });

  await t.test('checkFileLockConflicts handles trailing slashes correctly', () => {
    mockData.clear();
    mockData.set('fileLocks', { 'src/components/': 'session-1' });
    const conflicts = checkFileLockConflicts(['src/components/Button.js']);
    assert.deepStrictEqual(conflicts, [{ file: 'src/components/Button.js', lockedBy: 'session-1' }]);
  });

  await t.test('checkFileLockConflicts ignores non-overlapping paths', () => {
    mockData.clear();
    mockData.set('fileLocks', { 'src/components1': 'session-1' });
    const conflicts = checkFileLockConflicts(['src/components11/Button.js']);
    assert.deepStrictEqual(conflicts, []);
  });

  await t.test('checkFileLockConflicts respects exact match for DOMAIN: keys', () => {
    mockData.clear();
    mockData.set('fileLocks', { 'DOMAIN:Billing': 'session-1' });

    // Exact match should conflict
    assert.deepStrictEqual(
      checkFileLockConflicts(['DOMAIN:Billing']),
      [{ file: 'DOMAIN:Billing', lockedBy: 'session-1' }]
    );

    // Prefix match should NOT conflict for DOMAIN
    assert.deepStrictEqual(
      checkFileLockConflicts(['DOMAIN:BillingService']),
      []
    );
  });

  await t.test('checkFileLockConflicts preserves "first found" behavior with multiple overlapping locks', () => {
    mockData.clear();
    // Insert locks in specific order.
    // In JS objects (and Conf), keys usually preserve insertion order for non-integer keys.
    const fileLocks = {};
    fileLocks['src/components'] = 'session-parent';
    fileLocks['src/components/Button.js'] = 'session-child';
    mockData.set('fileLocks', fileLocks);

    // If we request src/components/Button.js, it conflicts with BOTH.
    // It should return the one that came first in the locks object (session-parent).
    let conflicts = checkFileLockConflicts(['src/components/Button.js']);
    assert.deepStrictEqual(conflicts, [{ file: 'src/components/Button.js', lockedBy: 'session-parent' }]);

    // Reverse the order
    mockData.clear();
    const fileLocksRev = {};
    fileLocksRev['src/components/Button.js'] = 'session-child';
    fileLocksRev['src/components'] = 'session-parent';
    mockData.set('fileLocks', fileLocksRev);

    conflicts = checkFileLockConflicts(['src/components/Button.js']);
    assert.deepStrictEqual(conflicts, [{ file: 'src/components/Button.js', lockedBy: 'session-child' }]);

    // Test with directory requested, and multiple child locks
    mockData.clear();
    const fileLocksDir = {};
    fileLocksDir['src/components/Input.js'] = 'session-input';
    fileLocksDir['src/components/Button.js'] = 'session-button';
    mockData.set('fileLocks', fileLocksDir);

    conflicts = checkFileLockConflicts(['src/components']);
    assert.deepStrictEqual(conflicts, [{ file: 'src/components', lockedBy: 'session-input' }]);
  });
});

test('General State functions', async (t) => {
  const mockData = new Map();

  t.mock.method(store, 'get', (key, defaultValue) => {
    return mockData.has(key) ? mockData.get(key) : defaultValue;
  });

  t.mock.method(store, 'set', (key, value) => {
    mockData.set(key, value);
  });

  await t.test('getQueue returns empty array by default', () => {
    mockData.clear();
    assert.deepStrictEqual(getQueue(), []);
  });

  await t.test('setQueue and getQueue', () => {
    mockData.clear();
    setQueue([{ id: 'task-1' }]);
    assert.deepStrictEqual(getQueue(), [{ id: 'task-1' }]);
  });

  await t.test('getConfig returns empty object by default', () => {
    mockData.clear();
    assert.deepStrictEqual(getConfig(), {});
  });

  await t.test('setConfig and getConfig', () => {
    mockData.clear();
    setConfig('apiKey', 'test-key');
    assert.deepStrictEqual(getConfig(), { apiKey: 'test-key' });

    // Test updating an existing config
    setConfig('autoPr', true);
    assert.deepStrictEqual(getConfig(), { apiKey: 'test-key', autoPr: true });
  });

  await t.test('getArchitectureDiagrams returns empty array by default', () => {
    mockData.clear();
    assert.deepStrictEqual(getArchitectureDiagrams(), []);
  });

  await t.test('getArchitectureDiagrams returns stored value', () => {
    mockData.clear();
    mockData.set('architectureDiagrams', ['graph TD;']);
    assert.deepStrictEqual(getArchitectureDiagrams(), ['graph TD;']);
  });
});

