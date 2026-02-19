# Open Router Conversation

A TypeScript OpenRouter client built around **parallel retries** — instead of waiting for a slow or failed request to time out before trying again, it fires off concurrent attempts and returns whichever finishes first. You can validate each response before accepting it, automatically rotating models across attempts.

Other features:

- **Structured output** — ask the AI to respond as a typed JSON object using a [Zod](https://zod.dev) schema
- **Conversation history** — keep track of a back-and-forth conversation without manually managing the message list
- **Token counting** — estimate how many tokens a piece of text uses before sending it

---

## Installation

```bash
npm install @pico-brief/open-router-conversation @pico-brief/race-promises zod js-tiktoken
```

---

## Basic example

```typescript
import { configure, complete } from "@pico-brief/open-router-conversation";

// Set your API key once at startup
configure({ apiKey: "sk-or-..." });

// Send a message and get a response
const result = await complete(
  [{ role: "user", content: "What is the capital of France?" }],
  { model: "openai/gpt-4o-mini" }
);

if (result.success) {
  console.log(result.text); // "The capital of France is Paris."
} else {
  console.error(result.errorMessage);
}
```

---

## Multi-turn conversation

Use `OpenRouterConversation` to have a back-and-forth conversation. It remembers everything that was said so you don't have to.

```typescript
import { configure, OpenRouterClient } from "@pico-brief/open-router-conversation";

configure({ apiKey: "sk-or-..." });

const client = new OpenRouterClient({ apiKey: "sk-or-..." });
const conversation = client.createConversation();

// Add a system prompt to set the AI's behavior
conversation.addSystemMessage("You are a helpful cooking assistant.");

// First turn
const response1 = await conversation.getResponse({
  model: "openai/gpt-4o-mini",
});
// Hmm — we should ask something first. Let's do it properly:

conversation.addUserMessage("What can I make with eggs and cheese?");
const r1 = await conversation.getResponse({ model: "openai/gpt-4o-mini" });
if (r1.success) console.log(r1.text);

// The conversation remembers what was said — ask a follow-up
conversation.addUserMessage("How long does that take to cook?");
const r2 = await conversation.getResponse({ model: "openai/gpt-4o-mini" });
if (r2.success) console.log(r2.text);

// Inspect the full history at any time
console.log(conversation.messages);
// [
//   { role: "system",    content: "You are a helpful cooking assistant." },
//   { role: "user",      content: "What can I make with eggs and cheese?" },
//   { role: "assistant", content: "You could make a frittata, an omelette..." },
//   { role: "user",      content: "How long does that take to cook?" },
//   { role: "assistant", content: "A frittata typically takes about 20 minutes..." },
// ]
```

---

## Structured output (JSON responses)

When you need the AI to respond with structured data rather than free text, pass a Zod schema as `format`. The library will ask the AI to return JSON matching that shape, repair minor formatting issues, and validate the result.

```typescript
import { configure, complete } from "@pico-brief/open-router-conversation";
import { z } from "zod";

configure({ apiKey: "sk-or-..." });

const MovieSchema = z.object({
  title: z.string(),
  year:  z.number(),
  genre: z.string(),
});

const result = await complete(
  [{ role: "user", content: "Suggest a classic sci-fi movie." }],
  {
    model:  "openai/gpt-4o-mini",
    format: MovieSchema,
  }
);

if (result.success) {
  const movie = JSON.parse(result.text) as z.infer<typeof MovieSchema>;
  console.log(movie.title); // "2001: A Space Odyssey"
  console.log(movie.year);  // 1968
}
```

---

## Retries and parallel attempts

By default, one attempt is made. Set `maxRetries` to run multiple parallel attempts and use whichever finishes first. Set `expectedRunTime` to control how many seconds to wait before firing a second attempt alongside the first.

```typescript
const result = await complete(
  [{ role: "user", content: "Write a haiku about the ocean." }],
  {
    model:           "openai/gpt-4o-mini",
    maxRetries:      3,   // up to 3 attempts total
    expectedRunTime: 10,  // start a second attempt after 10 seconds if no result yet
  }
);
```

You can also supply multiple models. OpenRouter will try them as fallbacks, and with `autoRotateModels: true` each parallel attempt will start with a different preferred model:

```typescript
const result = await complete(
  [{ role: "user", content: "Explain recursion simply." }],
  {
    models:           ["openai/gpt-4o-mini", "anthropic/claude-haiku", "meta-llama/llama-3-8b-instruct"],
    maxRetries:       3,
    autoRotateModels: true, // attempt 0 tries gpt-4o-mini first, attempt 1 tries claude-haiku first, etc.
    expectedRunTime:  15,
  }
);
```

---

## Custom acceptance check

Sometimes you want to validate the AI's response yourself before accepting it — for example, checking that it contains certain content or meets a quality bar. Pass `checkResponseAcceptance` and return `{ accepted: false }` to trigger a retry.

```typescript
const result = await complete(
  [{ role: "user", content: "Give me a one-word answer: what color is the sky?" }],
  {
    model:      "openai/gpt-4o-mini",
    maxRetries: 5,
    checkResponseAcceptance: async (text) => {
      if (text.toLowerCase().includes("blue")) {
        return { accepted: true };
      }
      return { accepted: false, failureReason: `Response "${text}" did not contain "blue"` };
    },
  }
);
```

---

## Custom retry policy

For full control over which errors are retried, provide a `retryPolicy` function. It receives the thrown error and returns whether to retry and whether to abort all other in-flight attempts.

```typescript
import { HttpError } from "@pico-brief/open-router-conversation";

const result = await complete(messages, {
  model:       "openai/gpt-4o-mini",
  maxRetries:  4,
  retryPolicy: (e) => {
    // Never retry rate limit errors — back off instead
    if (e instanceof HttpError && e.status === 429) {
      return { retry: false, abortAll: true, reason: "rate limited" };
    }
    // Retry everything else
    return { retry: true };
  },
});
```

---

## Cancellation

Pass an `AbortSignal` to cancel all in-flight attempts at once:

```typescript
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

const result = await complete(
  [{ role: "user", content: "Write me a long essay." }],
  {
    model:       "openai/gpt-4o-mini",
    abortSignal: controller.signal,
  }
);
```

---

## Per-request configuration overrides

Any credential set in `configure()` can be overridden per request:

```typescript
configure({ apiKey: "sk-or-default-key" });

const result = await complete(messages, {
  model:  "openai/gpt-4o-mini",
  apiKey: "sk-or-other-key", // uses this key for this request only
});
```

---

## Provider routing

Control which providers OpenRouter routes to for a request:

```typescript
const result = await complete(messages, {
  model:    "openai/gpt-4o-mini",
  provider: {
    order:           ["OpenAI", "Azure"],  // try these providers in order
    allow_fallbacks: true,                 // fall back to others if these fail
    data_collection: "deny",              // opt out of provider data collection
  },
});
```

---

## Debugging retries

Pass `debug: true` to get a structured trace of every attempt that ran, including which models were tried, what happened, and the usage for each:

```typescript
const result = await complete(messages, {
  model:      "openai/gpt-4o-mini",
  maxRetries: 3,
  debug:      true,
});

if (result.attempts) {
  for (const attempt of result.attempts) {
    console.log(`Trial ${attempt.trialNumber}: ${attempt.status}`, attempt.error ?? "");
  }
}

// Full billing picture across all attempts (not just the winner):
console.log(result.allAttemptUsages);
```

---

## Token counting

```typescript
import { countTokens, estimateTokens, clearEncoderCache } from "@pico-brief/open-router-conversation";

// Exact count (encodes the full string)
const exact = countTokens("Hello, world!", "gpt-4");
console.log(exact); // 4

// Fast estimate for large texts (uses random sampling, much faster than full encode)
const estimate = estimateTokens(bigString, "gpt-4");

// Free encoder memory when you're done (useful in workers or long-running processes)
clearEncoderCache();
```

---

## Using your own JSON repair library

The default JSON repair just strips markdown code fences. For production structured output use cases, inject a proper repair library:

```typescript
import { jsonrepair } from "jsonrepair";

configure({
  apiKey:     "sk-or-...",
  repairJSON: jsonrepair,
});
```

---

## Full configuration reference

```typescript
configure({
  apiKey:                    "sk-or-...",   // required
  httpReferer:               "https://myapp.com",  // shown on OpenRouter leaderboards
  xTitle:                    "My App",             // shown on OpenRouter leaderboards
  modelsRequiringReasoning:  ["my-org/custom-model"], // force reasoning=enabled for these
  repairJSON:                jsonrepair,    // inject a JSON repair function
});
```

### `RequestParams` fields

| Field | Type | Description |
|---|---|---|
| `model` | `string` | Single model to use |
| `models` | `string[]` | Up to 3 models for automatic fallback |
| `temperature` | `number` | 0–2. Omit to use provider default. Pass `0` for deterministic output |
| `max_tokens` | `number` | Maximum tokens in the response |
| `format` | `z.ZodObject` | Zod schema for structured JSON output |
| `maxRetries` | `number` | Maximum number of parallel attempts (default: 1) |
| `expectedRunTime` | `number` | Seconds before firing a second parallel attempt (default: 30) |
| `autoRotateModels` | `boolean` | Rotate model priority across attempts |
| `abortSignal` | `AbortSignal` | Cancel all in-flight attempts |
| `checkResponseAcceptance` | `function` | Validate response before accepting |
| `retryPolicy` | `function` | Custom retry logic |
| `debug` | `boolean` | Include attempt trace in response |
| `taskName` | `string` | Label attached to usage records for cost tracking |
| `provider` | `Provider` | Provider routing preferences |
| `reasoning` | `Reasoning` | Reasoning/thinking token configuration |
| `tools` | `Tool[]` | Function calling tools |
| `tool_choice` | `ToolChoice` | How the model should choose tools |
| `session_id` | `string` | Group related requests for observability |
| `apiKey` | `string` | Per-request API key override |
