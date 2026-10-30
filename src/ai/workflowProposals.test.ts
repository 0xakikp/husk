import { describe, expect, it } from "vitest";
import { maskWorkflowProposals, parseWorkflowProposals, stripWorkflowProposals } from "./workflowProposals";

const definition = () => ({ version: 1, name: "Project checks", steps: ["pnpm lint", "pnpm test"] });
const fence = (value: unknown) => "```husk-workflow\n" + JSON.stringify(value) + "\n```";
const parse = (value: unknown) => parseWorkflowProposals(fence(value));

it("parses an ordered proposal without choosing a saved identity or changing command text", () => {
  const proposal = { ...definition(), name: "  Project checks  ", description: "Check before publishing", steps: ["  printf '%s\\n' 'a && b'  ", "pnpm test"], stepTitles: ["Inspect", "Test"] };
  expect(parse(proposal)).toEqual({ proposals: [{ name: "Project checks", description: proposal.description, steps: proposal.steps, stepTitles: proposal.stepTitles, stopOnError: true }], rejected: 0, pending: false });
});

it("leaves normal prose, shell fences, and JSON untouched", () => {
  const text = "Use `husk-workflow` if needed.\n```json\n" + JSON.stringify(definition()) + "\n```\n```sh\npnpm test\n```";
  expect(parseWorkflowProposals(text)).toEqual({ proposals: [], rejected: 0, pending: false });
  expect(stripWorkflowProposals(text)).toBe(text);
});

it("does not promote a nested example inside another Markdown code fence", () => {
  for (const outer of ["````md", "~~~markdown", "```text"]) {
    const close = outer.startsWith("~") ? "~~~" : outer.startsWith("````") ? "````" : "```";
    const text = `${outer}\n${fence(definition())}\n${close}`;
    expect(parseWorkflowProposals(text)).toEqual({ proposals: [], rejected: 0, pending: false });
    expect(stripWorkflowProposals(text)).toBe(text);
  }
});

it("accepts own-line case-insensitive fences, CRLF, indentation, and matching longer fences", () => {
  for (const text of [
    `  \`\`\`HUSK-WORKFLOW  \r\n${JSON.stringify(definition())}\r\n  \`\`\` \r\n`,
    `~~~~husk-workflow\n${JSON.stringify(definition())}\n~~~~~`,
    `\`\`\`\`husk-workflow\n${JSON.stringify(definition())}\n\`\`\`\``,
  ]) expect(parseWorkflowProposals(text).proposals).toHaveLength(1);
});

it("requires complete own-line fences and does not accept a short or mismatched closer", () => {
  for (const text of [
    "```husk-workflow\n" + JSON.stringify(definition()),
    "```husk-workflow\n" + JSON.stringify(definition()) + "```",
    "````husk-workflow\n" + JSON.stringify(definition()) + "\n```",
    "```husk-workflow\n" + JSON.stringify(definition()) + "\n~~~",
    "```husk-workflow",
  ]) {
    expect(parseWorkflowProposals(text)).toEqual({ proposals: [], rejected: 0, pending: true });
    expect(stripWorkflowProposals(text)).toBe("");
  }
  expect(parseWorkflowProposals("Prose ```husk-workflow\n" + JSON.stringify(definition()) + "\n```").proposals).toEqual([]);
});

it("hides invalid and incomplete protocol data without hiding surrounding explanation", () => {
  const text = `Before\n\n${fence(definition())}\n\nBetween\n\n\`\`\`husk-workflow\nnot valid JSON\n\`\`\`\n\nAfter\n\n\`\`\`husk-workflow\n{"version":1`;
  expect(parseWorkflowProposals(text)).toMatchObject({ rejected: 1, pending: true });
  expect(stripWorkflowProposals(text)).toBe("Before\n\nBetween\n\nAfter");
});

