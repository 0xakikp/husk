import { describe, expect, it } from "vitest";
import { parseWorkflowProposals } from "../ai/workflowProposals";
import { parseComposerResponseParts } from "./composerResponseParts";

const workflow = '```husk-workflow\n{"version":1,"name":"Checks","steps":["pnpm lint","pnpm test"]}\n```';
const code = (lang: string, value: string, actionable = true) => ({ kind: "code", lang, code: value, actionable });

describe("ordered composer response parts", () => {
  it("keeps download and installation explanations beside their own commands", () => {
    expect(parseComposerResponseParts("Download without installing:\n```sh\napt download <package>\n```\n\nTo install instead:\n```sh\nsudo apt install <package>\n```"))
      .toEqual([
        { kind: "text", text: "Download without installing:\n" },
        code("sh", "apt download <package>"),
        { kind: "text", text: "\n\nTo install instead:\n" },
        code("sh", "sudo apt install <package>"),
      ]);
  });

  it("represents diff and tree fences exactly once in their original positions", () => {
    const diff = "--- a/file\n+++ b/file\n-before\n+after";
    const tree = "src/\n├── App.tsx\n└── index.ts";
    expect(parseComposerResponseParts(`Changes:\n\`\`\`diff\n${diff}\n\`\`\`\nFiles:\n~~~tree\n${tree}\n~~~\nDone.`))
      .toEqual([
        { kind: "text", text: "Changes:\n" }, code("diff", diff),
        { kind: "text", text: "\nFiles:\n" }, code("tree", tree),
        { kind: "text", text: "\nDone." },
      ]);
  });

  it("preserves duplicate commands, indentation, and blank lines in the code body", () => {
    expect(parseComposerResponseParts("```sh\n  printf first  \n\n```\n~~~sh\n  printf first  \n~~~"))
      .toEqual([code("sh", "  printf first  \n"), { kind: "text", text: "\n" }, code("sh", "  printf first  ")]);
  });

  it("supports CRLF, tildes, longer delimiters, and fences indented up to three spaces", () => {
    expect(parseComposerResponseParts("  ~~~~SH\r\npwd\r\n~~~\r\n  ~~~~~\r\n```python\nprint('hi')\n```"))
      .toEqual([code("sh", "pwd\r\n~~~"), { kind: "text", text: "\n" }, code("python", "print('hi')")]);
  });

  it("keeps unlabelled code unlabelled rather than assuming a shell", () => {
    expect(parseComposerResponseParts("```\nexample\n```"))
      .toEqual([code("", "example")]);
  });

  it("keeps workflow proposals in order as raw input for the existing validator", () => {
    const parts = parseComposerResponseParts(`First:\n${workflow}\nThen:\n\`\`\`sh\npwd\n\`\`\``);
    expect(parts).toEqual([
      { kind: "text", text: "First:\n" }, { kind: "workflow", text: workflow },
      { kind: "text", text: "\nThen:\n" }, code("sh", "pwd"),
    ]);
    expect(parseWorkflowProposals(parts[1].kind === "workflow" ? parts[1].text : "").proposals).toHaveLength(1);
  });

  it.each(["```husk-workflow\n{bad}\n```", "~~~husk-workflow\n{\"steps\":"])("keeps malformed and incomplete workflow proposals out of command controls", (source) => {
    expect(parseComposerResponseParts(source)).toEqual([{ kind: "workflow", text: source }]);
    const result = parseWorkflowProposals(source);
    expect(result.rejected || result.pending).toBeTruthy();
  });

  it.each(["husk-action", "husk-edit", "husk-workflow"])("preserves a complete script containing nested %s data but makes it inert", (protocol) => {
    const body = `printf before\n~~~${protocol}\nexample\n~~~\nprintf after`;
    expect(parseComposerResponseParts(`\`\`\`sh\n${body}\n\`\`\``)).toEqual([code("sh", body, false)]);
  });

  it("recognizes nested protocol examples after prose and with oversized indentation", () => {
    const body = "printf before\nExample: ```husk-workflow\n{}\n```\nprintf after";
    expect(parseComposerResponseParts(`~~~~sh\n${body}\n~~~~`)).toEqual([code("sh", body, false)]);
    expect(parseComposerResponseParts("```sh\n        ~~~husk-action\n{}\n~~~\n```"))
      .toEqual([code("sh", "        ~~~husk-action\n{}\n~~~", false)]);
  });

  it.each(["husk-action", "husk-edit"])("never gives %s protocol blocks executable controls", (protocol) => {
    expect(parseComposerResponseParts(`\`\`\`${protocol}\n{}\n\`\`\``)).toEqual([code(protocol, "{}", false)]);
  });

  it("treats fences nested inside larger Markdown fences as data", () => {
    const body = "A literal example:\n```sh\nprintf example\n```";
    expect(parseComposerResponseParts(`~~~~markdown\n${body}\n~~~~`)).toEqual([code("markdown", body)]);
    expect(parseComposerResponseParts(`~~~~markdown\n${workflow}\n~~~~`)).toEqual([code("markdown", workflow, false)]);
  });

  it.each(["> ", "    ", "- ", "1. "])("keeps %j example fences as inert text", (prefix) => {
    const source = `${prefix}\`\`\`sh\n${prefix}printf example\n${prefix}\`\`\``;
    const parts = parseComposerResponseParts(source);
    expect(parts).toEqual([{ kind: "text", text: source }]);
  });

  it("does not turn a line inside a quoted fence into a command even without quote prefixes", () => {
    const source = "> ~~~~text\n```sh\nprintf example\n```\n> ~~~~";
    expect(parseComposerResponseParts(source)).toEqual([{ kind: "text", text: source }]);
  });

  it.each(["`example\n", "``example\n", "<!--\n", "<pre>\n", "<code>\n", "<script>\n"])("keeps fences inside %j examples inert", (opening) => {
    const source = `${opening}\`\`\`sh\nprintf example\n\`\`\``;
    expect(parseComposerResponseParts(source)).toEqual([{ kind: "text", text: source }]);
  });

  it("resumes normal code extraction after an inline or HTML example ends", () => {
    const prefix = "<!--\n```sh\nprintf example\n```\n-->\n";
    expect(parseComposerResponseParts(`${prefix}\`\`\`sh\npwd\n\`\`\``))
      .toEqual([{ kind: "text", text: prefix }, code("sh", "pwd")]);
  });

  it("does not interpret inline fence mentions as code blocks", () => {
    const source = "Use ```sh and keep the example here``` in the documentation.";
    expect(parseComposerResponseParts(source)).toEqual([{ kind: "text", text: source }]);
  });

  it("renders incomplete ordinary code without executable controls", () => {
    expect(parseComposerResponseParts("Starting:\n```sh\nprintf partial\n"))
      .toEqual([{ kind: "text", text: "Starting:\n" }, code("sh", "printf partial\n", false)]);
    expect(parseComposerResponseParts("```sh")).toEqual([code("sh", "", false)]);
    expect(parseComposerResponseParts("```sh\npwd\n``")).toEqual([code("sh", "pwd\n``", false)]);
  });

  it("caps interactive parts and preserves the remaining response as inert text", () => {
    const source = Array.from({ length: 1_000 }, (_, i) => `\`\`\`sh\nprintf command-${i}\n\`\`\``).join("\n");
    const parts = parseComposerResponseParts(source);
    expect(parts.length).toBeLessThanOrEqual(512);
    expect(parts[parts.length - 1]).toMatchObject({ kind: "text" });
    expect(parts[parts.length - 1]).toHaveProperty("text", expect.stringContaining("printf command-999"));
  });

  it("handles long delimiter and prefix runs without regex backtracking", () => {
    const source = `${"`".repeat(100_000)}sh\npwd\n${"`".repeat(100_000)}`;
    expect(parseComposerResponseParts(source)).toEqual([code("sh", "pwd")]);
    const body = `printf before\n${"`".repeat(100_000)}husk-edit\n{}\n`;
    expect(parseComposerResponseParts(`~~~sh\n${body}~~~`)).toEqual([code("sh", body.slice(0, -1), false)]);
  });
});
