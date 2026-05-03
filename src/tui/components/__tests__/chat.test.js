import React from 'react';
import { render } from 'ink-testing-library';
import test from 'node:test';
import assert from 'node:assert';
import { ChatPanel } from '../chat.js';

test('ChatPanel Component', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

    await t.test('renders NOT SET state', () => {
        const props = {
            input: '', chatVisibleRows: 10, width: 80,
            repoName: "NOT SET", tab: "chat", focused: true,
            messages: []
        };
        const c = React.createElement(ChatPanel, props);
        const { lastFrame } = render(c);
        const frame = lastFrame();

        assert(frame.includes('[SYSTEM]'), 'Should contain [SYSTEM] label');
        assert(frame.includes('Select a repository'), 'Should prompt to select a repo');
    });

    await t.test('renders NEW SESSION state', () => {
        const props = {
            input: '', chatVisibleRows: 10, width: 80,
            repoName: "dummy_repo", tab: "chat", focused: true,
            chatTargetMode: "CREATE_ORCHESTRATOR", messages: []
        };
        const c = React.createElement(ChatPanel, props);
        const { lastFrame } = render(c);
        const frame = lastFrame();

        assert(frame.includes('NEW SESSION'), 'Should contain NEW SESSION text');
        assert(frame.includes('fresh orchestrator agent'), 'Should contain text about fresh agent');
    });

    await t.test('renders normal chat view with messages', () => {
        const props = {
            input: '', chatVisibleRows: 10, width: 80,
            repoName: "dummy_repo", agentTitle: "Test Agent", tab: "chat", focused: true,
            messages: [
                { role: 'agent', text: 'Hello from agent' },
                { role: 'user', text: 'Hello from user' }
            ]
        };
        const c = React.createElement(ChatPanel, props);
        const { lastFrame } = render(c);
        const frame = lastFrame();

        assert(frame.includes('Test Agent'), 'Should contain agent title in header');
        assert(frame.includes('Hello from agent'), 'Should contain agent message');
        assert(frame.includes('you'), 'Should contain user label');
        assert(frame.includes('Hello from user'), 'Should contain user message');
    });

    await t.test('handles user navigation interactions', () => {
        let chatCursorLine = 0;
        const setChatCursorLine = (val) => {
            if (typeof val === 'function') chatCursorLine = val(chatCursorLine);
            else chatCursorLine = val;
        };

        const props = {
            input: '', chatVisibleRows: 10, width: 80,
            repoName: "dummy_repo", tab: "chat", focused: true,
            messages: [
                { role: 'agent', text: 'Msg 1' },
                { role: 'agent', text: 'Msg 2' }
            ],
            chatCursorLine, setChatCursorLine,
            onChange: () => {}, onSubmit: () => {}
        };

        const c = React.createElement(ChatPanel, props);
        const { stdin } = render(c);

        // Use up arrow to navigate messages
        stdin.write('\u001B[A');

        assert.strictEqual(chatCursorLine, 1, 'Cursor line should increment on Up Arrow');

        // Use down arrow to navigate back
        stdin.write('\u001B[B');

        assert.strictEqual(chatCursorLine, 0, 'Cursor line should decrement on Down Arrow');
    });

    await t.test('handles message expansion interaction', () => {
        let toggledMsgIdx = -1;
        const toggleMessageExpand = (idx) => {
            toggledMsgIdx = idx;
        };

        const props = {
            input: '', chatVisibleRows: 10, width: 80,
            repoName: "dummy_repo", tab: "chat", focused: true,
            messages: [
                { role: 'agent', text: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6' }
            ],
            expandedMessages: new Set(),
            chatCursorLine: 0,
            toggleMessageExpand,
            onChange: () => {}, onSubmit: () => {}
        };

        const c = React.createElement(ChatPanel, props);
        const { stdin } = render(c);

        // Target index in "allLines" array logic requires cursor math.
        // It's calculated roughly based on total lines minus cursor.
        // If we trigger Meta+A we should capture toggleMessageExpand

        stdin.write('\x1Ba'); // Alt+A in terminals is often Escape then 'a', or Meta+a

        // Depending on precise index, toggledMsgIdx should be called.
        // We know it's at least greater than or equal to 0 since there's one message.
        assert.strictEqual(toggledMsgIdx, 0, 'toggleMessageExpand should be called for the selected message');
    });

    await t.test('respects scroll offset updates', () => {
        let newScrollOffset = -1;
        const setScrollOffset = (val) => { newScrollOffset = val; };

        // Make chatVisibleRows very small so scrolling is forced
        const props = {
            input: '', chatVisibleRows: 2, width: 80,
            repoName: "dummy_repo", tab: "chat", focused: true,
            messages: [
                { role: 'agent', text: 'Msg 1' },
                { role: 'agent', text: 'Msg 2' },
                { role: 'agent', text: 'Msg 3' },
                { role: 'agent', text: 'Msg 4' }
            ],
            chatCursorLine: 10, // Force a large cursor line to trigger scroll logic
            setScrollOffset
        };

        const c = React.createElement(ChatPanel, props);
        render(c);

        assert(newScrollOffset > 0, 'Scroll offset should be updated when cursor goes out of bounds');
    });
});
