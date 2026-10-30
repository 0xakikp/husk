import { expect, it } from "vitest";
import { parseComposerCodeBlocks } from "./composerCodeBlocks";

const proposal = '```husk-workflow\n{"version":1,"name":"Checks","steps":["pnpm lint","pnpm test"]}\n```';

it("keeps ordinary shell, other-language, and unlabelled tabs without deduplicating commands", () => {
  expect(parseComposerCodeBlocks('```sh\ngit status\n```\n```python\nprint("hi")\n```\n```\nexample\n```\n```sh\ngit status\n```')).toEqual([
    { lang: "sh", code: "git status" }, { lang: "python", code: 'print("hi")' }, { lang: "", code: "example" }, { lang: "sh", code: "git status" },
  ]);
});

it("keeps complete workflow cards and incomplete tails out of command tabs", () => {
  expect(parseComposerCodeBlocks(`${proposal}\n\n\`\`\`sh\npwd\n\`\`\``)).toEqual([{ lang: "sh", code: "pwd" }]);
  expect(parseComposerCodeBlocks('```husk-workflow\n{"steps":')).toEqual([]);
});

it.each(["~~~", "````"])("does not promote nested shell text in a malformed %s workflow into Run actions", (fence) => {
  const inlineAction = 'Inspect```husk-action\n{"kind":"workspace.list","path":"."}\n```';
  const workflow = `${fence}husk-workflow\nMalformed example:\n\`\`\`sh\nprintf nested\n\`\`\`\n${fence}`;
  expect(parseComposerCodeBlocks(`${inlineAction}\n${workflow}`).filter((block) => block.lang === "sh")).toEqual([]);
});

it("does not expose an altered enclosing shell script after masking workflow example data", () => {
  const script = "```sh\nprintf start\n~~~husk-workflow\nexample\n~~~\nprintf end\n```";
  expect(parseComposerCodeBlocks(script)).toEqual([]);
});

it("never creates tabs from workflow JSON persisted and reloaded in a chat", () => {
  const messages = JSON.parse(JSON.stringify([{ role: "assistant", content: proposal }]));
  expect(parseComposerCodeBlocks(messages[0].content)).toEqual([]);
});
