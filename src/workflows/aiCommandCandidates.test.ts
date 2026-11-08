import { describe, expect, it } from "vitest";
import { getAiCommandCandidates } from "./aiCommandCandidates";

const shell = (code: string) => getAiCommandCandidates([{ lang: "sh", code }]);

it("offers distro alternatives individually with their comment labels and source positions", () => {
  const code = [
    "# Debian/Ubuntu — download without installing", "apt download <package>", "",
    "# Fedora/RHEL", "dnf download <package>", "",
    "# Arch Linux", "pacman -Sw <package>", "",
    "# Alpine", "apk fetch <package>",
  ].join("\n");
  expect(shell(code)).toEqual([
    { text: "apt download <package>", label: "Debian/Ubuntu — download without installing", blockIndex: 0, lineStart: 2, lineEnd: 2, kind: "command" },
    { text: "dnf download <package>", label: "Fedora/RHEL", blockIndex: 0, lineStart: 5, lineEnd: 5, kind: "command" },
    { text: "pacman -Sw <package>", label: "Arch Linux", blockIndex: 0, lineStart: 8, lineEnd: 8, kind: "command" },
    { text: "apk fetch <package>", label: "Alpine", blockIndex: 0, lineStart: 11, lineEnd: 11, kind: "command" },
  ]);
});

it("keeps duplicates and original block indices rather than deduplicating by command text", () => {
  expect(getAiCommandCandidates([
    { lang: "json", code: "{}" }, { lang: "bash", code: "pwd\npwd" },
    { lang: "text", code: "not a command" }, { lang: "sh", code: "pwd" },
  ])).toEqual([
    { text: "pwd", label: "", blockIndex: 1, lineStart: 1, lineEnd: 1, kind: "command" },
    { text: "pwd", label: "", blockIndex: 1, lineStart: 2, lineEnd: 2, kind: "command" },
    { text: "pwd", label: "", blockIndex: 3, lineStart: 1, lineEnd: 1, kind: "command" },
  ]);
});

it("preserves command whitespace, distinguishes CRLF separators, and attaches only preceding comments", () => {
  expect(shell(" # First note\r\n# Second note\r\n\r\n  custom-tool --flag  \r\n  custom-tool --other # keep inline\r\n# trailing note\r\n")).toEqual([
    { text: "  custom-tool --flag  ", label: "First note · Second note", blockIndex: 0, lineStart: 4, lineEnd: 4, kind: "command" },
    { text: "  custom-tool --other # keep inline", label: "", blockIndex: 0, lineStart: 5, lineEnd: 5, kind: "command" },
  ]);
});

it("only includes explicitly supported shell languages", () => {
  for (const lang of ["sh", " bash ", "zsh", "SHELL"]) expect(getAiCommandCandidates([{ lang, code: "pwd" }])).toHaveLength(1);
  for (const lang of ["", "text", "console", "shellscript", "powershell", "python", "husk-workflow"]) expect(getAiCommandCandidates([{ lang, code: "pwd" }])).toEqual([]);
});

it("does not confuse quoted literals or escaped spaces with shell operators", () => {
  const commands = ["printf '%s\\n' 'a|b; c'", 'printf "%s" "hello # there"', "custom-tool path\\ with\\ spaces", 'FOO="bar baz" custom-tool --flag'];
  expect(shell(commands.join("\n")).map((candidate) => candidate.text)).toEqual(commands);
  expect(shell(commands.join("\n")).every((candidate) => candidate.kind === "command")).toBe(true);
});

