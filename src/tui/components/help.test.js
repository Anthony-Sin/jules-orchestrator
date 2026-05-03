import test from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render } from 'ink-testing-library';
import { HelpScreen } from './help.js';

test('HelpScreen renders correctly with keybindings', () => {
  const { lastFrame } = render(React.createElement(HelpScreen));
  const output = lastFrame();

  assert.ok(output, 'Output should not be empty');
  assert.ok(output.includes('JULES COLONY: QUICK REFERENCE'), 'Should contain the main title');

  // Verify a few keybindings exist in the output
  assert.ok(output.includes('Alt + T'), 'Should contain Alt + T keybinding');
  assert.ok(output.includes('Focus Table Mode'), 'Should contain Focus Table Mode description');

  assert.ok(output.includes('Alt + G'), 'Should contain Alt + G keybinding');
  assert.ok(output.includes('Focus Graph'), 'Should contain Focus Graph description');

  assert.ok(output.includes('Alt + ?'), 'Should contain Alt + ? keybinding');
});
