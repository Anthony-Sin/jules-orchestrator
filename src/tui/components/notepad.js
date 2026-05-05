import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Dynamically calculates visual lines on the fly without mangling the original text
function buildWrappedLines(value, width) {
  const safeWidth = Math.max(1, width);
  const lines = [''];
  for (const ch of String(value || '')) {
    if (ch === '\n') {
      lines.push('');
      continue;
    }
    const lastIdx = lines.length - 1;
    if (lines[lastIdx].length >= safeWidth) {
      lines.push(ch);
    } else {
      lines[lastIdx] += ch;
    }
  }
  return lines;
}

// Maps a 1D string index into a 2D visual coordinate
function getCursorPos(value, cursorOffset, width) {
  const safeWidth = Math.max(1, width);
  const safeOffset = clamp(cursorOffset, 0, String(value || '').length);
  let line = 0;
  let col = 0;
  for (let i = 0; i < safeOffset; i++) {
    const ch = value[i];
    if (ch === '\n') {
      line++;
      col = 0;
      continue;
    }
    col++;
    if (col >= safeWidth) {
      line++;
      col = 0;
    }
  }
  return { line, col };
}

export function Notepad({ value = '', onChange, focused = true, height = 10, width }) {
  const safeWidth = Math.max(10, width || 40);
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const [scrollOffset, setScrollOffset] = useState(0);

  const latestValue = useRef(value);
  const latestCursor = useRef(cursorOffset);

  useEffect(() => {
    latestValue.current = value;
    setCursorOffset(offset => {
      const newOffset = Math.min(offset, value.length);
      latestCursor.current = newOffset;
      return newOffset;
    });
  }, [value]);

  const wrapped = buildWrappedLines(latestValue.current, safeWidth);
  const cursor = getCursorPos(latestValue.current, latestCursor.current, safeWidth);

  // Auto-pan the camera if the cursor moves out of view
  useEffect(() => {
    setScrollOffset(prev => {
      let newOffset = prev;
      if (cursor.line < newOffset) {
        newOffset = cursor.line;
      } else if (cursor.line >= newOffset + height) {
        newOffset = cursor.line - height + 1;
      }
      return newOffset;
    });
  }, [cursor.line, height]);

  useInput((input, key) => {
    if (!focused) return;
    if (key.ctrl || key.meta) return;

    let nextCursor = latestCursor.current;
    let nextValue = latestValue.current;

    if (key.upArrow) {
      const targetLine = Math.max(0, cursor.line - 1);
      if (targetLine !== cursor.line) {
        let cLine = 0;
        let cCol = 0;
        let foundOffset = nextCursor;
        const targetCol = Math.min(cursor.col, wrapped[targetLine].length);

        for (let i = 0; i <= nextValue.length; i++) {
          if (cLine === targetLine && cCol === targetCol) {
            foundOffset = i;
            break;
          }
          if (cLine > targetLine) break;

          if (i < nextValue.length) {
            if (nextValue[i] === '\n') {
              cLine++; cCol = 0;
            } else {
              cCol++;
              if (cCol >= safeWidth) { cLine++; cCol = 0; }
            }
          }
        }
        nextCursor = foundOffset;
      }
    } else if (key.downArrow) {
      const targetLine = Math.min(wrapped.length - 1, cursor.line + 1);
      if (targetLine !== cursor.line) {
        let cLine = 0;
        let cCol = 0;
        let foundOffset = nextCursor;
        const targetCol = Math.min(cursor.col, wrapped[targetLine].length);

        for (let i = 0; i <= nextValue.length; i++) {
          if (cLine === targetLine && cCol === targetCol) {
            foundOffset = i;
            break;
          }
          if (cLine > targetLine) break;

          if (i < nextValue.length) {
            if (nextValue[i] === '\n') {
              cLine++; cCol = 0;
            } else {
              cCol++;
              if (cCol >= safeWidth) { cLine++; cCol = 0; }
            }
          }
        }
        nextCursor = foundOffset;
      }
    } else if (key.leftArrow) {
      nextCursor = Math.max(0, nextCursor - 1);
    } else if (key.rightArrow) {
      nextCursor = Math.min(nextValue.length, nextCursor + 1);
    } else if (key.return) {
      nextValue = nextValue.slice(0, nextCursor) + '\n' + nextValue.slice(nextCursor);
      nextCursor = nextCursor + 1;
    } else if (key.backspace || key.delete) {
      if (nextCursor > 0) {
        // Because it's a 1D string, deleting automatically pulls the rest of the text upwards!
        nextValue = nextValue.slice(0, nextCursor - 1) + nextValue.slice(nextCursor);
        nextCursor = nextCursor - 1;
      }
    } else if (input) {
      const cleanInput = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      nextValue = nextValue.slice(0, nextCursor) + cleanInput + nextValue.slice(nextCursor);
      nextCursor = nextCursor + cleanInput.length;
    }

    if (nextValue !== latestValue.current || nextCursor !== latestCursor.current) {
      latestCursor.current = nextCursor;
      latestValue.current = nextValue;
      setCursorOffset(nextCursor);
      if (nextValue !== value) {
        onChange(nextValue);
      }
    }
  });

  const maxPossibleScroll = Math.max(0, wrapped.length - height);
  const safeScrollOffset = Math.min(scrollOffset, maxPossibleScroll);

  const start = Math.max(0, safeScrollOffset);
  const end = Math.min(wrapped.length, start + height);
  const visibleLines = wrapped.slice(start, end);

  while (visibleLines.length < height) {
    visibleLines.push(null);
  }

  return React.createElement(Box, { flexDirection: "column", width: width, height: height, overflow: "hidden" },
    visibleLines.map((line, i) => {
      const absoluteLine = start + i;

      if (line === null) {
        return React.createElement(Box, { key: `empty_${i}`, minWidth: 0, height: 1 });
      }

      const isCursorLine = absoluteLine === cursor.line && focused;

      if (!isCursorLine) {
         return React.createElement(Box, { key: `line_${absoluteLine}`, minWidth: 0, overflow: "hidden", height: 1 },
           React.createElement(Text, { color: "gray", wrap: "truncate" }, line || ' ')
         );
      }

      const cursorCol = clamp(cursor.col, 0, line.length);
      const before = line.slice(0, cursorCol);
      const at = cursorCol < line.length ? line[cursorCol] : ' ';
      const after = cursorCol < line.length ? line.slice(cursorCol + 1) : '';

      return React.createElement(Box, { key: `line_${absoluteLine}`, minWidth: 0, overflow: "hidden", flexDirection: "row", height: 1 },
        React.createElement(Text, { color: "white", wrap: "truncate" }, before),
        React.createElement(Text, { backgroundColor: "white", color: "black", wrap: "truncate" }, at),
        React.createElement(Text, { color: "white", wrap: "truncate" }, after)
      );
    })
  );
}