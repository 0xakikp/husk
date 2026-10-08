import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src-tauri/src/scripts/zshrc.zsh", import.meta.url), "utf8");
// Execute only the production precmd hook, never the startup script that loads
// user dotfiles, modifies aliases/config, or starts plugin processes.
const hook = source.slice(source.indexOf("  _husk_precmd() {"), source.indexOf("  _husk_preexec() {"));
function run(extra: string) {
  return execFileSync("/bin/zsh", ["-f", "-c", `
    _husk_urlencode() { print -rn -- "$1"; }
    _husk_detect_remote() { return 0; }
    __husk_report_kubeconfig() { return 0; }
    ${hook}
    ${extra}
  `], { encoding: "utf8", timeout: 5000 });
}

describe.skipIf(!existsSync("/bin/zsh"))("bundled zsh prompt hooks", () => {
  it("adds exactly one prompt-end mark for ordinary prompts", () => {
    const output = run(`PS1='project ❯ '; _husk_precmd; _husk_precmd; print -Pn -- "$PS1"`);
    expect(output.match(/\x1b\]133;B/g)).toHaveLength(1);
    expect(output).toContain("project ❯ ");
  });

  it("enables native marks for a theme that rebuilds PS1 after Husk's hook", () => {
    const output = run(`
      typeset -gi reloads=0
      p10k() { [[ "$1" == reload ]] && (( ++reloads )); }
      _p9k_set_prompt() {
        PS1='rebuilt ❯ '
        [[ "$POWERLEVEL9K_TERM_SHELL_INTEGRATION" == true ]] && PS1+=$'%{\\e]133;B\\a%}'
      }
      PS1='initial ❯ '
      _husk_precmd; _p9k_set_prompt; print -Pn -- "$PS1"
      _husk_precmd; _p9k_set_prompt; print -Pn -- "$PS1"
      print -r -- "reloads=$reloads"
    `);
    expect(output.match(/\x1b\]133;B/g)).toHaveLength(2);
    expect(output).toContain("reloads=1");
  });

  it("does not duplicate a native BEL-terminated marker", () => {
    const output = run(`PS1=$'project ❯ %{\\e]133;B\\a%}'; _husk_precmd; print -Pn -- "$PS1"`);
    expect(output.match(/\x1b\]133;B/g)).toHaveLength(1);
  });

  it("preserves the previous command's exit code when enabling theme integration", () => {
    const output = run(`p10k() { return 0; }; _p9k_set_prompt() { :; }; false; _husk_precmd`);
    expect(output).toContain("\x1b]133;D;1\x1b\\");
  });
});
