import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export function Notepad({ value = '', onChange, focused = true, height = 10, width }) {
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Normalize lines
  const lines = value.split('\n');
  if (lines.length === 0) lines.push('');

  // Adjust scroll offset based on cursor position
  useEffect(() => {
    if (cursorLine < scrollOffset) {
      setScrollOffset(cursorLine);
    } else if (cursorLine >= scrollOffset + height) {
      setScrollOffset(cursorLine - height + 1);
    }
  }, [cursorLine, height, scrollOffset]);

  useInput((input, key) => {
    if (!focused) return;

    if (key.upArrow) {
      setCursorLine(l => {
        const nextL = Math.max(0, l - 1);
        setCursorCol(c => Math.max(0, Math.min(c, lines[nextL]?.length || 0)));
        return nextL;
      });
      return;
    }
    if (key.downArrow) {
      setCursorLine(l => {
        const nextL = Math.min(lines.length - 1, l + 1);
        setCursorCol(c => Math.max(0, Math.min(c, lines[nextL]?.length || 0)));
        return nextL;
      });
      return;
    }
    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(c => c - 1);
      } else if (cursorLine > 0) {
        const prevLineIdx = cursorLine - 1;
        setCursorLine(prevLineIdx);
        setCursorCol(lines[prevLineIdx].length);
      }
      return;
    }
    if (key.rightArrow) {
      if (cursorCol < lines[cursorLine].length) {
        setCursorCol(c => c + 1);
      } else if (cursorLine < lines.length - 1) {
        setCursorLine(cursorLine + 1);
        setCursorCol(0);
      }
      return;
    }

    // Ignore modifier combos handled globally (like alt+...)
    if (key.meta || key.ctrl) return;

    if (key.return) {
      const currentLine = lines[cursorLine];
      const before = currentLine.substring(0, cursorCol);
      const after = currentLine.substring(cursorCol);

      const newLines = [...lines];
      newLines[cursorLine] = before;
      newLines.splice(cursorLine + 1, 0, after);

      onChange(newLines.join('\n'));
      setCursorLine(l => l + 1);
      setCursorCol(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        const currentLine = lines[cursorLine];
        const newLines = [...lines];
        newLines[cursorLine] = currentLine.substring(0, cursorCol - 1) + currentLine.substring(cursorCol);
        onChange(newLines.join('\n'));
        setCursorCol(c => c - 1);
      } else if (cursorLine > 0) {
        const prevLineIdx = cursorLine - 1;
        const prevLine = lines[prevLineIdx];
        const currentLine = lines[cursorLine];
        const maxCol = width > 2 ? width - 2 : 10;

        const newLines = [...lines];
        const combined = prevLine + currentLine;

        if (combined.length > maxCol) {
          newLines[prevLineIdx] = combined.substring(0, maxCol);
          newLines[cursorLine] = combined.substring(maxCol);
          onChange(newLines.join('\n'));
          setCursorLine(prevLineIdx);
          setCursorCol(prevLine.length);
        } else {
          newLines[prevLineIdx] = combined;
          newLines.splice(cursorLine, 1);
          onChange(newLines.join('\n'));
          setCursorLine(prevLineIdx);
          setCursorCol(prevLine.length);
        }
      }
      return;
    }

    // Regular typed input
    if (input) {
      const maxCol = width > 2 ? width - 2 : 10;
      // Handle pasted multiline input gracefully
      const isPaste = input.includes('\n') || input.includes('\r');
      if (isPaste) {
         const pastedLines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
         let currentLine = lines[cursorLine];
         let before = currentLine.substring(0, cursorCol);
         let after = currentLine.substring(cursorCol);

         let newLines = [...lines];
         if (pastedLines.length === 1) {
           const combined = before + pastedLines[0] + after;
           if (combined.length > maxCol) {
               newLines[cursorLine] = combined.substring(0, maxCol);
               newLines.splice(cursorLine + 1, 0, combined.substring(maxCol));
               onChange(newLines.join('\n'));
               setCursorLine(cursorLine + 1);
               setCursorCol(combined.substring(maxCol).length - after.length);
           } else {
               newLines[cursorLine] = combined;
               onChange(newLines.join('\n'));
               setCursorCol(cursorCol + pastedLines[0].length);
           }
         } else {
           newLines[cursorLine] = before + pastedLines[0];
           for (let i = 1; i < pastedLines.length - 1; i++) {
             newLines.splice(cursorLine + i, 0, pastedLines[i]);
           }
           const lastPasted = pastedLines[pastedLines.length - 1];
           newLines.splice(cursorLine + pastedLines.length - 1, 0, lastPasted + after);

           onChange(newLines.join('\n'));
           setCursorLine(cursorLine + pastedLines.length - 1);
           setCursorCol(lastPasted.length);
         }
      } else {
        const currentLine = lines[cursorLine];
        const newLines = [...lines];
        const combined = currentLine.substring(0, cursorCol) + input + currentLine.substring(cursorCol);

        if (combined.length > maxCol) {
            // Auto wrap
            newLines[cursorLine] = combined.substring(0, maxCol);
            const overflow = combined.substring(maxCol);
            // If we are at the end of the line, push down
            if (cursorCol >= maxCol - 1) {
                newLines.splice(cursorLine + 1, 0, overflow);
                onChange(newLines.join('\n'));
                setCursorLine(l => l + 1);
                setCursorCol(input.length);
            } else {
                newLines.splice(cursorLine + 1, 0, overflow);
                onChange(newLines.join('\n'));
                setCursorCol(c => c + input.length);
            }
        } else {
            newLines[cursorLine] = combined;
            onChange(newLines.join('\n'));
            setCursorCol(c => c + input.length);
        }
      }
    }
  });

  const visibleLines = lines.slice(scrollOffset, scrollOffset + height);

  return React.createElement(Box, { flexDirection: "column", width: width, height: height, overflow: "hidden" },
    visibleLines.map((line, i) => {
      const actualLineIdx = scrollOffset + i;
      const isCursorLine = actualLineIdx === cursorLine && focused;

      if (!isCursorLine) {
         return React.createElement(Box, { key: actualLineIdx, minWidth: 0, overflow: "hidden" },
           React.createElement(Text, { color: "gray", wrap: "truncate" }, line || ' ')
         );
      }

      // Render cursor
      const beforeCursor = line.substring(0, cursorCol);
      const atCursor = line.substring(cursorCol, cursorCol + 1) || ' ';
      const afterCursor = line.substring(cursorCol + 1);

      return React.createElement(Box, { key: actualLineIdx, minWidth: 0, overflow: "hidden", flexDirection: "row" },
        React.createElement(Text, { color: "white", wrap: "truncate" }, beforeCursor),
        React.createElement(Text, { backgroundColor: "white", color: "black", wrap: "truncate" }, atCursor),
        React.createElement(Text, { color: "white", wrap: "truncate" }, afterCursor)
      );
    })
  );
}
