// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TabBar } from "./TabBar";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("opens a new terminal without passing the click event as its working directory", async () => {
  // Like useTerminalTabs.addTab, this callback accepts an optional cwd even
  // though TabBar exposes it as a zero-argument action.
  const onNewTerm = vi.fn<(initialCwd?: string) => void>();
  await act(async () => root.render(createElement(TabBar, {
    termTabs: [{ id: 1, title: "Terminal 1", root: { kind: "leaf", id: 1 }, focused: 1 }],
    openFiles: [],
    active: { kind: "term", id: 1 },
    onSelectTerm: vi.fn(),
    onSelectFile: vi.fn(),
    onCloseTerm: vi.fn(),
    onCloseFile: vi.fn(),
    onNewTerm,
    onRenameTerm: vi.fn(),
    onSetTabColor: vi.fn(),
    onPinTerm: vi.fn(),
    onUnpinTerm: vi.fn(),
    onPinFile: vi.fn(),
    onUnpinFile: vi.fn(),
    onMoveTerm: vi.fn(),
    onMoveFile: vi.fn(),
    settingsOpen: false,
    onSelectSettings: vi.fn(),
    onCloseSettings: vi.fn(),
    onSelectAi: vi.fn(),
    onCloseAi: vi.fn(),
    aiOpen: false,
    onPinAi: vi.fn(),
    onUnpinAi: vi.fn(),
    aiPinned: false,
  })));

  const button = container.querySelector<HTMLButtonElement>('button[title="New tab"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());

  expect(onNewTerm).toHaveBeenCalledOnce();
  expect(onNewTerm.mock.calls.map((args) => args.length)).toEqual([0]);
});
