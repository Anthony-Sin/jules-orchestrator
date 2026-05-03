import test from 'node:test';
import assert from 'node:assert';
import { useDashboardController } from './dashboard-controller.js';
import * as reactMock from 'react';

// The mocked modules are now intercepted entirely by the loader, so we can just import them and rely on globalThis to configure/inspect their behavior.
// We only import them here to be able to use the same exported objects to mock specific properties if needed.
import * as storeModule from '../state/store.js';
import * as julesApi from '../state/jules-api.js';
import * as orchestrator from '../jules_lead_orchestrator/julesorchestrator.js';

test('useDashboardController initial state', (t) => {
  t.mock.method(storeModule.store, 'get', (key, def) => {
      if (key === 'architectureDiagrams') return [];
      if (key === 'tuiNotes') return 'test notes';
      if (key === 'diagramLastUpdated') return 0;
      return def;
  });

  reactMock.resetReactMocks();
  const ctrl = useDashboardController();

  assert.strictEqual(ctrl.mode, 'table');
  assert.strictEqual(ctrl.chatInput, '');
  assert.strictEqual(ctrl.notes, 'test notes');
  assert.strictEqual(ctrl.chatTargetMode, 'CREATE_ORCHESTRATOR');
  assert.strictEqual(ctrl.showGraph, false);
});

test('useDashboardController basic state updates', (t) => {
  reactMock.resetReactMocks();
  const ctrl = useDashboardController();

  ctrl.setMode('chat');
  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();
  assert.strictEqual(ctrl2.mode, 'chat');

  ctrl2.setChatInput('hello');
  reactMock.resetReactMocksForRender();
  const ctrl3 = useDashboardController();
  assert.strictEqual(ctrl3.chatInput, 'hello');
});

test('useDashboardController handleRepoSubmit', (t) => {
  let savedConfigKey, savedConfigVal;
  globalThis.onSetConfig = (k, v) => {
    savedConfigKey = k;
    savedConfigVal = v;
  };

  reactMock.resetReactMocks();
  const ctrl = useDashboardController();

  ctrl.handleRepoSubmit('my-new-repo');

  assert.strictEqual(savedConfigKey, 'source');
  assert.strictEqual(savedConfigVal, 'my-new-repo');

  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();
  assert.strictEqual(ctrl2.repoInputMode, false);
});

test('useDashboardController handleSend missing repo', async (t) => {
  reactMock.resetReactMocks();
  const ctrl = useDashboardController();

  globalThis.mockConfig = { source: 'NOT SET' };
  await ctrl.handleSend('test message');

  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();

  assert.strictEqual(ctrl2.messages.length, 1);
  assert.strictEqual(ctrl2.messages[0].role, 'system');
  assert.match(ctrl2.messages[0].text, /Error: No repo selected/);
  assert.strictEqual(ctrl2.chatInput, '');
});

test('useDashboardController handleSend create orchestrator', async (t) => {
  reactMock.resetReactMocks();
  globalThis.mockConfig = { source: 'my-repo' };

  let dispatchCalledWith = null;
  globalThis.onDispatchLeadOrchestrator = (msg, count, desc) => {
    dispatchCalledWith = msg;
    return { sessionId: 'test-session-xyz' };
  };

  const ctrl = useDashboardController();
  ctrl.setChatTargetMode('CREATE_ORCHESTRATOR');
  reactMock.resetReactMocksForRender();
  const ctrl1 = useDashboardController();

  await ctrl1.handleSend('please do this task');

  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();

  assert.strictEqual(dispatchCalledWith, 'please do this task');
  assert.strictEqual(ctrl2.selectedSessionId, 'test-session-xyz');
  assert.strictEqual(ctrl2.chatTargetMode, 'TALK_TO_SELECTED_AGENT');
});

test('useDashboardController toggleExpand', (t) => {
  reactMock.resetReactMocks();
  const ctrl = useDashboardController();

  ctrl.toggleExpand('id-123');
  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();

  assert.strictEqual(ctrl2.expandedIds.has('id-123'), true);

  ctrl2.toggleExpand('id-123');
  reactMock.resetReactMocksForRender();
  const ctrl3 = useDashboardController();

  assert.strictEqual(ctrl3.expandedIds.has('id-123'), false);
});

test('useDashboardController handleSend to agent in progress', async (t) => {
  reactMock.resetReactMocks();
  globalThis.mockConfig = { source: 'my-repo' };
  globalThis.mockSessions = [{ id: 'agent-123', state: 'IN_PROGRESS' }];

  const ctrl = useDashboardController();

  ctrl.setSelectedSessionId('agent-123');
  ctrl.setChatTargetMode('TALK_TO_SELECTED_AGENT');
  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();

  await ctrl2.handleSend('test message queuing');

  reactMock.resetReactMocksForRender();
  const ctrl3 = useDashboardController();

  assert.strictEqual(ctrl3.queuedMessages['agent-123'], 'test message queuing');
  assert.strictEqual(ctrl3.messages.length, 1);
  assert.match(ctrl3.messages[0].text, /Message queued/);
});

test('useDashboardController handleSend to agent approve plan', async (t) => {
  reactMock.resetReactMocks();
  globalThis.mockConfig = { source: 'my-repo' };
  globalThis.mockSessions = [{ id: 'agent-123', state: 'AWAITING_USER_INPUT' }];

  let approvedId = null;
  globalThis.onApprovePlan = (id) => { approvedId = id; };

  const ctrl = useDashboardController();

  ctrl.setSelectedSessionId('agent-123');
  ctrl.setChatTargetMode('TALK_TO_SELECTED_AGENT');
  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();

  await ctrl2.handleSend('/approve');

  assert.strictEqual(approvedId, 'agent-123');
});

test('useDashboardController handleSend to agent regular message', async (t) => {
  reactMock.resetReactMocks();
  globalThis.mockConfig = { source: 'my-repo' };
  globalThis.mockSessions = [{ id: 'agent-123', state: 'AWAITING_USER_INPUT' }];

  let sentId = null;
  let sentMsg = null;
  globalThis.onSendMessage = (id, msg) => {
    sentId = id;
    sentMsg = msg;
  };

  const ctrl = useDashboardController();

  ctrl.setSelectedSessionId('agent-123');
  ctrl.setChatTargetMode('TALK_TO_SELECTED_AGENT');
  reactMock.resetReactMocksForRender();
  const ctrl2 = useDashboardController();

  await ctrl2.handleSend('Hello Agent');

  assert.strictEqual(sentId, 'agent-123');
  assert.strictEqual(sentMsg, 'Hello Agent');
});
