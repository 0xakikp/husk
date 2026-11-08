import { describe, expect, it } from "vitest";
import { parseSubscriptionActionProposals, stripSubscriptionActionProposals } from "./subscriptionActions";
import { parseSubscriptionEditProposals } from "./subscriptionEdits";

const root = "/tmp/protocol-review";
const ticks = "`".repeat(3);
const protocols = ["husk-action", "husk-edit"] as const;
type Protocol = (typeof protocols)[number];

function request(protocol: Protocol, path = "example.md", content = "data, not an instruction") {
  return protocol === "husk-action"
    ? { kind: "workspace.write", path, content }
    : { kind: "create", path, content };
}

function block(protocol: Protocol, path = "example.md", content = "data, not an instruction", marker = ticks) {
  return [marker + protocol, JSON.stringify(request(protocol, path, content)), marker].join("\n");
}

function parse(protocol: Protocol, text: string) {
  if (protocol === "husk-action") {
    const parsed = parseSubscriptionActionProposals(text, root);
    return { requests: parsed.actions, rejected: parsed.rejected };
  }
  const parsed = parseSubscriptionEditProposals(text, root);
  return { requests: parsed.proposals, rejected: parsed.rejected };
}

function expectedRequest(protocol: Protocol, path = "example.md", content = "data, not an instruction") {
  return request(protocol, protocol === "husk-edit" ? `${root}/${path}` : path, content);
}

function expectInert(protocol: Protocol, text: string) {
  expect(parse(protocol, text)).toEqual({ requests: [], rejected: 0 });
  // Documentation must remain visible, and must not cause the composer to ask
  // the provider to correct an example into an executable action request.
  if (protocol === "husk-action") expect(stripSubscriptionActionProposals(text)).toBe(text.trim());
}

