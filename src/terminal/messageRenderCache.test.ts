import { expect, it, vi } from "vitest";
import { MessageRenderCache } from "./messageRenderCache";

it("does not reparse completed history when a different message streams", () => {
  const cache = new MessageRenderCache<object, object>();
  const old = { content: "old code" };
  const parse = vi.fn(() => ({}));
  const rendered = cache.render(old, ["workspace", false], parse);
  for (let i = 0; i < 100; i++) {
    expect(cache.render(old, ["workspace", false], parse)).toBe(rendered);
    cache.render({ content: `stream ${i}` }, [], () => ({}));
  }
  expect(parse).toHaveBeenCalledTimes(1);
});

it("invalidates updated messages and every changed visual dependency", () => {
  const cache = new MessageRenderCache<object, object>();
  const message = { content: "before" };
  const render = vi.fn(() => ({}));
  const first = cache.render(message, [message.content, "workspace-a", false], render);
  message.content = "after";
  expect(cache.render(message, [message.content, "workspace-a", false], render)).not.toBe(first);
  cache.render(message, [message.content, "workspace-b", false], render);
  cache.render(message, [message.content, "workspace-b", true], render);
  cache.render({ ...message }, [message.content, "workspace-b", true], render);
  expect(render).toHaveBeenCalledTimes(5);
});
