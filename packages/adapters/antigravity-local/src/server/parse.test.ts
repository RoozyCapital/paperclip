import { describe, expect, it } from "vitest";
import {
  detectAntigravityAuthRequired,
  isAntigravityTransientNetworkError,
  isAntigravitySessionUnrecoverableError,
  parseAntigravityJsonl,
} from "./parse.js";

describe("parseAntigravityJsonl", () => {
  it("collects assistant text from message events with string content", () => {
    const stdout = [
      '{"type":"init","session_id":"session-1"}',
      '{"type":"message","role":"user","content":"Respond with hello."}',
      '{"type":"message","role":"assistant","content":"hello","delta":true}',
      '{"type":"result","status":"success"}',
    ].join("\n");

    const parsed = parseAntigravityJsonl(stdout);

    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.summary).toBe("hello");
    expect(parsed.errorMessage).toBeNull();
  });

  it("collects assistant text from message events with structured object content", () => {
    const stdout = [
      '{"type":"init","session_id":"session-2"}',
      '{"type":"message","role":"assistant","content":{"content":[{"type":"text","text":"first part"},{"type":"text","text":"second part"}]}}',
      '{"type":"result","status":"success"}',
    ].join("\n");

    const parsed = parseAntigravityJsonl(stdout);

    expect(parsed.sessionId).toBe("session-2");
    expect(parsed.summary).toBe("first part\n\nsecond part");
    expect(parsed.errorMessage).toBeNull();
  });

  it("ignores non-assistant message events", () => {
    const stdout = [
      '{"type":"message","role":"user","content":"hidden user input"}',
      '{"type":"message","role":"system","content":"hidden system note"}',
      '{"type":"message","role":"assistant","content":"visible response"}',
      '{"type":"result","status":"success"}',
    ].join("\n");

    const parsed = parseAntigravityJsonl(stdout);

    expect(parsed.summary).toBe("visible response");
  });

  it("captures assistant text from stream-json schema", () => {
    const stdout = [
      JSON.stringify({
        type: "init",
        timestamp: "2026-05-04T05:43:41.203Z",
        session_id: "session-abc",
        model: "auto",
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-05-04T05:43:41.205Z",
        role: "user",
        content: "Respond with hello.",
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-05-04T05:43:45.198Z",
        role: "assistant",
        content: "hello.",
        delta: true,
      }),
      JSON.stringify({
        type: "result",
        timestamp: "2026-05-04T05:43:45.819Z",
        status: "success",
        stats: {
          total_tokens: 9468,
          input_tokens: 9095,
          output_tokens: 29,
          cached: 8132,
          duration_ms: 4616,
        },
      }),
    ].join("\n");

    const result = parseAntigravityJsonl(stdout);
    expect(result.summary).toBe("hello.");
    expect(result.sessionId).toBe("session-abc");
    expect(result.errorMessage).toBeNull();
    expect(result.usage.inputTokens).toBe(9095);
    expect(result.usage.outputTokens).toBe(29);
    expect(result.usage.cachedInputTokens).toBe(8132);
  });

  it("flags result events with status=error", () => {
    const stdout = [
      JSON.stringify({
        type: "result",
        status: "error",
        error: "boom",
      }),
    ].join("\n");

    const result = parseAntigravityJsonl(stdout);
    expect(result.errorMessage).toBe("boom");
  });

  it("classifies non-interactive manual authorization failures as auth required", () => {
    const result = detectAntigravityAuthRequired({
      parsed: null,
      stdout: "",
      stderr:
        "Error authenticating: FatalAuthenticationError: Manual authorization is required but the current session is non-interactive.",
    });

    expect(result.requiresAuth).toBe(true);
  });
});

describe("isAntigravitySessionUnrecoverableError", () => {
  it("matches 'unknown session'", () => {
    expect(isAntigravitySessionUnrecoverableError("", "Error: unknown session 'abc-123'")).toBe(true);
  });

  it("matches 'session ... not found'", () => {
    expect(isAntigravitySessionUnrecoverableError("", "Resumed session abc-123 not found on disk")).toBe(true);
  });

  it("does not match unrelated stderr", () => {
    expect(isAntigravitySessionUnrecoverableError("", "Some other error")).toBe(false);
  });
});

describe("isAntigravityTransientNetworkError", () => {
  it("matches DNS failure on oauth2.googleapis.com", () => {
    const stderr =
      "_GaxiosError: request to https://oauth2.googleapis.com/token failed, reason: getaddrinfo ENOTFOUND oauth2.googleapis.com";
    expect(isAntigravityTransientNetworkError("", stderr)).toBe(true);
  });

  it("matches EAI_AGAIN", () => {
    expect(
      isAntigravityTransientNetworkError("", "Error: getaddrinfo EAI_AGAIN sts.googleapis.com"),
    ).toBe(true);
  });
});
