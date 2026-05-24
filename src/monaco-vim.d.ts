declare module "monaco-vim" {
  import type * as monaco from "monaco-editor";
  export function initVimMode(
    editor: monaco.editor.IStandaloneCodeEditor,
    statusbarNode?: HTMLElement | null,
  ): { dispose(): void };
}
