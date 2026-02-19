import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
    OpenRouterClient,
    OpenRouterConversation,
    countTokens,
    estimateTokens,
    clearEncoderCache,
} from "./OpenRouterConversation.js";
import type {
    Message,
    SuccessResponse,
    ErrorResponse,
    ToolCall,
} from "./OpenRouterConversation.js";

// ─────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────

type MockMessageOpts = {
    content?: string;
    tool_calls?: ToolCall[];
};

/** Builds a standard OpenRouter-shaped fetch Response. */
function makeMockResponse(opts: MockMessageOpts = {}): Response {
    const message: Record<string, unknown> = {
        content: opts.content ?? "hello",
        annotations: [],
    };
    if (opts.tool_calls !== undefined) {
        message.tool_calls = opts.tool_calls;
    }
    const body = {
        choices: [{ message }],
        model: "openai/gpt-4o-mini",
        provider: "OpenAI",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

/** Builds a non-2xx fetch Response with an error body. */
function makeErrorResponse(status: number): Response {
    const body = { error: { message: `HTTP ${status}` } };
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/** Extracts and parses the JSON body sent to the mocked fetch. */
function getRequestBody(mockFetch: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
    const [, opts] = mockFetch.mock.calls[callIndex] as [string, RequestInit];
    return JSON.parse(opts.body as string);
}

/** Returns the Headers object sent to the mocked fetch. */
function getRequestHeaders(mockFetch: ReturnType<typeof vi.fn>, callIndex = 0): Headers {
    const [, opts] = mockFetch.mock.calls[callIndex] as [string, RequestInit];
    return opts.headers as Headers;
}

const TEST_MESSAGES: Message[] = [{ role: "user", content: "hi" }];
const TEST_MODEL = "openai/gpt-4o-mini";

// ─────────────────────────────────────────────
// Suite setup
// ─────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────
// Request construction
// ─────────────────────────────────────────────

describe("Request construction", () => {
    it("omits temperature from request body when not specified", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        await client.complete(TEST_MESSAGES, { model: TEST_MODEL });

        const body = getRequestBody(mockFetch);
        expect(body).not.toHaveProperty("temperature");
    });

    it("includes temperature: 0 when explicitly passed", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        await client.complete(TEST_MESSAGES, { model: TEST_MODEL, temperature: 0 });

        const body = getRequestBody(mockFetch);
        expect(body.temperature).toBe(0);
    });

    it("uses model key for a single model", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        await client.complete(TEST_MESSAGES, { model: TEST_MODEL });

        const body = getRequestBody(mockFetch);
        expect(body.model).toBe(TEST_MODEL);
        expect(body).not.toHaveProperty("models");
    });

    it("uses models key for multiple models", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        await client.complete(TEST_MESSAGES, { models: ["a/1", "b/2", "c/3"] });

        const body = getRequestBody(mockFetch);
        expect(body.models).toEqual(["a/1", "b/2", "c/3"]);
        expect(body).not.toHaveProperty("model");
    });

    it("deduplicates models and limits to 3", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        // Pass 5 models with a duplicate; selectModels dedupes then slices to 3.
        await client.complete(TEST_MESSAGES, { models: ["a/1", "b/2", "a/1", "c/3", "d/4"] });

        const body = getRequestBody(mockFetch);
        expect(body.models).toEqual(["a/1", "b/2", "c/3"]);
    });

    it("removeUndefined strips undefined fields from request body", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        // temperature and stop are not passed → must not appear in the serialised body
        await client.complete(TEST_MESSAGES, { model: TEST_MODEL });

        const body = getRequestBody(mockFetch);
        expect(body).not.toHaveProperty("stop");
        expect(body).not.toHaveProperty("top_p");
        expect(body).not.toHaveProperty("presence_penalty");
    });

    it("adjustReasoningParam force-sets enabled: true for builtin reasoning-required models", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        await client.complete(TEST_MESSAGES, {
            model: "openai/gpt-oss-120b",
            reasoning: { effort: "high" },
        });

        const body = getRequestBody(mockFetch);
        const reasoning = body.reasoning as Record<string, unknown>;
        expect(reasoning.enabled).toBe(true);
        expect(reasoning.effort).toBe("high");
    });

    it("adjustReasoningParam passes other reasoning fields through for non-reasoning models", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            reasoning: { effort: "low", max_tokens: 512 },
        });

        const body = getRequestBody(mockFetch);
        const reasoning = body.reasoning as Record<string, unknown>;
        expect(reasoning.effort).toBe("low");
        expect(reasoning.max_tokens).toBe(512);
        // enabled should not be force-injected for normal models
        expect(reasoning).not.toHaveProperty("enabled");
    });

    it("adjustReasoningParam force-sets enabled: true for models in modelsRequiringReasoning config", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({
            apiKey: "test",
            modelsRequiringReasoning: ["custom/think-model"],
        });

        await client.complete(TEST_MESSAGES, {
            model: "custom/think-model",
            reasoning: { effort: "medium" },
        });

        const body = getRequestBody(mockFetch);
        const reasoning = body.reasoning as Record<string, unknown>;
        expect(reasoning.enabled).toBe(true);
    });

    it("autoRotateModels rotates model list left by trial number", async () => {
        // Trial 0 fails with 500, trial 1 succeeds with 200.
        // expectedRunTime: 30 gives sequential behaviour: trial 0 fails fast,
        // then trial 1 is launched. Mocks resolve instantly so no real delay.
        mockFetch
            .mockResolvedValueOnce(makeErrorResponse(500))
            .mockResolvedValueOnce(makeMockResponse());

        const client = new OpenRouterClient({ apiKey: "test" });
        const result = await client.complete(TEST_MESSAGES, {
            models: ["a/1", "b/2", "c/3"],
            maxRetries: 2,
            expectedRunTime: 30,
            autoRotateModels: true,
        });

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        // Trial 0: original order
        const body0 = getRequestBody(mockFetch, 0);
        expect(body0.models).toEqual(["a/1", "b/2", "c/3"]);

        // Trial 1: rotated left by 1
        const body1 = getRequestBody(mockFetch, 1);
        expect(body1.models).toEqual(["b/2", "c/3", "a/1"]);
    });
});

