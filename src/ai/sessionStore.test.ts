import { describe, expect, it } from "vitest";
import { automaticSessionName, clearSessionConversation, conversationIdentity, createSession, getSession, type AiMessage } from "./sessionStore";

it("gives a cleared conversation a fresh identity while preserving its workspace", () => {
  const session = createSession({ workspacePath: "/project" });
  clearSessionConversation(session.id);
  const fresh = getSession(session.id);
  expect(conversationIdentity(fresh)).not.toBe(conversationIdentity(session));
  expect(fresh).toMatchObject({ id: session.id, workspacePath: "/project", messages: [], input: "" });
});

function user(content: string): AiMessage {
  return { role: "user", content };
}

describe("automaticSessionName", () => {
  it("replaces a terminal placeholder with the first useful request", () => {
    expect(automaticSessionName("Terminal 3", [user("Fix the failing login test")]))
      .toBe("Fix the failing login test");
  });

  it("keeps a greeting provisional until a useful request arrives", () => {
    expect(automaticSessionName("Terminal 1", [user("hi")])).toBe("General chat");
    expect(automaticSessionName("General chat", [user("hi"), user("Explain this Docker failure")]))
      .toBe("Explain this Docker failure");
  });

  it("does not overwrite a user-provided name", () => {
    expect(automaticSessionName("Release investigation", [user("check the logs")]))
      .toBe("Release investigation");
  });

  it("keeps empty terminal sessions identifiable", () => {
    expect(automaticSessionName("Terminal 4", [])).toBe("Terminal 4");
  });

  it("truncates long titles for the sidebar", () => {
    const title = automaticSessionName("New AI Chat", [user("a".repeat(60))]);
    expect(title).toHaveLength(40);
    expect(title.endsWith("…")).toBe(true);
  });
});