describe("strict review-only schema", () => {
  it.each([undefined, null, [], "text", 1, {}, { ...definition(), version: 2 }])("rejects unsupported envelopes: %j", (value) => {
    expect(parse(value)).toMatchObject({ proposals: [], rejected: 1, pending: false });
  });

  it.each(["id", "target", "targetWorkflowId", "action", "actions", "append", "run", "inputs", "kind", "__proto__"])("rejects unrecognized %s instead of silently dropping instructions", (field) => {
    expect(parse({ ...definition(), [field]: "untrusted" })).toMatchObject({ proposals: [], rejected: 1 });
  });

  it("always stops on failure and rejects a model-selected continue-on-error policy", () => {
    expect(parse({ ...definition(), stopOnError: true }).proposals[0].stopOnError).toBe(true);
    for (const stopOnError of [false, null, "true", 1]) expect(parse({ ...definition(), stopOnError })).toMatchObject({ proposals: [], rejected: 1 });
  });

  it("rejects empty, excessive, invalid, and multiline steps without truncating or splitting", () => {
    for (const steps of [[], Array.from({ length: 101 }, () => "pwd"), [""], ["   "], [1], ["pwd\nwhoami"], ["pwd\rwhoami"], ["printf\tx"], ["pwd\u2028whoami"], ["pwd\u2029whoami"], ["pwd\x85whoami"], ["pwd\x1bwhoami"], ["pwd\x00whoami"]]) {
      expect(parse({ ...definition(), steps })).toMatchObject({ proposals: [], rejected: 1 });
    }
    expect(parse({ ...definition(), steps: Array.from({ length: 100 }, () => "pwd") }).proposals[0].steps).toHaveLength(100);
  });

  it("uses UTF-8 byte limits for commands and metadata", () => {
    expect(parse({ ...definition(), steps: ["é".repeat(4000)] }).proposals).toHaveLength(1);
    for (const partial of [{ steps: ["é".repeat(4001)] }, { name: "😀".repeat(41) }, { description: "é".repeat(1001) }, { stepTitles: ["é".repeat(81), "Test"] }]) expect(parse({ ...definition(), ...partial })).toMatchObject({ proposals: [], rejected: 1 });
  });

  it("requires matching title count and safe presentable metadata", () => {
    for (const partial of [{ stepTitles: ["Test"] }, { stepTitles: ["First\nSecond", "Test"] }, { name: "My\nworkflow" }, { description: "Detail\x85line" }]) expect(parse({ ...definition(), ...partial })).toMatchObject({ proposals: [], rejected: 1 });
  });

  it("bounds the entire proposal as well as each individual command", () => {
    expect(parse({ ...definition(), steps: Array.from({ length: 30 }, () => "é".repeat(3000)) })).toMatchObject({ proposals: [], rejected: 1 });
    const text = "```husk-workflow\n" + " ".repeat(128 * 1024 + 1) + JSON.stringify(definition()) + "\n```";
    expect(parseWorkflowProposals(text)).toMatchObject({ proposals: [], rejected: 1 });
    expect(stripWorkflowProposals(text)).toBe("");
  });
});

it("bounds accepted cards, preserves their order, and reports extra proposals", () => {
  const text = Array.from({ length: 5 }, (_, index) => fence({ ...definition(), name: "Workflow " + index })).join("\n");
  const parsed = parseWorkflowProposals(text);
  expect(parsed.proposals.map((item) => item.name)).toEqual(["Workflow 0", "Workflow 1", "Workflow 2"]);
  expect(parsed).toMatchObject({ rejected: 2, pending: false });
  expect(stripWorkflowProposals(text)).toBe("");
});

it("keeps shell composition and non-secret input placeholders as exact review text", () => {
  const steps = ["cd {{folder}}", "git status --short && printf '%s' done", "printf '%s' 'a;b|c'", "pnpm test"];
  expect(parse({ ...definition(), steps }).proposals[0].steps).toEqual(steps);
});

