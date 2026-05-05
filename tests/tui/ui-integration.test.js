import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'events';

// =====================================================================
// 1. MOCK DEPENDENCIES (Must happen before component imports)
// =====================================================================
const mockGetAllActivities = mock.fn();

mock.module('../../src/state/jules-api.js', {
  namedExports: {
    getAllActivities: mockGetAllActivities,
    // Add this mock so table.js doesn't crash when it tries to format the repo name
    parseSourceDisplay: (str) => str ? str.replace('sources/github/', '') : str,
  },
});

const mockSpawn = mock.fn();
mock.module('child_process', {
  namedExports: {
    spawn: mockSpawn
  }
});

// =====================================================================
// 2. DYNAMIC IMPORTS
// =====================================================================
const { ChatPanel } = await import('../../src/tui/components/chat.js');
const { GitDiffViewer } = await import('../../src/tui/components/gitdiff.js');
const { Notepad } = await import('../../src/tui/components/notepad.js');
const { ago, STATUS_COLOR, STATUS_SHORT, buildRows, AgentRow, SubAgentRow } = await import('../../src/tui/components/table.js');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =====================================================================
// 3. THE MEGA SUITE
// =====================================================================
describe('TUI Mega Integration Suite', () => {

  // -------------------------------------------------------------------
  // TABLE & UTILS
  // -------------------------------------------------------------------
  describe('Table Components & Utilities', () => {
    test('ago utility formats time correctly', (t) => {
      const now = Date.now();
      t.mock.method(Date, 'now', () => now);

      assert.strictEqual(ago(undefined), '--');
      assert.strictEqual(ago(now - 1000), 'now');
      assert.strictEqual(ago(now - 10000), '10s');
      assert.strictEqual(ago(now - 120000), '2m');
      assert.strictEqual(ago(now - 7200000), '2h');
    });

    test('buildRows accurately maps hierarchy', () => {
      const sessions = [
        { id: '1', title: 'Agent 1', isOrchestrator: false },
        { id: '2', title: 'Orchestrator 1', isOrchestrator: true, subAgents: [{ id: 'sub1' }] }
      ];
      const expandedIds = new Set(['2']);
      const rows = buildRows(sessions, expandedIds);

      assert.strictEqual(rows.length, 3);
      assert.strictEqual(rows[0].data.id, '1');
      assert.strictEqual(rows[1].data.id, '2');
      assert.strictEqual(rows[1].expanded, true);
      assert.strictEqual(rows[2].type, 'sub');
      assert.strictEqual(rows[2].data.id, 'sub1');
    });

    test('AgentRow renders without crashing (No FillBar)', () => {
      const agent = { id: 'abc12345', state: 'COMPLETED', title: 'TestAgent', repo: 'github/test/repo' };
      const { lastFrame } = render(React.createElement(AgentRow, { agent, selected: false, tick: 0, isDimmed: false, expanded: false }));
      const output = lastFrame();
      
      assert.match(output, /abc123/);
      assert.match(output, /TestAgent/);
      assert.match(output, /DONE/); // Mapped from STATUS_SHORT
    });
  });

  // -------------------------------------------------------------------
  // CHAT PANEL
  // -------------------------------------------------------------------
  describe('ChatPanel Component', () => {
    test('renders NOT SET state', () => {
      const props = {
        input: '', chatVisibleRows: 10, width: 80,
        repoName: "NOT SET", tab: "chat", focused: true,
        messages: []
      };
      const { lastFrame } = render(React.createElement(ChatPanel, props));
      const frame = lastFrame();

      assert(frame.includes('[SYSTEM]'), 'Should contain [SYSTEM] label');
      assert(frame.includes('Select a repository'), 'Should prompt to select a repo');
    });

    test('renders NEW TASK state (Updated Text)', () => {
      const props = {
        input: '', chatVisibleRows: 10, width: 80,
        repoName: "dummy_repo", tab: "chat", focused: true,
        chatTargetMode: "CREATE_TASK", messages: [],
        startDialogOpen: true // Triggers the empty state UI
      };
      const { lastFrame } = render(React.createElement(ChatPanel, props));
      const frame = lastFrame();

      // Accounts for your updated "✦ START NEW TASK" UI
      assert(frame.includes('✦ START NEW TASK'), 'Should contain updated START NEW TASK text');
    });
  });

  // -------------------------------------------------------------------
  // GIT DIFF VIEWER
  // -------------------------------------------------------------------
  describe('GitDiffViewer Component', () => {
    test('renders parsed diff state properly (Updated Arrow)', async () => {
      mockGetAllActivities.mock.resetCalls();

      const mockDiffString = `Index: src/test.js
===================================================================
--- src/test.js
+++ src/test.js
@@ -1,2 +1,2 @@
 console.log("hello")
-console.log("old")
+console.log("world")`;

      const mockActivity = {
        createTime: new Date().toISOString(),
        artifacts: [{ changeSet: { gitPatch: { unidiffPatch: mockDiffString } } }]
      };

      mockGetAllActivities.mock.mockImplementation(() => Promise.resolve({ activities: [mockActivity] }));

      const { lastFrame } = render(React.createElement(GitDiffViewer, {
        sessionId: 'test-session', width: 100, height: 24, fileSel: 0, diffFocus: 'files', setDiffFileSel: () => {}
      }));

      await delay(20); // Wait for async parsing
      const frame = lastFrame();

      // Accounts for your updated ASCII arrow
      assert.match(frame, /FILE src\/test\.js -> src\/test\.js/);
      // Removed the \+ and \- because your UI is a side-by-side diff!
      assert.match(frame, /console\.log\("world"\)/); 
      assert.match(frame, /console\.log\("old"\)/);
    });
  });

  // -------------------------------------------------------------------
  // NOTEPAD (CURSOR STARTS AT END OF STRING)
  // -------------------------------------------------------------------
  describe('Notepad Component', () => {
    
    function TestWrapper({ initialValue = 'hi' }) {
      const [val, setVal] = useState(initialValue);
      return React.createElement(Notepad, {
        value: val,
        onChange: setVal,
        width: 20,
        height: 5
      });
    }

    test('types characters at the end of the text', async () => {
      const { stdin, lastFrame } = render(React.createElement(TestWrapper, { initialValue: 'hi' }));
      
      // Cursor starts at index 2 (end of 'hi'). Typing '!' makes it 'hi!'
      stdin.write('!');
      await delay(50);
      
      const frame = lastFrame();
      assert.ok(frame.includes('hi!'));
    });

    test('handles return key to split line from the end', async () => {
      const { stdin, lastFrame } = render(React.createElement(TestWrapper, { initialValue: 'hi' }));
      
      // Cursor starts at end. Return key adds \n at the end.
      stdin.write('\r'); 
      await delay(50);
      
      // We type 'there' on the new line to prove it split
      stdin.write('there');
      await delay(50);

      const frame = lastFrame();
      assert.ok(frame.includes('hi'));
      assert.ok(frame.includes('there'));
    });

    test('handles backspace to delete character and merge lines', async () => {
      const { stdin, lastFrame } = render(React.createElement(TestWrapper, { initialValue: 'a\nb' }));
      
      // Length is 3. Cursor starts at 3 (end of 'b').
      // First backspace deletes 'b' -> 'a\n'
      stdin.write('\x08');
      await delay(20);
      
      // Second backspace deletes '\n' -> 'a' (Lines merged!)
      stdin.write('\x08');
      await delay(20);
      
      // Type 'X' to prove we are on the merged line
      stdin.write('X');
      await delay(20);

      const frame = lastFrame();
      assert.ok(frame.includes('aX'));
    });

    test('scroll offset adjusts when cursor moves beyond visible height', async () => {
      // Changed to letters so "10" doesn't accidentally trigger the "1" check!
      const longText = 'LineA\nLineB\nLineC\nLineD\nLineE\nLineF\nLineG\nLineH\nLineI\nLineJ';
      const { lastFrame } = render(React.createElement(Notepad, {
        value: longText,
        onChange: () => {},
        height: 3, // Tiny height
        width: 20
      }));

      await delay(50);
      const frame = lastFrame();
      
      // Because cursor initializes at the END of the string (LineJ), 
      // the camera should auto-pan to the bottom immediately.
      assert.ok(!frame.includes('LineA'));
      assert.ok(!frame.includes('LineE'));
      assert.ok(frame.includes('LineH'));
      assert.ok(frame.includes('LineI'));
      assert.ok(frame.includes('LineJ'));
    });
  });
});