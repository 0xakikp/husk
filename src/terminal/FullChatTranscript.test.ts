// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/terminal/FullChatTranscript.css"), "utf8");
const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
const rules = [...sheet.cssRules] as CSSStyleRule[];

function declaration(selector: string, property: string): string {
  const rule = rules.find((candidate) => candidate.selectorText === selector);
  expect(rule, `Missing full-chat rule: ${selector}`).toBeDefined();
  return rule!.style.getPropertyValue(property).trim();
}

describe("full-chat transcript layout boundaries", () => {
  it("scopes every override to full-chat descendants, leaving both terminal docks untouched", () => {
    expect(rules.length).toBeGreaterThan(0);
    const dock = document.createElement("div");
    dock.innerHTML = `<section class="composer-panel composer-dock-side composer-dock-left">
      <div class="composer-messages"><div class="msg-block msg-block-user">
        <div class="msg-block-head"><span class="msg-meta"></span><span class="msg-time"></span></div>
        <div class="msg-block-body"></div><div class="msg-block-after has-trace">
          <div class="ai-reply-trace-summary"></div><div class="ai-reply-trace-details"></div>
          <div class="msg-block-foot"><button class="msg-act"></button></div>
        </div>
      </div><div class="msg-block msg-block-compact"><span class="msg-compact-text"></span>
        <span class="msg-compact-actions"></span></div></div>
      <div class="wb-composer"><textarea class="composer-textarea"></textarea></div>
    </section>`;

    for (const rule of rules) {
      expect(rule.type).toBe(CSSRule.STYLE_RULE);
      for (const selector of rule.selectorText.split(",").map((value) => value.trim())) {
        expect(selector, "Every selector needs its own full-chat boundary").toMatch(/^\.composer-full\s/);
        expect(dock.querySelectorAll(selector), selector).toHaveLength(0);
      }
    }
  });

  it("preserves the chosen font and input sizing instead of shrinking them for density", () => {
    const input = document.createElement("div");
    input.innerHTML = `<section class="composer-panel composer-full"><div class="wb-composer">
      <div class="wb-composer-head"></div><div class="wb-composer-body">
        <textarea class="composer-textarea"></textarea><button class="composer-send-btn"></button>
      </div></div><div class="composer-footer"></div></section>`;

    for (const rule of rules) {
      expect(input.querySelectorAll(rule.selectorText), rule.selectorText).toHaveLength(0);
      for (const property of ["font", "font-size", "font-family", "letter-spacing", "--composer-font-size", "zoom"]) {
        expect(rule.style.getPropertyValue(property), `${rule.selectorText} must not override ${property}`).toBe("");
      }
    }
    const source = readFileSync(resolve("src/terminal/TerminalAiComposer.tsx"), "utf8");
    const baseImport = source.indexOf('import "./TerminalAiComposer.css";');
    expect(baseImport).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('import "./FullChatTranscript.css";')).toBeGreaterThan(baseImport);
  });

  it("places user actions beside their identity while keeping message content on a separate full row", () => {
    const user = ".composer-full .msg-block-user:not(.msg-block-compact)";
    expect(declaration(user, "display")).toBe("grid");
    expect(declaration(`${user} .msg-block-head`, "grid-row")).toBe("1");
    expect(declaration(`${user} .msg-block-head`, "grid-column")).toBe("1");
    expect(declaration(`${user} .msg-block-after`, "grid-row")).toBe("1");
    expect(declaration(`${user} .msg-block-after`, "grid-column")).toBe("2");
    expect(declaration(`${user} .msg-block-body`, "grid-row")).toBe("2");
    expect(declaration(`${user} .msg-block-body`, "grid-column")).toBe("1 / -1");
    expect(declaration(".composer-full .msg-block-user .msg-block-foot", "padding")).toBe("0px");
  });

  it("keeps trace and actions adjacent with wrapping, and expanded details below both", () => {
    const after = ".composer-full .msg-block-after.has-trace";
    expect(declaration(after, "display")).toBe("flex");
    expect(declaration(after, "flex-wrap")).toBe("wrap");
    expect(declaration(`${after} .ai-reply-trace-summary`, "width")).toBe("auto");
    expect(declaration(`${after} .ai-reply-trace-summary`, "flex")).toBe("0 1 auto");
    expect(declaration(`${after} .ai-reply-trace-details`, "order")).toBe("1");
    expect(declaration(`${after} .ai-reply-trace-details`, "flex")).toBe("1 1 100%");
    expect(declaration(`${after} .msg-block-foot`, "height")).toBe("auto");
  });

  it("lets older compact messages wrap without truncation or controls covering the text", () => {
    expect(declaration(".composer-full .msg-block-compact", "flex-wrap")).toBe("wrap");
    expect(declaration(".composer-full .msg-compact-text", "white-space")).toBe("pre-wrap");
    expect(declaration(".composer-full .msg-compact-text", "overflow-wrap")).toBe("anywhere");
    expect(declaration(".composer-full .msg-compact-text", "overflow")).toBe("visible");
    expect(declaration(".composer-full .msg-compact-text", "text-overflow")).toBe("clip");
    expect(declaration(".composer-full .msg-compact-actions", "position")).toBe("static");
    expect(declaration(".composer-full .msg-compact-actions", "opacity")).toBe("1");
    expect(declaration(".composer-full .msg-compact-actions", "pointer-events")).toBe("auto");
  });
});
