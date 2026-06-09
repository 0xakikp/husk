import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getShellHistory } from "../shellHistory";
import { getPromptPosition } from "../ai/terminalContext";
import type { Terminal } from "@xterm/xterm";

export interface Suggestion {
  command: string;
  highlight: string;
  rest: string;
}

export interface AutocompleteState {
  visible: boolean;
  suggestions: Suggestion[];
  selectedIndex: number;
  position: { x: number; y: number } | null;
}

export function useAutocomplete(
  termRef: React.MutableRefObject<Terminal | null>,
  ptyIdRef: React.MutableRefObject<number | null>,
) {
  const historyRef = useRef<string[]>([]);
  const [state, setState] = useState<AutocompleteState>({
    visible: false,
    suggestions: [],
    selectedIndex: 0,
    position: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const checkTimerRef = useRef<number>(0);

  useEffect(() => {
    getShellHistory(500)
      .then((rows) => {
        const seen = new Set<string>();
        const unique: string[] = [];
        for (const row of rows) {
          if (!seen.has(row.command)) {
            seen.add(row.command);
            unique.push(row.command);
          }
        }
        historyRef.current = unique;
      })
      .catch(() => {});
  }, []);

  const calculatePosition = useCallback((): { x: number; y: number } | null => {
    const term = termRef.current;
    if (!term || !term.element) return null;
    const buf = term.buffer.active;
    const screenEl = term.element.querySelector(".xterm-screen") as HTMLElement | null;
    if (!screenEl) return null;

    const rect = screenEl.getBoundingClientRect();
    const style = window.getComputedStyle(screenEl);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const cellW = (rect.width - padL - padR) / term.cols;
    const cellH = rect.height / term.rows;
    if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW <= 0 || cellH <= 0) return null;

    const x = buf.cursorX * cellW + padL;
    const y = (buf.cursorY + 1) * cellH;
    return { x, y };
  }, [termRef]);

  const check = useCallback(() => {
    const term = termRef.current;
    if (!term) return;

    const buf = term.buffer.active;
    const prompt = getPromptPosition();

    if (!prompt) {
      setState((s) => ({ ...s, visible: false }));
      return;
    }

    const curRow = buf.cursorY + buf.viewportY;
    if (curRow !== prompt.row) {
      setState((s) => ({ ...s, visible: false }));
      return;
    }

    const line = buf.getLine(buf.cursorY)?.translateToString(true) ?? "";
    const input = line.slice(prompt.col).trimStart();

    if (!input || input.length < 1) {
      setState((s) => ({ ...s, visible: false }));
      return;
    }

    // Only show autocomplete when cursor is at end of input
    if (buf.cursorX < prompt.col + input.length) {
      setState((s) => ({ ...s, visible: false }));
      return;
    }

    const lowerInput = input.toLowerCase();
    const matches = historyRef.current
      .filter((cmd) => {
        const lowerCmd = cmd.toLowerCase();
        return lowerCmd.startsWith(lowerInput) && cmd !== input;
      })
      .slice(0, 5);

    if (matches.length === 0) {
      setState((s) => ({ ...s, visible: false }));
      return;
    }

    const position = calculatePosition();
    setState({
      visible: true,
      suggestions: matches.map((cmd) => ({
        command: cmd,
        highlight: cmd.slice(0, input.length),
        rest: cmd.slice(input.length),
      })),
      selectedIndex: 0,
      position,
    });
  }, [calculatePosition, termRef]);

  const scheduleCheck = useCallback(() => {
    clearTimeout(checkTimerRef.current);
    checkTimerRef.current = window.setTimeout(check, 50);
  }, [check]);

  const accept = useCallback(
    (index?: number) => {
      const idx = index ?? stateRef.current.selectedIndex;
      const suggestion = stateRef.current.suggestions[idx];
      if (!suggestion) return;

      const remaining = suggestion.command.slice(suggestion.highlight.length);
      const ptyId = ptyIdRef.current;
      if (ptyId != null && remaining) {
        void invoke("pty_write", { id: ptyId, data: remaining });
      }
      setState((s) => ({ ...s, visible: false }));
    },
    [ptyIdRef],
  );

  const navigate = useCallback((delta: number) => {
    setState((s) => {
      if (!s.visible) return s;
      const next = s.selectedIndex + delta;
      if (next < 0 || next >= s.suggestions.length) return s;
      return { ...s, selectedIndex: next };
    });
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  return { state, stateRef, scheduleCheck, accept, navigate, dismiss };
}
