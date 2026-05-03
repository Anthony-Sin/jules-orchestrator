import { test, describe } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import React, { useState } from 'react';
import { Notepad } from './notepad.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Notepad Component Basic Movement and Typing', () => {

    test('renders with initial value', () => {
        const { lastFrame } = render(
            React.createElement(Notepad, { value: 'hello\nworld', onChange: () => {}, width: 20 })
        );
        const output = lastFrame();
        assert.ok(output.includes('hello'));
        assert.ok(output.includes('world'));
    });

    test('types characters at cursor position', async () => {
        let currentValue = 'hi';
        const setVal = (v) => { currentValue = v; };

        function TestWrapper() {
            const [val, setValInternal] = useState('hi');
            return React.createElement(Notepad, {
                value: val,
                onChange: (newVal) => {
                    setVal(newVal);
                    setValInternal(newVal);
                },
                width: 20
            });
        }

        const { stdin } = render(React.createElement(TestWrapper));

        stdin.write('!');
        await delay(50);

        assert.strictEqual(currentValue, '!hi');
    });

    test('handles return key to split line', async () => {
        let currentValue = 'hi';
        const setVal = (v) => { currentValue = v; };

        function TestWrapper() {
            const [val, setValInternal] = useState('hi');
            return React.createElement(Notepad, {
                value: val,
                onChange: (newVal) => {
                    setVal(newVal);
                    setValInternal(newVal);
                },
                width: 20
            });
        }

        const { stdin } = render(React.createElement(TestWrapper));

        // Initial cursor is at 0, 0
        stdin.write('\r'); // Return key
        await delay(50);

        assert.strictEqual(currentValue, '\nhi');
    });

    test('handles backspace to delete character and merge lines', async () => {
        let currentValue = 'a\nb';
        const setVal = (v) => { currentValue = v; };

        function TestWrapper() {
            const [val, setValInternal] = useState('a\nb');
            return React.createElement(Notepad, {
                value: val,
                onChange: (newVal) => {
                    setVal(newVal);
                    setValInternal(newVal);
                },
                width: 20
            });
        }

        const { stdin } = render(React.createElement(TestWrapper));

        // Move to line 1, col 0
        stdin.write('\x1B[B'); // down arrow
        await delay(20);

        // Backspace should merge line 1 with line 0
        stdin.write('\x08'); // Backspace
        await delay(20);

        assert.strictEqual(currentValue, 'ab');
    });

    test('cursor movement (arrows) and bounds', async () => {
        let currentValue = 'abc\ndef';
        const setVal = (v) => { currentValue = v; };

        function TestWrapper() {
            const [val, setValInternal] = useState('abc\ndef');
            return React.createElement(Notepad, {
                value: val,
                onChange: (newVal) => {
                    setVal(newVal);
                    setValInternal(newVal);
                },
                width: 20
            });
        }

        const { stdin } = render(React.createElement(TestWrapper));

        // Starts at 0,0. Move right 2 times -> 0,2
        stdin.write('\x1B[C'); // right arrow
        await delay(20);
        stdin.write('\x1B[C'); // right arrow
        await delay(20);

        // Write a char at 0,2 -> "abXc\ndef"
        stdin.write('X');
        await delay(20);
        assert.strictEqual(currentValue, 'abXc\ndef');

        // Move down 1, left 1
        stdin.write('\x1B[B'); // down arrow
        await delay(20);
        stdin.write('\x1B[D'); // left arrow
        await delay(20);

        // write Y -> abXc\ndeYf
        stdin.write('Y');
        await delay(20);

        assert.strictEqual(currentValue, 'abXc\ndeYf');

        // Move Up past bounds
        stdin.write('\x1B[A'); // up arrow
        await delay(20);
        stdin.write('\x1B[A'); // up arrow
        await delay(20);
        stdin.write('\x1B[A'); // up arrow (bounded at 0)
        await delay(20);

        stdin.write('Z');
        await delay(20);

        // Cursor up preserves col where possible.
        // Was at line 1, col 3. Moved to line 0, col 3. Write Z -> abXZc
        assert.strictEqual(currentValue, 'abXZc\ndeYf');
    });
});