it("masks complete, malformed and pending proposals without shifting UTF-16 offsets or line breaks", () => {
  const complete = fence({ ...definition(), description: "🤖 proposal" });
  const malformed = "```husk-workflow\r\n```husk-action\r\n{}\r\n```";
  const pending = "```husk-workflow\n```husk-edit\n{}";
  const text = `Before 🤖\n${complete}\nMiddle\r\n${malformed}\nAfter\n${pending}`;
  const masked = maskWorkflowProposals(text);
  expect(masked.length).toBe(text.length);
  expect([...masked.matchAll(/[\r\n]/g)].map((match) => match.index)).toEqual([...text.matchAll(/[\r\n]/g)].map((match) => match.index));
  for (const marker of ["husk-workflow", "husk-action", "husk-edit", "proposal"]) expect(masked).not.toContain(marker);
  for (const preserved of ["Before 🤖", "Middle", "After"]) expect(masked.indexOf(preserved)).toBe(text.indexOf(preserved));
  expect(maskWorkflowProposals("ordinary 🤖 text\r\n")).toBe("ordinary 🤖 text\r\n");
});

it("conservatively masks workflow examples inside other fences without changing card parsing", () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const workflow = [ticks + "`husk-workflow", "Malformed 🤖 example:", ticks + "husk-action", "{}", ticks, ticks + "`"].join("\r\n");
  for (const [open, close] of [[ticks + "``markdown", ticks + "``"], ["~~~~~markdown", "~~~~~"]]) {
    const text = [open, "Example before", workflow, "Example after", close].join("\r\n");
    expect(parseWorkflowProposals(text)).toEqual({ proposals: [], rejected: 0, pending: false });
    expect(stripWorkflowProposals(text)).toBe(text);
    expect(maskWorkflowProposals(text)).toBe(text.replace(workflow, workflow.replace(/[^\r\n]/g, " ")));
  }
});

it("masks workflow spans after inline action openers that have different Markdown fence state", () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const prefix = ["Inspecting." + ticks + "husk-action", '{"kind":"workspace.list","path":"."}', ticks, ""].join("\n");
  for (const close of ["", ticks + "`"]) {
    const workflow = [ticks + "`husk-workflow", "Malformed example:", ticks + "husk-edit", "{}", ticks, close].filter(Boolean).join("\n");
    expect(maskWorkflowProposals(prefix + workflow)).toBe(prefix + workflow.replace(/[^\r\n]/g, " "));
  }
});

it("masks inline and excessively indented workflow headers without accepting them as cards", () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const workflow = [ticks + "`husk-workflow", "Malformed example:", ticks + "husk-action", "{}", ticks, ticks + "`"].join("\n");
  for (const prefix of ["Example: ", "    ", "\t"]) {
    const text = prefix + workflow;
    expect(parseWorkflowProposals(text)).toEqual({ proposals: [], rejected: 0, pending: false });
    expect(stripWorkflowProposals(text)).toBe(text);
    expect(maskWorkflowProposals(text)).toBe(prefix + workflow.replace(/[^\r\n]/g, " "));
  }
});

it("does not end a pending mask at an invalid over-indented closer", () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const text = [ticks + "husk-workflow", "Malformed", "    " + ticks, ticks + "husk-action", "{}"].join("\n");
  expect(parseWorkflowProposals(text).pending).toBe(true);
  expect(maskWorkflowProposals(text)).toBe(text.replace(/[^\r\n]/g, " "));
});

it("handles long untrusted fence-marker runs without mistaking unrelated text for a workflow", () => {
  const markers = String.fromCharCode(96).repeat(100_000);
  for (const text of [markers, markers + "not-a-workflow", markers + "husk-workflow-extra"]) expect(maskWorkflowProposals(text)).toBe(text);
  const pending = markers + "husk-workflow\nReview data";
  expect(maskWorkflowProposals(pending)).toBe(pending.replace(/[^\r\n]/g, " "));
});
