import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import nock from 'nock';

import { store, upsertSession, getSessions, removeSession, setConfig, lockFiles, unlockFiles } from '../state/store.js';
import { handleOrchestratorToolCall } from './JulesTools.js';

describe('JulesTools.js handleOrchestratorToolCall', () => {

  before(() => {
    setConfig('apiKey', 'TEST_KEY');
    setConfig('source', 'test/repo');
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    for (const s of getSessions()) {
      removeSession(s.id);
    }
  });

  it('pause_sub_agent: upserts session with PAUSED state', async () => {
    upsertSession({ id: 'agent_123', type: 'sub_agent', state: 'IN_PROGRESS' });

    const res = await handleOrchestratorToolCall(
      { function: { name: 'pause_sub_agent', arguments: JSON.stringify({ agent_id: 'agent_123', reason: 'Testing' }) } },
      null
    );
    assert.strictEqual(res.status, 'success');

    const s = getSessions().find(x => x.id === 'agent_123');
    assert.strictEqual(s.state, 'PAUSED');
  });

  it('set_agent_dependency: upserts session with PAUSED and waitingOn', async () => {
    upsertSession({ id: 'agent_dep', type: 'sub_agent', state: 'IN_PROGRESS' });

    const res = await handleOrchestratorToolCall(
      { function: { name: 'set_agent_dependency', arguments: JSON.stringify({ dependent_agent_id: 'agent_dep', target_agent_id: 'agent_target' }) } },
      null
    );
    assert.strictEqual(res.status, 'success');

    const s = getSessions().find(x => x.id === 'agent_dep');
    assert.strictEqual(s.state, 'PAUSED');
    assert.strictEqual(s.waitingOn, 'agent_target');
  });

  it('create_shared_contract: writes a file without conflict', async () => {
    mock.method(fs, 'writeFileSync', mock.fn());

    const res = await handleOrchestratorToolCall(
      { function: { name: 'create_shared_contract', arguments: JSON.stringify({ contract_name: 'TEST_CONTRACT.md', initial_content: 'hello', allowed_agent_ids: [] }) } },
      null
    );

    assert.strictEqual(res.status, 'success');
    assert.ok(fs.writeFileSync.mock.calls.length > 0);
    assert.ok(fs.writeFileSync.mock.calls[0].arguments[0].endsWith('TEST_CONTRACT.md'));
    assert.strictEqual(fs.writeFileSync.mock.calls[0].arguments[1], 'hello');

    fs.writeFileSync.mock.restore();
  });

  it('create_shared_contract: fails if locked', async () => {
    const contractPath = path.join(process.cwd(), 'TEST_CONTRACT.md');
    lockFiles('other_agent', [contractPath]);

    const res = await handleOrchestratorToolCall(
      { function: { name: 'create_shared_contract', arguments: JSON.stringify({ contract_name: 'TEST_CONTRACT.md', initial_content: 'hello', allowed_agent_ids: [] }) } },
      null
    );

    assert.strictEqual(res.status, 'error');
    assert.ok(res.message.includes('locked'));

    unlockFiles('other_agent');
  });

  it('dispatch_sub_agent: dispatches sub agent using createSession API', async () => {
    nock('https://jules.googleapis.com')
      .post('/v1alpha/sessions')
      .reply(200, { name: 'sessions/mocked_sub_agent', id: 'mocked_sub_agent', state: 'QUEUED' });

    const res = await handleOrchestratorToolCall(
      { function: { name: 'dispatch_sub_agent', arguments: JSON.stringify({ module_name: 'Test Mod', instructions: 'Do it' }) } },
      'orch_123'
    );

    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.session_id, 'mocked_sub_agent');
    const s = getSessions().find(x => x.id === 'mocked_sub_agent');
    assert.ok(s);
  });

  it('merge_branches: dispatches Merge Agent using createSession API', async () => {
    nock('https://jules.googleapis.com')
      .post('/v1alpha/sessions')
      .reply(200, { name: 'sessions/merge_agent', id: 'merge_agent', state: 'QUEUED' });

    const res = await handleOrchestratorToolCall(
      { function: { name: 'merge_branches', arguments: JSON.stringify({ base_branch: 'main', branches_to_merge: ['b1', 'b2'] }) } },
      'orch_123'
    );

    assert.strictEqual(res.status, 'success');
    const s = getSessions().find(x => x.id === 'merge_agent');
    assert.ok(s);
  });

  it('kill_sub_agent: kills sub agent using DELETE API', async () => {
    upsertSession({ id: 'agent_to_kill', type: 'sub_agent', state: 'IN_PROGRESS' });

    nock('https://jules.googleapis.com')
      .delete('/v1alpha/sessions/agent_to_kill')
      .reply(200, { id: 'agent_to_kill' });

    const res = await handleOrchestratorToolCall(
      { function: { name: 'kill_sub_agent', arguments: JSON.stringify({ agent_id: 'agent_to_kill', reason: 'Testing' }) } },
      null
    );

    assert.strictEqual(res.status, 'success');
    const s = getSessions().find(x => x.id === 'agent_to_kill');
    assert.strictEqual(s.state, 'KILLED');
  });

  it('reassign_module: reassigns sub agent using sendMessage API', async () => {
    nock('https://jules.googleapis.com')
      .post('/v1alpha/sessions/agent_to_reassign:sendMessage')
      .reply(200, {});

    const res = await handleOrchestratorToolCall(
      { function: { name: 'reassign_module', arguments: JSON.stringify({ agent_id: 'agent_to_reassign', new_instructions: 'New task' }) } },
      null
    );

    assert.strictEqual(res.status, 'success');
  });

  it('broadcast_update: sends message to all active agents using sendMessage API', async () => {
    upsertSession({ id: 'agent_a', type: 'sub_agent', state: 'IN_PROGRESS' });
    upsertSession({ id: 'agent_b', type: 'sub_agent', state: 'IN_PROGRESS' });

    nock('https://jules.googleapis.com')
      .post('/v1alpha/sessions/agent_a:sendMessage')
      .reply(200, {})
      .post('/v1alpha/sessions/agent_b:sendMessage')
      .reply(200, {});

    const res = await handleOrchestratorToolCall(
      { function: { name: 'broadcast_update', arguments: JSON.stringify({ message: 'Hello' }) } },
      null
    );

    assert.strictEqual(res.status, 'success');
    assert.ok(res.message.includes('Broadcast sent to 2 active sessions.'));
  });

  it('generate_ink_terminal_diagram: stores the diagram in config', async () => {
    const args = { title: 'TUI', nodes: ['A'], connections: [] };
    const res = await handleOrchestratorToolCall(
      { function: { name: 'generate_ink_terminal_diagram', arguments: JSON.stringify(args) } },
      null
    );

    assert.strictEqual(res.status, 'success');
    assert.ok(res.message.includes('Diagram generated'));
  });
});