// ─────────────────────────────────────────────
// Response handling
// ─────────────────────────────────────────────

describe("Response handling", () => {
    it("returns a SuccessResponse with the response text on success", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse({ content: "world" }));
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, { model: TEST_MODEL });

        expect(result.success).toBe(true);
        expect((result as SuccessResponse).text).toBe("world");
    });

    it("populates winningUsage from the response usage object", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, { model: TEST_MODEL });

        expect(result.success).toBe(true);
        const { winningUsage } = result as SuccessResponse;
        expect(winningUsage.prompt_tokens).toBe(10);
        expect(winningUsage.completion_tokens).toBe(5);
        expect(winningUsage.total_tokens).toBe(15);
    });

    it("includes tool_calls in the response when the model returns them", async () => {
        const toolCalls: ToolCall[] = [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
        ];
        mockFetch.mockResolvedValueOnce(makeMockResponse({ tool_calls: toolCalls }));
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, { model: TEST_MODEL });

        expect(result.success).toBe(true);
        expect((result as SuccessResponse).tool_calls).toEqual(toolCalls);
    });

    it("getResponse appends assistant message to history on success", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse({ content: "I am fine." }));
        const client = new OpenRouterClient({ apiKey: "test" });
        const conv = client.createConversation();
        conv.addMessage("How are you?");

        await conv.getResponse({ model: TEST_MODEL });

        expect(conv.messages).toHaveLength(2);
        expect(conv.messages[1]).toEqual({ role: "assistant", content: "I am fine." });
    });

    it("getResponse appends tool_calls onto the assistant message when present", async () => {
        const toolCalls: ToolCall[] = [
            { id: "call_1", type: "function", function: { name: "search", arguments: '{}' } },
        ];
        mockFetch.mockResolvedValueOnce(makeMockResponse({ tool_calls: toolCalls }));
        const client = new OpenRouterClient({ apiKey: "test" });
        const conv = client.createConversation();
        conv.addMessage("hi");

        await conv.getResponse({ model: TEST_MODEL });

        expect(conv.messages[1].tool_calls).toEqual(toolCalls);
    });

    it("getResponse does not append a message when the request fails", async () => {
        // Single attempt, 500 → ErrorResponse, no message appended.
        mockFetch.mockResolvedValueOnce(makeErrorResponse(500));
        const client = new OpenRouterClient({ apiKey: "test" });
        const conv = client.createConversation();
        conv.addMessage("hi");

        const result = await conv.getResponse({ model: TEST_MODEL });

        expect(result.success).toBe(false);
        expect(conv.messages).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────
// Retry / error behaviour
// ─────────────────────────────────────────────

describe("Retry and error behaviour", () => {
    it("returns ErrorResponse and does not retry on 401", async () => {
        // maxRetries: 3 but only 1 mock — if it retried it would run out of mocks.
        // expectedRunTime: 30 gives sequential launch; 401 aborts all retries.
        mockFetch.mockResolvedValueOnce(makeErrorResponse(401));
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            maxRetries: 3,
            expectedRunTime: 30,
        });

        expect(result.success).toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns ErrorResponse and does not retry on 403", async () => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(403));
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            maxRetries: 3,
            expectedRunTime: 30,
        });

        expect(result.success).toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on 500 and returns SuccessResponse when the next attempt succeeds", async () => {
        mockFetch
            .mockResolvedValueOnce(makeErrorResponse(500))
            .mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            maxRetries: 2,
            expectedRunTime: 30,
        });

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries when checkResponseAcceptance returns accepted: false", async () => {
        mockFetch
            .mockResolvedValueOnce(makeMockResponse({ content: "bad" }))
            .mockResolvedValueOnce(makeMockResponse({ content: "good" }));

        let callCount = 0;
        const checkResponseAcceptance = vi.fn().mockImplementation(async (text: string) => {
            callCount++;
            if (callCount === 1) return { accepted: false as const, failureReason: "not good enough" };
            return { accepted: true as const };
        });

        const client = new OpenRouterClient({ apiKey: "test" });
        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            maxRetries: 2,
            expectedRunTime: 30,
            checkResponseAcceptance,
        });

        expect(result.success).toBe(true);
        expect((result as SuccessResponse).text).toBe("good");
        expect(checkResponseAcceptance).toHaveBeenCalledTimes(2);
    });

    it("does not retry and returns ErrorResponse when checkResponseAcceptance throws", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const checkResponseAcceptance = vi.fn().mockRejectedValue(new Error("acceptance exploded"));

        const client = new OpenRouterClient({ apiKey: "test" });
        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            maxRetries: 3,
            expectedRunTime: 30,
            checkResponseAcceptance,
        });

        expect(result.success).toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on MalformedJSONError and succeeds when the next attempt returns valid JSON", async () => {
        mockFetch
            .mockResolvedValueOnce(makeMockResponse({ content: "not-valid-json" }))
            .mockResolvedValueOnce(makeMockResponse({ content: '{"answer":"42"}' }));

        const client = new OpenRouterClient({ apiKey: "test" });
        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            format: z.object({ answer: z.string() }),
            maxRetries: 2,
            expectedRunTime: 30,
        });

        expect(result.success).toBe(true);
        expect((result as SuccessResponse).text).toBe('{"answer":"42"}');
    });

    it("fails immediately without fetching when abortSignal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        const client = new OpenRouterClient({ apiKey: "test" });
        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            abortSignal: controller.signal,
        });

        expect(result.success).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("custom retryPolicy overrides the default shouldRetry logic", async () => {
        // Default policy would stop on 401, but the custom policy retries.
        mockFetch
            .mockResolvedValueOnce(makeErrorResponse(401))
            .mockResolvedValueOnce(makeMockResponse());

        const retryPolicy = vi.fn().mockReturnValue({ retry: true });

        const client = new OpenRouterClient({ apiKey: "test" });
        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            maxRetries: 2,
            expectedRunTime: 30,
            retryPolicy,
        });

        expect(result.success).toBe(true);
        expect(retryPolicy).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});

