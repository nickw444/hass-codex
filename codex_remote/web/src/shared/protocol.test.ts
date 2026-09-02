import { describe, expect, it } from "vitest";
import { ClientMessage } from "./protocol.js";

describe("gateway protocol", () => {
  it("accepts a nonce-protected hello", () => {
    const result = ClientMessage.safeParse({ type: "hello", requestId: "00000000-0000-0000-0000-000000000000", nonce: "a".repeat(64) });
    expect(result.success).toBe(true);
  });

  it("rejects oversized prompts", () => {
    const result = ClientMessage.safeParse({ type: "prompt.send", requestId: "00000000-0000-0000-0000-000000000000", sessionId: "x", blocks: [{ type: "text", text: "x".repeat(100001) }] });
    expect(result.success).toBe(false);
  });
});