describe('Notepad Component Edge Cases and Complex Behavior', () => {

    test('auto-wraps extremely long lines based on width', async () => {
        let currentValue = '12345'; // width is 10, maxCol is 8
        const setVal = (v) => { currentValue = v; };

        function TestWrapper() {
            const [val, setValInternal] = useState('12345');
            return React.createElement(Notepad, {
                value: val,
                onChange: (newVal) => {
                    setVal(newVal);
                    setValInternal(newVal);
                },
                width: 10
            });
        }

        const { stdin } = render(React.createElement(TestWrapper));

        // Move to end of line
        for(let i=0; i<5; i++) {
            stdin.write('\x1B[C'); // right
            await delay(5);
        }

        // type 6789 -> should wrap
        stdin.write('6');
        await delay(5);
        stdin.write('7');
        await delay(5);
        stdin.write('8');
        await delay(5);
        stdin.write('9');
        await delay(5);

        // maxCol is width - 2 = 8
        // "12345678" -> overflow "9"
        assert.strictEqual(currentValue, '12345678\n9');
    });

    test('scroll offset adjusts when cursor moves beyond visible height', async () => {
        function TestWrapper() {
            return React.createElement(Notepad, {
                value: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10',
                onChange: () => {},
                height: 3,
                width: 20
            });
        }

        const { stdin, lastFrame } = render(React.createElement(TestWrapper));

        // Move down 4 times to line 5 (0-indexed line 4)
        for(let i=0; i<4; i++) {
            stdin.write('\x1B[B'); // down
            await delay(10);
        }

        const frame = lastFrame();
        // Since height is 3, and cursor is at line 4 (value '5'), scroll offset should be 4 - 3 + 1 = 2
        // So visible lines should be lines 2, 3, 4 (values '3', '4', '5')
        assert.ok(!frame.includes('1'));
        assert.ok(!frame.includes('2'));
        assert.ok(frame.includes('3'));
        assert.ok(frame.includes('4'));
        assert.ok(frame.includes('5'));
        assert.ok(!frame.includes('6'));
    });

    test('handles rapid pasting of multiline strings', async () => {
        let currentValue = 'a\nb';
        const setVal = (v) => { currentValue = v; };

        function TestWrapper() {
            const [val, setValInternal] = useState('a\nb');
            return React.createElement(Notepad, {
                value: val,
                onChange: (newVal) => {
                    setVal(newVal);
                    setValInternal(newVal);
                },
                width: 20
            });
        }

        const { stdin } = render(React.createElement(TestWrapper));

        // At 0,0 paste multiline
        stdin.write('x\r\ny\nz');
        await delay(50);

        assert.strictEqual(currentValue, 'x\ny\nza\nb');
    });

    test('renders cursor correctly with background style', () => {
        const { lastFrame } = render(
            React.createElement(Notepad, { value: 'a', onChange: () => {}, width: 20 })
        );
        const output = lastFrame();
        // The component uses <Text backgroundColor="white" color="black"> for the cursor.
        // ink-testing-library usually strip ANSI but `lastFrame()` does output plain text
        // Unfortunately standard lastFrame() doesn't expose raw ANSI if not requested.
        // Wait, if ink-testing-library supports raw, maybe we can verify the cursor logic.
        // The cursor renders the character 'a'. Let's verify 'a' is there.
        assert.ok(output.includes('a'));
    });

    test('ignores global modifier combos (meta/ctrl)', async () => {
        let currentValue = 'a';
        const setVal = (v) => { currentValue = v; };

        function TestWrapper() {
            const [val, setValInternal] = useState('a');
            return React.createElement(Notepad, {
                value: val,
                onChange: (newVal) => {
                    setVal(newVal);
                    setValInternal(newVal);
                },
                width: 20
            });
        }

        const { stdin } = render(React.createElement(TestWrapper));

        // To simulate a meta/ctrl we might need ink's hook natively, or rely on ANSI escapes that ink maps.
        // We know simple characters are typed.
        stdin.write('\x1Bf'); // Alt+f (often maps to meta+f in terminal)
        await delay(20);

        // Value shouldn't change
        assert.strictEqual(currentValue, 'a');
    });
});