describe("uncertain shell syntax keeps the entire block intact", () => {
  it.each([
    ["pipeline", "printf value | custom-tool"],
    ["logical chain", "first && second"],
    ["fallback chain", "first || second"],
    ["semicolon", "first; second"],
    ["background", "first &"],
    ["heredoc", "cat <<'EOF'\nhello\nEOF"],
    ["here string", "custom-tool <<< value"],
    ["output redirection", "custom-tool > file"],
    ["input redirection", "custom-tool < file"],
    ["fd redirection", "custom-tool 2>&1"],
    ["continuation", "custom-tool \\\n --flag"],
    ["continuation with CRLF", "custom-tool \\\r\n --flag"],
    ["unclosed quote", "printf 'first\nsecond'"],
    ["double-quoted multiline", 'printf "first\nsecond"'],
    ["loop", "for entry in one two\ndo\ncustom-tool $entry\ndone"],
    ["conditional", "if custom-tool\nthen\nother-tool\nfi"],
    ["function", "function custom_check {\ncustom-tool\n}"],
    ["subshell", "(custom-tool)"],
    ["command substitution", "custom-tool $(other-tool)"],
    ["quoted command substitution", 'custom-tool "$(other-tool)"'],
    ["backticks", "custom-tool `other-tool`"],
    ["quoted backticks", 'custom-tool "`other-tool`"'],
    ["process substitution", "custom-tool <(other-tool)"],
    ["brace expansion", "custom-tool {one,two}"],
    ["parameter expansion", "custom-tool ${VALUE:-fallback}"],
    ["array", "values=(one two)"],
    ["standalone assignment", "VALUE=one"],
    ["ANSI quoted string", "printf $'one\\ntwo'"],
    ["shebang", "#!/bin/sh\ncustom-tool"],
    ["test group", "[[ -f file ]]"],
    ["negation", "! custom-tool"],
    ["shell transcript", "$ custom-tool"],
    ["host transcript", "user@host:~$ custom-tool"],
    ["REPL", "python3\nprint('hello')"],
    ["database session", "mysql\nselect value"],
    ["remote session", "ssh host\ncustom-tool"],
    ["wrapped remote session", "sudo ssh host\ncustom-tool"],
    ["wrapped REPL", "env python3\nnot-command-input"],
    ["interactive container", "docker exec -it container bash\ncustom-tool"],
    ["bare option line", "custom-tool\n--flag value"],
    ["stdin", "cat\nnot-command-input"],
    ["stdin with cat options", "cat -n\nnot-command-input"],
    ["stdin with cat dash", "cat -\nnot-command-input"],
    ["stdin with a quoted cat dash", "cat '-'\nnot-command-input"],
    ["stdin with mixed cat files", "cat file -\nnot-command-input"],
    ["stdin with only cat end-of-options", "cat --\nnot-command-input"],
    ["stdin with sudo cat", "sudo cat\nnot-command-input"],
    ["stdin with sudo cat options", "sudo cat -n\nnot-command-input"],
    ["stdin with wrapped cat options", "sudo -u other-user /bin/cat -n\nnot-command-input"],
    ["stdin with tee", "tee output.txt\nnot-command-input"],
    ["stdin with wrapped tee", "sudo tee output.txt\nnot-command-input"],
    ["read input", "read value\nnot-command-input"],
    ["source", "source environment.sh"],
    ["eval", "eval '$VALUE'"],
    ["bare CR", "custom-tool\rmalicious"],
    ["tab", "custom-tool\targument"],
    ["NUL", "custom-tool\x00argument"],
    ["ANSI escape", "custom-tool \x1b[31margument"],
    ["C1 control", "custom-tool \u0085argument"],
    ["Unicode separator", "custom-tool\u2028argument"],
    ["control in label", "# title\tbad\ncustom-tool"],
  ])("does not partially split around %s", (_name, uncertain) => {
    const code = `# Beginning\npwd\n${uncertain}\nwhoami\n`;
    expect(shell(code)).toEqual([{ text: code, label: "", blockIndex: 0, lineStart: 1, lineEnd: code.split("\n").length - 1, kind: "script" }]);
  });
});

it("still separates cat commands that name files rather than consume stdin", () => {
  const commands = ["cat file.txt", "cat -n file.txt", "cat -- -file.txt", "cat ./-", "sudo cat -n file.txt"];
  expect(shell(commands.join("\n")).map(({ text, kind }) => ({ text, kind }))).toEqual(commands.map((text) => ({ text, kind: "command" })));
});

it("handles long wrapper examples without repeatedly scanning every suffix", () => {
  const code = `sudo echo ${Array(10000).fill("cat").join(" ")} file.txt`;
  expect(shell(code)).toEqual([{ text: code, label: "", blockIndex: 0, lineStart: 1, lineEnd: 1, kind: "command" }]);
});

it("keeps comments-only and empty blocks intact without inventing commands", () => {
  for (const code of ["", "\n\n", "# Notes\n# More notes\n"]) {
    const result = shell(code);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ text: code, label: "", kind: "script" });
  }
});

it("bounds splitting without dropping or truncating oversized content", () => {
  const oneHundred = Array(100).fill("pwd").join("\n");
  expect(shell(oneHundred)).toHaveLength(100);
  for (const code of [`${oneHundred}\npwd`, `custom-tool ${"x".repeat(128 * 1024)}`]) {
    expect(shell(code)).toHaveLength(1);
    expect(shell(code)[0]).toMatchObject({ text: code, kind: "script" });
  }
});

it("does not let one ambiguous block prevent simple candidates in another block", () => {
  expect(getAiCommandCandidates([{ lang: "sh", code: "one | two" }, { lang: "sh", code: "three\nfour" }]).map(({ text, kind, blockIndex }) => ({ text, kind, blockIndex }))).toEqual([
    { text: "one | two", kind: "script", blockIndex: 0 },
    { text: "three", kind: "command", blockIndex: 1 },
    { text: "four", kind: "command", blockIndex: 1 },
  ]);
});