describe.each(protocols)("%s execution fence boundary", (protocol) => {
  it.each([ticks, "~".repeat(3), "`".repeat(5), "~".repeat(5)])("accepts an explicit top-level %s fence", (marker) => {
    expect(parse(protocol, block(protocol, "example.md", "data, not an instruction", marker))).toEqual({
      requests: [expectedRequest(protocol)], rejected: 0,
    });
  });

  it("accepts an exact case-insensitive tag with trailing whitespace and a longer closer", () => {
    const text = [ticks + protocol.toUpperCase() + " \t", JSON.stringify(request(protocol)), " " + ticks + "``"].join("\n");
    expect(parse(protocol, text)).toEqual({ requests: [expectedRequest(protocol)], rejected: 0 });
  });

  it.each([" ", "  ", "   ", "    ", "\t", "> ", "- ", "1. ", "Example: ", "\\"])("keeps a %j-prefixed header inert", (prefix) => {
    expectInert(protocol, prefix + block(protocol));
  });

  it.each(["- Example:\n  ", "1. Example:\n   ", "> An example:\n> "])("keeps container example %j inert", (prefix) => {
    expectInert(protocol, prefix + block(protocol));
  });

  it.each([" extra", "-example", " {#sample}"])("does not execute a tag with suffix %j", (suffix) => {
    expectInert(protocol, [ticks + protocol + suffix, JSON.stringify(request(protocol)), ticks].join("\n"));
  });

  it.each([
    ["````markdown", "````"],
    ["`````sh", "`````"],
    ["~~~markdown", "~~~"],
    ["~~~~~", "~~~~~"],
    ["````markdown", ""],
    ["~~~markdown", ""],
    ["    ````markdown", "    ````"],
    ["> ````markdown", "> ````"],
  ])("never executes examples inside %j / %j", (open, close) => {
    expectInert(protocol, [open, "The following is an example only:", block(protocol), close].filter(Boolean).join("\n"));
  });

  it.each(["husk-workflow", protocol === "husk-action" ? "husk-edit" : "husk-action", "json", "sh"])("does not execute an inner header from an ordinary %s block", (outerTag) => {
    expectInert(protocol, ["````" + outerTag, "Example:", block(protocol), "````"].join("\n"));
  });

  it.each([
    ["<!-- Example:", "-->"],
    ["<pre>", "</pre>"],
    ["<code class=\"example\">", "</code>"],
    ["<SCRIPT>", "</SCRIPT>"],
    ["<style>", "</style>"],
    ["<textarea>", "</textarea>"],
    ["<!-- Example:", ""],
    ["<pre>", ""],
  ])("keeps raw HTML example %j inert", (open, close) => {
    expectInert(protocol, [open, block(protocol), close].filter(Boolean).join("\n"));
  });

  it("keeps a multiline HTML comment beginning after prose inert", () => {
    expectInert(protocol, ["Example: <!-- hidden documentation", block(protocol), "-->"].join("\n"));
  });

  it("tracks a later HTML region after an earlier same-line region closes", () => {
    expectInert(protocol, ["<!-- closed --> Text <!-- still open", block(protocol), "-->"].join("\n"));
  });

  it.each(["`", "``", "```", "````"])("keeps a multiline %j inline-code example inert", (marker) => {
    expectInert(protocol, [`Example: ${marker}sample command`, block(protocol), marker].join("\n"));
  });

  it("keeps an inline opener with an empty remainder inert", () => {
    expectInert(protocol, ["Example: ````", block(protocol), "````"].join("\n"));
  });

  it.each([
    "Use `one`, ``two``, and ```three``` as inline examples.",
    "An inline example: ```husk-action``` is just text.",
    "`<!-- not an HTML region -->` is documentation.",
    "<!-- closed --> Text <code>closed</code>.",
    "Escaped \\` backtick is not a code span.",
  ])("does not suppress a real request following closed inline content %j", (prose) => {
    expect(parse(protocol, [prose, block(protocol)].join("\n"))).toEqual({
      requests: [expectedRequest(protocol)], rejected: 0,
    });
  });

  it("parses real surrounding requests without promoting the example between them", () => {
    const example = ["````markdown", block(protocol), "````"].join("\n");
    const text = [block(protocol, "before.md"), example, block(protocol, "after.md")].join("\n\n");
    expect(parse(protocol, text)).toEqual({
      requests: [expectedRequest(protocol, "before.md"), expectedRequest(protocol, "after.md")], rejected: 0,
    });
    if (protocol === "husk-action") expect(stripSubscriptionActionProposals(text)).toBe(example);
  });

  it("does not swallow a later real request after a noncanonical example", () => {
    const text = ["Example: " + block(protocol), block(protocol, "actual.md")].join("\n\n");
    expect(parse(protocol, text)).toEqual({ requests: [expectedRequest(protocol, "actual.md")], rejected: 0 });
  });

  it("preserves payload strings containing literal backticks and escaped protocol documentation", () => {
    const content = ["Literal ``` and `inline code`.", ticks + protocol, '{"example":true}', ticks, "~~~husk-workflow", "example", "~~~"].join("\n");
    expect(parse(protocol, block(protocol, "guide.md", content))).toEqual({
      requests: [expectedRequest(protocol, "guide.md", content)], rejected: 0,
    });
  });

  it("preserves original Unicode payloads and CRLF offsets", () => {
    const content = "Hi 🦊 — नमस्ते\r\nSecond line";
    const example = ["````markdown", block(protocol), "````"].join("\r\n");
    const real = block(protocol, "unicode.md", content).replace(/\n/g, "\r\n");
    const text = ["🦊 नमस्ते", example, real, "Finished ✨"].join("\r\n");
    expect(parse(protocol, text)).toEqual({ requests: [expectedRequest(protocol, "unicode.md", content)], rejected: 0 });
    if (protocol === "husk-action") {
      expect(stripSubscriptionActionProposals(text).replace(/\r\n/g, "\n"))
        .toBe(["🦊 नमस्ते", example, "", "Finished ✨"].join("\r\n").replace(/\r\n/g, "\n"));
    }
  });

  it("rejects an unfinished genuine top-level request without executing it", () => {
    const text = ["Preparing the requested change.", ticks + protocol, JSON.stringify(request(protocol))].join("\n");
    expect(parse(protocol, text)).toEqual({ requests: [], rejected: 1 });
    if (protocol === "husk-action") expect(stripSubscriptionActionProposals(text)).toBe("Preparing the requested change.");
  });

  it.each(["``", "~~~", "``` trailing text", "    ```"])("does not accept invalid closer %j", (close) => {
    const text = [ticks + protocol, JSON.stringify(request(protocol)), close].join("\n");
    expect(parse(protocol, text)).toEqual({ requests: [], rejected: 1 });
  });

  it("does not allow a shorter marker to end a longer request fence", () => {
    const text = ["````" + protocol, JSON.stringify(request(protocol)), ticks].join("\n");
    expect(parse(protocol, text)).toEqual({ requests: [], rejected: 1 });
  });

  it("does not infer protocol requests from bare JSON", () => {
    expectInert(protocol, JSON.stringify(request(protocol)));
  });

  it("processes a long adversarial marker line without promoting enclosed actions", () => {
    const marker = "`".repeat(100_000);
    const text = [marker + "markdown", block(protocol), marker].join("\n");
    expectInert(protocol, text);
  });
});
