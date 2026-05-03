import test from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render } from 'ink-testing-library';
import { ago, STATUS_COLOR, STATUS_SHORT, buildRows, FillBar, AgentRow, SubAgentRow } from './table.js';

test('ago', (t) => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);

  assert.strictEqual(ago(undefined), '--');
  assert.strictEqual(ago(now - 1000), 'now');
  assert.strictEqual(ago(now - 10000), '10s');
  assert.strictEqual(ago(now - 120000), '2m');
  assert.strictEqual(ago(now - 7200000), '2h');
  assert.strictEqual(ago(now - 172800000), '2d');
});

test('buildRows', () => {
  const sessions = [
    { id: '1', title: 'Agent 1', isOrchestrator: false },
    { id: '2', title: 'Orchestrator 1', isOrchestrator: true, subAgents: [{ id: 'sub1' }] },
    { id: '3', title: 'Orchestrator 2', isOrchestrator: true, subAgents: [] }
  ];

  const expandedIds = new Set(['2', '3']);
  const rows = buildRows(sessions, expandedIds);

  assert.strictEqual(rows.length, 5);

  // First item: Agent 1 (not expanded)
  assert.strictEqual(rows[0].type, 'session');
  assert.strictEqual(rows[0].data.id, '1');
  assert.strictEqual(rows[0].orch, false);
  assert.strictEqual(rows[0].expanded, false);

  // Second item: Orchestrator 1 (expanded)
  assert.strictEqual(rows[1].type, 'session');
  assert.strictEqual(rows[1].data.id, '2');
  assert.strictEqual(rows[1].orch, true);
  assert.strictEqual(rows[1].expanded, true);

  // Third item: sub1
  assert.strictEqual(rows[2].type, 'sub');
  assert.strictEqual(rows[2].data.id, 'sub1');
  assert.strictEqual(rows[2].isLast, true);

  // Fourth item: Orchestrator 2 (expanded)
  assert.strictEqual(rows[3].type, 'session');
  assert.strictEqual(rows[3].data.id, '3');
  assert.strictEqual(rows[3].orch, true);
  assert.strictEqual(rows[3].expanded, true);

  // Fifth item: empty subagents
  assert.strictEqual(rows[4].type, 'empty');
  assert.strictEqual(rows[4].parentId, '3');
});

test('STATUS_COLOR and STATUS_SHORT', () => {
  assert.strictEqual(STATUS_COLOR.COMPLETED, 'greenBright');
  assert.strictEqual(STATUS_SHORT.IN_PROGRESS, 'ACTIVE');
});

test('FillBar', () => {
  const { lastFrame: lastFrameCompleted } = render(React.createElement(FillBar, { state: 'COMPLETED', width: 5 }));
  assert.match(lastFrameCompleted(), /100%/);

  const { lastFrame: lastFrameInProgress } = render(React.createElement(FillBar, { state: 'IN_PROGRESS', width: 5, tick: 0 }));
  assert.match(lastFrameInProgress(), /\.\.\./);
});

test('AgentRow', () => {
  const agent = { id: 'abc12345', state: 'COMPLETED', title: 'TestAgent', repo: 'github/test/repo' };
  const { lastFrame } = render(React.createElement(AgentRow, { agent, selected: false, tick: 0, isDimmed: false, expanded: false }));
  const output = lastFrame();
  assert.match(output, /abc123/);
  assert.match(output, /TestAgent/);
  assert.match(output, /DONE/);
  assert.match(output, /test/); // the regex matches because parseSourceDisplay strips the github part
});

test('SubAgentRow', () => {
  const agent = { id: 'def567', state: 'IN_PROGRESS', role: 'Tester', repo: 'github/test/repo' };
  const { lastFrame } = render(React.createElement(SubAgentRow, { agent, tick: 0, isLast: true }));
  const output = lastFrame();
  assert.match(output, /def5/); // ID is truncated sometimes
  assert.match(output, /Tester/);
  assert.match(output, /ACTIVE/);
  assert.match(output, /test/);
});
