import test from 'node:test';
import assert from 'node:assert';

test('dispatchLeadOrchestrator suite', async (t) => {
  let createSessionPayload = null;
  let upsertSessionPayload = null;
  let currentConfig = { source: 'sources/github-owner-repo' };

  // Use the new t.mock.module capability
  t.mock.module('../state/store.js', {
    namedExports: {
      syncQuota: async () => {},
      getConfig: () => currentConfig,
      upsertSession: (data) => { upsertSessionPayload = data; },
      checkFileLockConflicts: () => [],
      getFileLocks: () => ({}),
      lockFiles: () => {},
      unlockFiles: () => {},
      getQueue: () => [],
      setQueue: () => {},
      getActiveSessions: () => [],
      getSessions: () => [],
      removeSession: () => {},
      getQuotaUsed: () => 0,
      getQuotaLimit: () => null,
      setQuotaLimit: () => {},
      quotaRemaining: () => null,
      getArchitectureDiagram: () => null,
      store: {},
      setConfig: () => {}
    }
  });

  t.mock.module('../state/jules-api.js', {
    namedExports: {
      createSession: async (payload) => {
        createSessionPayload = payload;
        return { id: 'mocked-session-id', name: 'sessions/mocked-session-id', state: 'QUEUED' };
      }
    }
  });

  const { dispatchLeadOrchestrator, handleOrchestratorToolCall } = await import('./julesorchestrator.js');

  t.afterEach(() => {
    createSessionPayload = null;
    upsertSessionPayload = null;
    currentConfig = { source: 'sources/github-owner-repo' };
  });

  await t.test('throws error if config.source is missing', async () => {
    currentConfig = {}; // Missing source

    await assert.rejects(
      async () => await dispatchLeadOrchestrator('Do a task'),
      /No source set\. Run: jorch config set-source sources\/github-owner-repo/
    );
  });

  await t.test('dispatches successfully and sends correct payload and tools to Jules API', async () => {
    const result = await dispatchLeadOrchestrator('Test user input task', 4, 'Test session');

    // Check return value
    assert.strictEqual(result.queued, false);
    assert.strictEqual(result.sessionId, 'mocked-session-id');

    // Check upsertSession was called with correct data
    assert.ok(upsertSessionPayload);
    assert.strictEqual(upsertSessionPayload.id, 'mocked-session-id');
    assert.strictEqual(upsertSessionPayload.type, 'orchestrator');
    assert.strictEqual(upsertSessionPayload.title, 'Test session');
    assert.strictEqual(upsertSessionPayload.repo, 'sources/github-owner-repo');

    // Check createSession was called with correct structure, effectively testing ORCHESTRATOR_TOOLS
    assert.ok(createSessionPayload);
    assert.strictEqual(createSessionPayload.source, 'sources/github-owner-repo');
    assert.strictEqual(createSessionPayload.requirePlanApproval, false);
    assert.ok(createSessionPayload.prompt.includes('Test user input task'));
    assert.ok(createSessionPayload.prompt.includes('Task Value: 4'));

    const tools = createSessionPayload.tools;
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);

    const toolNames = tools.map(tool => tool.function.name);
    assert.ok(toolNames.includes('dispatch_sub_agent'));
    assert.ok(toolNames.includes('kill_sub_agent'));
    assert.ok(toolNames.includes('generate_ink_terminal_diagram'));

    for (const tool of tools) {
      assert.strictEqual(tool.type, 'function');
      assert.ok(tool.function.name);
      assert.ok(tool.function.description);
      assert.ok(tool.function.parameters);
      assert.strictEqual(tool.function.parameters.type, 'object');
    }
  });

  await t.test('handleOrchestratorToolCall acts as a placeholder or returns correctly', async () => {
    assert.strictEqual(typeof handleOrchestratorToolCall, 'function');
  });
});
