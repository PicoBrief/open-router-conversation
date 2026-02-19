# OpenRouter Conversation Client

A powerful TypeScript/JavaScript client for [OpenRouter](https://openrouter.ai/) — the universal API gateway that gives you access to dozens of AI models through a single interface.

This library makes working with AI models easy, reliable, and predictable. It handles retries, manages conversations, validates responses, and helps you count tokens to control costs.

## ✨ What This Library Does

Imagine you want to build a chat application or an AI-powered feature. Normally, you'd need to handle many tricky things:

- **What if the AI model is slow or fails?** This library automatically retries requests with backup models.
- **Need the AI to give you data in a specific format?** You can ask for structured JSON output that's guaranteed to match your schema.
- **Building a conversation that remembers previous messages?** The conversation class keeps track of your message history.
- **Want to know how much it costs?** Token counting helps you estimate API usage and costs.
- **Need the AI to call your tools/functions?** Full support for function calling is built-in.

In short, this library is a production-ready wrapper around OpenRouter that handles the boring and complex parts, so you can focus on building your application.

## 📦 Installation

```bash
npm install @pico-brief/open-router-conversation
```

You'll also need these peer dependencies:

```bash
npm install zod
```

## 🏗️ TypeScript

This library is written in TypeScript with full type definitions. All examples in this README use TypeScript syntax.

---

## 🚀 Basic Usage

### Quick Start: Send a Message

For the simplest use case, configure the library once and start sending messages:

```typescript
import { configure, complete } from '@pico-brief/open-router-conversation';

// Configure with your OpenRouter API key
configure({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

// Send a simple message
const result = await complete(
  [{ role: 'user', content: 'What is TypeScript?' }],
  { model: 'openai/gpt-4o-mini' }
);

if (result.success) {
  console.log(result.text);
} else {
  console.error('Error:', result.errorMessage);
}
```

### Maintaining Conversations

Using the `OpenRouterConversation` class is the easiest way to maintain a multi-turn conversation with message history:

```typescript
import { OpenRouterClient } from '@pico-brief/open-router-conversation';

const client = new OpenRouterClient({
  apiKey: process.env.OPENROUTER_API_KEY!,
});
const conversation = client.createConversation();

// Add a system prompt to set behavior
conversation.addSystemMessage('You are a helpful assistant.');
conversation.addUserMessage('What is the capital of France?');

// Get the response
const response = await conversation.getResponse({
  model: 'openai/gpt-4o-mini',
});

if (response.success) {
  console.log('Assistant:', response.text);
  // The response is automatically added to the conversation history!

  // Add another message and continue
  conversation.addUserMessage('What about Spain?');
  const response2 = await conversation.getResponse({
    model: 'openai/gpt-4o-mini',
  });
  console.log('Assistant:', response2.text);
}
```

### Getting Structured Output (JSON)

Zod integration ensures you always get valid JSON that matches your schema:

```typescript
import { z } from 'zod';
import { configure, complete } from '@pico-brief/open-router-conversation';

// Define the structure you want
const WeatherSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  condition: z.string(),
});

configure({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const result = await complete(
  [{ role: 'user', content: 'What is the weather in Tokyo?' }],
  {
    model: 'openai/gpt-4o-mini',
    format: WeatherSchema, // Zod schema ensures valid JSON
  }
);

if (result.success) {
  const weather = WeatherSchema.parse(result.text);
  console.log(`${weather.city}: ${weather.temperature}°C, ${weather.condition}`);
}
```

### Counting Tokens

Keep track of API usage and estimate costs:

```typescript
import { countTokens, estimateTokens } from '@pico-brief/open-router-conversation';

const message = "This is the text you want to count tokens for.";

// Exact count for shorter text
const exactCount = countTokens(message, 'gpt-4o-mini');
console.log(`Exact tokens: ${exactCount}`);

// Efficient estimation for long texts (samples and extrapolates)
const estimatedCount = estimateTokens(veryLongText, 'gpt-4o-mini');
console.log(`Estimated tokens: ${estimatedCount}`);
```

---

## 🔥 Advanced Usage

### Automatic Retries with Multiple Models

Launch multiple requests in parallel and accept the first successful response. This dramatically reduces latency when models are slow:

```typescript
import { OpenRouterClient } from '@pico-brief/open-router-conversation';

const client = new OpenRouterClient({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

// Try up to 3 attempts, each with different models
const result = await client.complete(
  [{ role: 'user', content: 'Explain quantum computing' }],
  {
    // Use multiple models for automatic fallback
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-2.0-flash-exp'],
    maxRetries: 3,
    expectedRunTime: 30, // seconds
    autoRotateModels: true, // Each attempt uses a different model first
  }
);

console.log(`Response came from: ${result.model}`);
console.log(`Usage: ${result.winningUsage.total_tokens} tokens`);
```

### Custom Response Validation

Reject responses that don't meet your criteria and retry automatically:

```typescript
const result = await client.complete(
  [{ role: 'user', content: 'Provide 5 unique color names' }],
  {
    model: 'openai/gpt-4o-mini',
    maxRetries: 3,
    checkResponseAcceptance: async (responseText) => {
      const colors = responseText.split(',').map(s => s.trim());
      if (colors.length !== 5) {
        return {
          accepted: false,
          failureReason: `Expected 5 colors, got ${colors.length}`,
        };
      }
      const uniqueColors = new Set(colors.map(c => c.toLowerCase()));
      if (uniqueColors.size !== 5) {
        return {
          accepted: false,
          failureReason: 'Colors must be unique',
        };
      }
      return { accepted: true };
    },
  }
);
```

### Function / Tool Calling

Define tools that the AI model can call:

```typescript
import { Tool, ToolChoice } from '@pico-brief/open-router-conversation';

const tools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city name',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit',
          },
        },
        required: ['location'],
      },
    },
  },
];

const result = await client.complete(
  [{ role: 'user', content: 'What is the weather in Seattle?' }],
  {
    model: 'openai/gpt-4o-mini',
    tools,
    tool_choice: 'auto' as ToolChoice,
  }
);

if (result.success && result.tool_calls) {
  // The model wants to call a function
  console.log('Tool calls:', result.tool_calls);
  // Execute the tool calls and send results back in a new message
}
```

### Provider Routing Options

Control how OpenRouter routes your requests to different providers:

```typescript
const result = await client.complete(
  [{ role: 'user', content: 'Hello!' }],
  {
    model: 'openai/gpt-4o-mini',
    provider: {
      sort: 'price',              // Sort providers by price
      order: ['DeepInfra', 'Novita'], // Preferred providers only
      allow_fallbacks: true,
      data_collection: 'deny',    // Disable provider data collection
      quantization: 'int8',
    },
  }
);
```

### Model Rotation

Automatically rotate through a list of models on each retry:

```typescript
const result = await client.complete(
  [{ role: 'user', content: 'Generate a poem' }],
  {
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-2.0-flash-exp'],
    maxRetries: 5,
    autoRotateModels: true, // Each retry tries a different model first
  }
);
// Attempt 1: claude, gpt-4o, gemini (claude first)
// Attempt 2: gpt-4o, gemini, claude (gpt-4o first)
// Attempt 3: gemini, claude, gpt-4o (gemini first)
// And so on...
```

### Custom Retry Policy

Define exactly when to retry based on error types:

```typescript
const result = await client.complete(
  [{ role: 'user', content: 'Generate code' }],
  {
    model: 'openai/gpt-4o-mini',
    maxRetries: 5,
    retryPolicy: (error) => {
      // Don't retry on 429 rate limit errors (use your own backoff)
      if ((error as any)?.status === 429) {
        return { retry: false, reason: 'Rate limited, will retry later' };
      }
      // Retry everything else
      return { retry: true };
    },
  }
);
```

### Debug Mode

Get detailed traces of all retry attempts:

```typescript
const result = await client.complete(
  [{ role: 'user', content: 'Explain AI' }],
  {
    model: 'openai/gpt-4o-mini',
    maxRetries: 3,
    debug: true, // Enable debug traces
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku'],
  }
);

if (result.success) {
  console.log('Response:', result.text);
  console.log('Winning usage:', result.winningUsage);
  console.log('All attempt usages:', result.allAttemptUsages);

  if (result.attempts) {
    console.log('Attempt traces:');
    for (const attempt of result.attempts) {
      console.log(`  Trial ${attempt.trialNumber}: ${attempt.status}`);
      console.log(`    Models: ${attempt.models.join(', ')}`);
      if (attempt.error) console.log(`    Error: ${attempt.error}`);
      if (attempt.usage) console.log(`    Tokens: ${attempt.usage.total_tokens}`);
    }
  }
}
```

### Conversation Cloning

Create a copy of a conversation for branching paths:

```typescript
const mainConversation = client.createConversation();
mainConversation.addUserMessage('Hello!');

// Create branches for different response strategies
const branch1 = mainConversation.clone();
const branch2 = mainConversation.clone();

// Each branch evolves independently
branch1.addUserMessage('Be brief.');
branch2.addUserMessage('Be detailed.');

const response1 = await branch1.getResponse({ model: 'openai/gpt-4o-mini' });
const response2 = await branch2.getResponse({ model: 'openai/gpt-4o-mini' });
```

### Multi-Modal Input (Text + Images)

Send images along with text for vision models:

```typescript
import { Message } from '@pico-brief/open-router-conversation';

const message: Message = {
  role: 'user',
  content: [
    { type: 'text', text: 'Describe what you see in this image:' },
    {
      type: 'image_url',
      image_url: {
        url: 'https://example.com/image.jpg',
        detail: 'high',
      },
    },
  ],
};

const result = await client.complete([message], {
  model: 'openai/gpt-4o-mini',
});
```

### Reasoning Models

Use models with extended reasoning capabilities:

```typescript
const result = await client.complete(
  [{ role: 'user', content: 'Solve this complex math problem...' }],
  {
    model: 'openai/gpt-4o-mini',
    reasoning: {
      max_tokens: 10000,
      effort: 'high',
    },
  }
);
```

### Session Persistence

Maintain a session ID across requests for stateful interactions:

```typescript
const sessionId = 'user-123';

const result1 = await client.complete(
  [{ role: 'user', content: 'Remember my name: Alice' }],
  {
    model: 'openai/gpt-4o-mini',
    session_id: sessionId,
  }
);

const result2 = await client.complete(
  [{ role: 'user', content: 'What is my name?' }],
  {
    model: 'openai/gpt-4o-mini',
    session_id: sessionId, // Same session for memory
  }
);
```

### Per-Request Configuration

Override client configuration for specific requests:

```typescript
const client = new OpenRouterClient({
  apiKey: process.env.DEFAULT_API_KEY!,
  httpReferer: 'https://myapp.com',
});

// Use different credentials for this request
const result = await client.complete(
  [{ role: 'user', content: 'Hello' }],
  {
    model: 'openai/gpt-4o-mini',
    apiKey: process.env.SPECIAL_API_KEY!, // Override default
    httpReferer: 'https://special-app.com',
  }
);
```

### Aborting Requests

Cancel in-flight requests using `AbortSignal`:

```typescript
const controller = new AbortController();

// Start a request
const requestPromise = client.complete(
  [{ role: 'user', content: 'Write a long essay...' }],
  {
    model: 'openai/gpt-4o-mini',
    maxRetries: 3,
    abortSignal: controller.signal,
  }
);

// Cancel after 5 seconds
setTimeout(() => controller.abort('Taking too long'), 5000);

const result = await requestPromise;
if (!result.success) {
  console.log('Request aborted:', result.errorMessage);
}
```

### Task Labeling

Organize usage data by task for better observability:

```typescript
const result = await client.complete(
  [{ role: 'user', content: 'Summarize this article' }],
  {
    model: 'openai/gpt-4o-mini',
    taskName: 'article-summary',
  }
);

// Usage data includes the task name
console.log(`Task: ${result.winningUsage.taskName}`);
console.log(`Tokens: ${result.winningUsage.total_tokens}`);
```

---

## API Reference

### Configuration

```typescript
type OpenRouterConfig = {
  apiKey: string;                    // Your OpenRouter API key
  httpReferer?: string;              // Your site URL
  xTitle?: string;                   // Your site name
  modelsRequiringReasoning?: string[]; // Extra models that need forced reasoning
  repairJSON?: (text: string) => string; // Custom JSON repair function
};
```

### Complete Parameters

The `complete()` method accepts two types of parameters:

**API Parameters** (forwarded to OpenRouter):
- `model` or `models`: Model selection
- `format`: Zod schema for structured output
- `temperature`, `max_tokens`, `top_p`, etc.
- `tools`, `tool_choice`: Function calling
- `provider`: Provider routing options
- `reasoning`: Reasoning configuration
- `plugins`: Web search, file parser, etc.

**Client Options** (client-side behavior):
- `apiKey`: Override default for this request
- `maxRetries`: Maximum number of attempts (default: 1)
- `expectedRunTime`: Seconds to wait before fallback
- `autoRotateModels`: Rotate models on retries
- `abortSignal`: Cancel requests
- `retryPolicy`: Custom retry logic
- `checkResponseAcceptance`: Response validation
- `debug`: Enable attempt traces
- `taskName`: Label for usage tracking

### Response Types

```typescript
type SuccessResponse = {
  success: true;
  text: string;
  model: string;
  winningUsage: Usage;
  allAttemptUsages: Usage[];
  annotations: Record<string, unknown>[];
  tool_calls?: ToolCall[];
  attempts?: AttemptTrace[]; // Only when debug: true
};

type ErrorResponse = {
  success: false;
  errorMessage: string;
  allAttemptUsages: Usage[];
  attempts?: AttemptTrace[]; // Only when debug: true
};
```

---

## License

MIT

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