// ─────────────────────────────────────────────
// Structured output
// ─────────────────────────────────────────────

describe("Structured output", () => {
    it("strips markdown fences with the default repairJSON and returns valid JSON text", async () => {
        const fencedContent = "```json\n{\"key\": \"value\"}\n```";
        mockFetch.mockResolvedValueOnce(makeMockResponse({ content: fencedContent }));
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            format: z.object({ key: z.string() }),
        });

        expect(result.success).toBe(true);
        expect((result as SuccessResponse).text).toBe('{"key": "value"}');
    });

    it("returns ErrorResponse when repaired text is still invalid JSON", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse({ content: "this is not json at all" }));
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            format: z.object({}),
            // maxRetries defaults to 1 → single attempt fails → ErrorResponse
        });

        expect(result.success).toBe(false);
        expect((result as ErrorResponse).errorMessage).toMatch(/could not be parsed as JSON/i);
    });

    it("calls a custom repairJSON from config instead of the default", async () => {
        const customRepairJSON = vi.fn().mockImplementation((text: string) => text.trim());
        mockFetch.mockResolvedValueOnce(makeMockResponse({ content: '  {"answer":"42"}  ' }));

        const client = new OpenRouterClient({ apiKey: "test", repairJSON: customRepairJSON });
        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            format: z.object({ answer: z.string() }),
        });

        expect(customRepairJSON).toHaveBeenCalledWith('  {"answer":"42"}  ');
        expect(result.success).toBe(true);
        expect((result as SuccessResponse).text).toBe('{"answer":"42"}');
    });
});

// ─────────────────────────────────────────────
// Conversation management
// ─────────────────────────────────────────────

