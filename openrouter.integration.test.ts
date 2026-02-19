/**
 * Integration tests — make real HTTP calls to the OpenRouter API.
 *
 * Skipped automatically when OPENROUTER_API_KEY is not set.
 * Run with: OPENROUTER_API_KEY=<key> npm test
 *
 * All prompts are kept to 1–2 sentences and max_tokens: 50 to minimise cost.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OpenRouterClient } from "./OpenRouterConversation.js";
import type { SuccessResponse } from "./OpenRouterConversation.js";

const apiKey = process.env.OPENROUTER_API_KEY;
const TEST_MODEL = "openai/gpt-4o-mini";
const BASE_PARAMS = { max_tokens: 50 } as const;

const suite = apiKey
    ? describe
    : describe.skip.bind(describe);

suite("Integration tests (requires OPENROUTER_API_KEY)", () => {
    // One shared client for all integration tests.
    const client = apiKey
        ? new OpenRouterClient({ apiKey })
        : (null as unknown as OpenRouterClient);

    it("basic completion returns a non-empty string", async () => {
        const result = await client.complete(
            [{ role: "user", content: "Say one word." }],
            { model: TEST_MODEL, ...BASE_PARAMS }
        );

        expect(result.success).toBe(true);
        expect((result as SuccessResponse).text.length).toBeGreaterThan(0);
    });

    it("OpenRouterConversation multi-turn: history has 4 entries after two getResponse() calls", async () => {
        const conv = client.createConversation();
        conv.addUserMessage("Say 'hello'.");

        await conv.getResponse({ model: TEST_MODEL, ...BASE_PARAMS });

        conv.addUserMessage("Now say 'goodbye'.");

        await conv.getResponse({ model: TEST_MODEL, ...BASE_PARAMS });

        // [user, assistant, user, assistant]
        expect(conv.messages).toHaveLength(4);
        expect(conv.messages[0].role).toBe("user");
        expect(conv.messages[1].role).toBe("assistant");
        expect(conv.messages[2].role).toBe("user");
        expect(conv.messages[3].role).toBe("assistant");
    });

    it("structured output with a Zod schema returns valid JSON satisfying the schema", async () => {
        const schema = z.object({ answer: z.string() });

        const result = await client.complete(
            [{ role: "user", content: 'Respond with a JSON object with an "answer" key whose value is the word "yes".' }],
            { model: TEST_MODEL, format: schema, ...BASE_PARAMS }
        );

        expect(result.success).toBe(true);
        const parsed: unknown = JSON.parse((result as SuccessResponse).text);
        const validated = schema.parse(parsed);
        expect(typeof validated.answer).toBe("string");
        expect(validated.answer.length).toBeGreaterThan(0);
    });

    it("maxRetries: 2 with a fast model completes successfully", async () => {
        const result = await client.complete(
            [{ role: "user", content: "Reply with 'ok'." }],
            { model: TEST_MODEL, maxRetries: 2, expectedRunTime: 30, ...BASE_PARAMS }
        );

        expect(result.success).toBe(true);
    });
});