describe("Conversation management", () => {
    it("addMessage with a string defaults to role 'user'", () => {
        const client = new OpenRouterClient({ apiKey: "test" });
        const conv = client.createConversation();

        conv.addMessage("hello");

        expect(conv.messages[0]).toEqual({ role: "user", content: "hello" });
    });

    it("addMessage with an array joins non-null/undefined strings with newline", () => {
        const client = new OpenRouterClient({ apiKey: "test" });
        const conv = client.createConversation();

        conv.addMessage(["hello", null, undefined, "world"]);

        expect(conv.messages[0]).toEqual({ role: "user", content: "hello\nworld" });
    });

    it("clone() produces a deep copy — mutations do not affect the original", () => {
        const client = new OpenRouterClient({ apiKey: "test" });
        const conv = client.createConversation();
        conv.addMessage("original");

        const clone = conv.clone();
        clone.messages[0].content = "modified";

        expect(conv.messages[0].content).toBe("original");
    });

    it("createConversation() returns an OpenRouterConversation instance", () => {
        const client = new OpenRouterClient({ apiKey: "test" });
        expect(client.createConversation()).toBeInstanceOf(OpenRouterConversation);
    });
});

// ─────────────────────────────────────────────
// Debug mode
// ─────────────────────────────────────────────

describe("Debug mode", () => {
    it("populates attempts with status 'success' on a successful request", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            debug: true,
        });

        expect(result.success).toBe(true);
        const { attempts } = result as SuccessResponse;
        expect(attempts).toBeDefined();
        expect(attempts![0].status).toBe("success");
        expect(attempts![0].trialNumber).toBe(0);
    });

    it("populates attempts with status 'http_error' on an HTTP failure", async () => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(401));
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, {
            model: TEST_MODEL,
            maxRetries: 1,
            expectedRunTime: 30,
            debug: true,
        });

        expect(result.success).toBe(false);
        const { attempts } = result as ErrorResponse;
        expect(attempts).toBeDefined();
        expect(attempts![0].status).toBe("http_error");
    });

    it("does not include attempts in the response when debug is false (default)", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "test" });

        const result = await client.complete(TEST_MESSAGES, { model: TEST_MODEL });

        expect(result).not.toHaveProperty("attempts");
    });
});

// ─────────────────────────────────────────────
// Token counting
// ─────────────────────────────────────────────

describe("Token counting", () => {
    beforeEach(() => {
        clearEncoderCache();
    });

    it("countTokens returns a positive number for a known model", () => {
        const count = countTokens("hello world", "gpt-4");

        expect(typeof count).toBe("number");
        expect(count).toBeGreaterThan(0);
    });

    it("estimateTokens is deterministic when given a fixed random function", () => {
        // Text must be > 1000 chars to trigger sampling rather than exact counting.
        const longText = "The quick brown fox jumps over the lazy dog. ".repeat(30);
        const fixedRandom = () => 0.5;

        const count1 = estimateTokens(longText, "gpt-4", 100, fixedRandom);
        const count2 = estimateTokens(longText, "gpt-4", 100, fixedRandom);

        expect(count1).toBe(count2);
        expect(count1).toBeGreaterThan(0);
    });

    it("clearEncoderCache can be called without throwing", () => {
        expect(() => clearEncoderCache()).not.toThrow();
    });
});

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

describe("Configuration", () => {
    it("complete() throws if configure() was never called", async () => {
        // Use a fresh module instance where defaultClient is null.
        vi.resetModules();
        const { complete: freshComplete } = await import("./OpenRouterConversation.js");

        await expect(
            freshComplete(TEST_MESSAGES, { model: TEST_MODEL })
        ).rejects.toThrow("No OpenRouter client configured");
    });

    it("per-request apiKey overrides the config apiKey in the Authorization header", async () => {
        mockFetch.mockResolvedValueOnce(makeMockResponse());
        const client = new OpenRouterClient({ apiKey: "config-key" });

        await client.complete(TEST_MESSAGES, { model: TEST_MODEL, apiKey: "request-key" });

        const headers = getRequestHeaders(mockFetch);
        expect(headers.get("Authorization")).toBe("Bearer request-key");
    });

    it("configure() replaces the previous default client", async () => {
        vi.resetModules();
        const { configure: freshConfigure, complete: freshComplete } =
            await import("./OpenRouterConversation.js");

        mockFetch.mockResolvedValue(makeMockResponse());

        freshConfigure({ apiKey: "key1" });
        freshConfigure({ apiKey: "key2" });
        await freshComplete(TEST_MESSAGES, { model: TEST_MODEL });

        const headers = getRequestHeaders(mockFetch);
        expect(headers.get("Authorization")).toBe("Bearer key2");
    });
});
