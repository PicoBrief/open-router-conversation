import racePromises from "@pico-brief/race-promises";
import { z } from "zod";
import { encodingForModel, TiktokenModel } from "js-tiktoken";

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export type OpenRouterConfig = {
    apiKey: string;
    httpReferer?: string;
    xTitle?: string;
    /** Extra model names that require reasoning to be force-enabled. */
    modelsRequiringReasoning?: string[];
    /**
     * Inject a JSON repair function for structured output responses.
     * Defaults to stripping markdown fences only.
     * Recommended: pass `require('jsonrepair').jsonrepair` here.
     */
    repairJSON?: (text: string) => string;
};

// ─────────────────────────────────────────────
// Message / content types
// ─────────────────────────────────────────────

export type TextContentPart  = { type: "text"; text: string };
export type ImageContentPart = {
    type: "image_url";
    image_url: { url: string; detail?: "auto" | "low" | "high" };
};
export type MessageContent = string | (TextContentPart | ImageContentPart)[];

export type Message = {
    role: "system" | "user" | "assistant" | "tool";
    content: MessageContent;
    name?: string;
    tool_call_id?: string;
    /** Present on assistant messages when the model requested tool calls. */
    tool_calls?: ToolCall[];
};

// ─────────────────────────────────────────────
// Provider / routing types
// ─────────────────────────────────────────────

export type ProviderSort           = "price" | "throughput" | "latency";
export type ProviderDataCollection = "allow" | "deny";
export type ProviderQuantization   =
    | "int4" | "int8" | "fp4" | "fp6" | "fp8"
    | "fp16" | "bf16" | "fp32" | "unknown";

export type Provider = {
    order?: string[];
    only?: string[];
    ignore?: string[];
    sort?: ProviderSort;
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
    data_collection?: ProviderDataCollection;
    quantization?: ProviderQuantization;
    max_price?: { prompt: number; completion: number };
};

// ─────────────────────────────────────────────
// Reasoning
// ─────────────────────────────────────────────

export type Reasoning = {
    effort?: "low" | "medium" | "high" | "minimal" | "none";
    max_tokens?: number;
    exclude?: boolean;
    enabled?: boolean;
};

// ─────────────────────────────────────────────
// Plugins
// ─────────────────────────────────────────────

type WebPlugin             = { id: "web"; engine?: "native" | "exa"; max_results?: number; search_prompt?: string };
type FileParserPlugin      = { id: "file-parser" };
type ResponseHealingPlugin = { id: "response-healing" };
export type Plugin = WebPlugin | FileParserPlugin | ResponseHealingPlugin;

// ─────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────

export type ToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

export type Tool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ToolChoice =
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };

// ─────────────────────────────────────────────
// Model selection
// ─────────────────────────────────────────────

type WithSingleModel = { model: string;                 models?: never };
type WithModelList   = { models: [string, ...string[]]; model?:  never };
export type ModelSelection = WithSingleModel | WithModelList;

// ─────────────────────────────────────────────
// Params: API fields vs. client behavior
// ─────────────────────────────────────────────

/**
 * Parameters forwarded directly to the OpenRouter API request body.
 * All fields here map 1:1 to OpenRouter / OpenAI Chat Completions parameters.
 */
export type APIParams = ModelSelection & {
    // z.ZodObject<any>: Zod's type hierarchy makes a tighter bound impractical
    // without forcing callers to specify generic arguments. Runtime validation
    // happens via z.toJSONSchema().
    format?: z.ZodObject<any>;
    provider?: Provider;
    reasoning?: Reasoning;
    plugins?: Plugin[];
    /**
     * Sampling temperature (0–2). When omitted, the provider's default is used.
     * Pass `0` explicitly for deterministic/greedy output.
     */
    temperature?: number;
    max_tokens?: number;
    stop?: string | string[];
    top_p?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    seed?: number;
    logprobs?: boolean;
    top_logprobs?: number;
    logit_bias?: Record<string, number>;
    tools?: Tool[];
    tool_choice?: ToolChoice;
    modalities?: ("text" | "image")[];
    web_search_options?: { search_context_size?: "low" | "medium" | "high" };
    route?: "fallback" | "sort";
    session_id?: string;
    user?: string;
    metadata?: Record<string, string>;
};

/**
 * Parameters that control client-side behavior: retries, acceptance checks,
 * observability labels, and per-request credential overrides.
 * None of these are forwarded to the API.
 */
export type ClientOptions = {
    apiKey?: string;
    httpReferer?: string;
    xTitle?: string;
    taskName?: string;
    maxRetries?: number;
    expectedRunTime?: number;
    autoRotateModels?: boolean;
    abortSignal?: AbortSignal;
    /**
     * Custom retry policy. Called on every attempt failure.
     * Return `{ retry: false }` to stop all attempts immediately.
     * Return `{ retry: false, abortAll: true }` to also abort any in-flight attempts.
     * When omitted, the default policy retries on most errors and stops on
     * auth failures, AbortErrors, and NonRetryableErrors.
     */
    retryPolicy?: (e: unknown) => { retry: boolean; abortAll?: boolean; reason?: string };
    checkResponseAcceptance?: (
        response: string
    ) => Promise<{ accepted: true } | { accepted: false; failureReason: string }>;
    /**
     * When true, each response includes an `attempts` array with a structured
     * trace of every attempt that ran. Useful for debugging retry behavior.
     * Default: false.
     */
    debug?: boolean;
};

/** The full set of options passed to `complete()` and `getResponse()`. */
export type RequestParams = APIParams & ClientOptions;

// ─────────────────────────────────────────────
// Usage & response types
// ─────────────────────────────────────────────

export type Usage = {
    model: string;
    provider: string;
    duration: number;
    trialNumber: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
        reasoning_tokens?: number;
        audio_tokens?: number;
        accepted_prediction_tokens?: number;
        rejected_prediction_tokens?: number;
    };
    prompt_tokens_details?: {
        cached_tokens?: number;
        cache_write_tokens?: number;
        audio_tokens?: number;
    };
    taskName?: string;
} & Record<string, unknown>;

export type AttemptStatus =
    | "success"
    | "rejected"       // passed acceptance check but rejected
    | "http_error"
    | "parse_error"    // response could not be parsed as expected
    | "aborted"
    | "unknown_error";

export type AttemptTrace = {
    trialNumber: number;
    models: string[];
    status: AttemptStatus;
    error?: string;
    usage?: Usage;
};

export type SuccessResponse = {
    success: true;
    text: string;
    /** Usage from the winning attempt only. */
    winningUsage: Usage;
    /**
     * Usages from attempts that completed and recorded usage before the winner
     * was chosen. In-flight losers are aborted when a winner is found, so they
     * typically won't appear here — but any loser that finished before the abort
     * will have written its usage and will be included.
     */
    allAttemptUsages: Usage[];
    annotations: Record<string, unknown>[];
    model: string;
    tool_calls?: ToolCall[];
    /** Populated when `debug: true` is passed in ClientOptions. */
    attempts?: AttemptTrace[];
};

export type ErrorResponse = {
    success: false;
    errorMessage: string;
    /** Usages from all attempts that completed before the final failure. */
    allAttemptUsages: Usage[];
    /** Populated when `debug: true` is passed in ClientOptions. */
    attempts?: AttemptTrace[];
};

// ─────────────────────────────────────────────
// Typed errors (internal)
// ─────────────────────────────────────────────

/** The LLM responded but the response failed acceptance criteria. Always retryable. */
class ResponseRejectedError extends Error {
    constructor(public readonly failureReason: string, public readonly trialNumber: number) {
        super(`Response rejected at trial ${trialNumber}: ${failureReason}`);
        this.name = "ResponseRejectedError";
    }
}

/**
 * Wraps errors that must never be retried — e.g. a bug in the caller's
 * `checkResponseAcceptance` function, or a deliberate abort.
 */
class NonRetryableError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = "NonRetryableError";
    }
}

/**
 * Thrown for non-2xx HTTP responses. Carries `status` and `body` as typed
 * fields so `shouldRetry` can inspect them without casting.
 */
class HttpError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly body: Record<string, unknown>
    ) {
        super(message);
        this.name = "HttpError";
    }
}

/**
 * Thrown when structured output JSON cannot be parsed after repair.
 * Always retryable — this is an LLM output quality failure.
 */
class MalformedJSONError extends Error {
    constructor(public readonly rawText: string, cause: unknown) {
        super(`Structured output could not be parsed as JSON: ${extractErrorMessage(cause)}`);
        this.name = "MalformedJSONError";
        this.cause = cause;
    }
}

// ─────────────────────────────────────────────
// Built-in reasoning model set
// ─────────────────────────────────────────────

const BUILTIN_MODELS_REQUIRING_REASONING: ReadonlySet<string> = new Set([
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
]);

// ─────────────────────────────────────────────
// Signal helpers
// ─────────────────────────────────────────────

/**
 * Combines multiple AbortSignals into one that aborts when any input aborts.
 * Polyfills `AbortSignal.any` for runtimes that don't support it (Node < 20).
 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
    if (typeof AbortSignal.any === "function") {
        return AbortSignal.any(signals);
    }
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            return controller.signal;
        }
        // { once: true } ensures the listener removes itself after firing.
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}

/**
 * Returns true if `e` looks like an abort-caused rejection.
 *
 * Checks in order of reliability:
 *   1. `.name === "AbortError"` — standard DOMException name (browsers, Node fetch)
 *   2. `.code === "ABORT_ERR"` — undici and some Node internals
 *   3. `.message` contains "abort" — last resort; intentionally narrow to avoid
 *      misclassifying unrelated errors like "transaction aborted"
 */
function isAbortError(e: unknown): boolean {
    if (e == null) return false;
    const err = e as Record<string, unknown>;
    return (
        err.name === "AbortError" ||
        err.code === "ABORT_ERR" ||
        (typeof err.message === "string" && /\babort\b/i.test(err.message))
    );
}

// ─────────────────────────────────────────────
// Default retry policy
// ─────────────────────────────────────────────

type RetryDecision = { retry: boolean; abortAll?: boolean; reason?: string };

function defaultRetryPolicy(e: unknown, abortSignal: AbortSignal | undefined): RetryDecision {
    if (abortSignal?.aborted || isAbortError(e)) {
        return { retry: false, abortAll: true, reason: "caller aborted" };
    }
    if (e instanceof NonRetryableError) {
        return { retry: false, abortAll: true, reason: "non-retryable error" };
    }
    if (e instanceof HttpError) {
        if (e.status === 401 || e.status === 403) {
            return { retry: false, abortAll: true, reason: "auth failure" };
        }
        return { retry: true };
    }
    if (e instanceof ResponseRejectedError) return { retry: true };
    if (e instanceof MalformedJSONError)    return { retry: true };
    return { retry: true };
}

// ─────────────────────────────────────────────
// Attempt pipeline helpers
// ─────────────────────────────────────────────

function selectModels(
    apiParams: APIParams,
    trialNumber: number,
    autoRotateModels: boolean
): string[] {
    let modelList: string[] = apiParams.models
        ? [...apiParams.models]
        : [apiParams.model!];
    if (autoRotateModels) modelList = rotateLeft(modelList, trialNumber);
    return unique(modelList).slice(0, 3); // OpenRouter max for auto-fallback
}

function buildAttemptSignal(
    controller: AbortController,
    userSignal: AbortSignal | undefined
): AbortSignal {
    return userSignal
        ? combineSignals([userSignal, controller.signal])
        : controller.signal;
}

type RawResponse = {
    responseData: Record<string, unknown>;
    duration: number;
};

async function executeRequest(
    url: string,
    body: string,
    headers: Headers,
    signal: AbortSignal
): Promise<RawResponse> {
    const startTime = Date.now();
    const res = await fetch(url, { method: "POST", headers, body, signal });

    if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = (errBody?.error as Record<string, unknown>)?.message as string
            ?? `HTTP ${res.status}`;
        throw new HttpError(msg, res.status, errBody);
    }

    const responseData = await res.json() as Record<string, unknown>;
    return { responseData, duration: Date.now() - startTime };
}

type ParsedChoice = {
    responseText: string;
    annotations: Record<string, unknown>[];
    toolCalls: ToolCall[] | undefined;
};

function parseChoice(responseData: Record<string, unknown>): ParsedChoice {
    const choices = responseData.choices as Record<string, unknown>[] | undefined;
    const choice  = choices?.[0];
    if (!choice) throw new Error("No choices returned in response");

    const message = choice.message as Record<string, unknown>;
    return {
        responseText: (message.content as string | null) ?? "",
        annotations:  (message.annotations as Record<string, unknown>[]) ?? [],
        toolCalls:    message.tool_calls as ToolCall[] | undefined,
    };
}

/**
 * Applies JSON repair and then validates the result parses as JSON.
 * Throws `MalformedJSONError` (retryable) if the repaired text is still invalid.
 */
function repairAndValidateJSON(text: string, repairFn: (s: string) => string): string {
    const repaired = repairFn(text);
    try {
        JSON.parse(repaired);
    } catch (e) {
        throw new MalformedJSONError(text, e);
    }
    return repaired;
}

// ─────────────────────────────────────────────
// OpenRouterClient
// ─────────────────────────────────────────────

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterClient {
    constructor(private readonly config: OpenRouterConfig) {}

    async complete(
        messages: Message[],
        params: RequestParams
    ): Promise<SuccessResponse | ErrorResponse> {
        // Explicitly split RequestParams into its two halves at the entry point.
        // `apiParams` is forwarded to the wire; ClientOptions stay local.
        const {
            apiKey:                   apiKeyOpt,
            httpReferer:              httpRefererOpt,
            xTitle:                   xTitleOpt,
            taskName,
            maxRetries:               maxRetriesOpt,
            expectedRunTime:          expectedRunTimeOpt,
            autoRotateModels:         autoRotateModelsOpt,
            abortSignal,
            retryPolicy:              customRetryPolicy,
            checkResponseAcceptance:  checkResponseAcceptanceOpt,
            debug = false,
            ...apiParams
        } = params;

        const apiKey      = apiKeyOpt      ?? this.config.apiKey;
        const httpReferer = httpRefererOpt ?? this.config.httpReferer;
        const xTitle      = xTitleOpt      ?? this.config.xTitle;

        const maxRetries       = Math.max(1, maxRetriesOpt ?? 1);
        const expectedRunTime  = expectedRunTimeOpt ?? 30;
        const autoRotateModels = autoRotateModelsOpt ?? false;
        const checkResponseAcceptance =
            checkResponseAcceptanceOpt ?? (() => Promise.resolve({ accepted: true as const }));
        const repairJSONFn = this.config.repairJSON ?? defaultRepairJSON;
        const extraModels  = this.config.modelsRequiringReasoning ?? [];

        const attemptControllers: AbortController[] = [];
        let winnerChosen = false;

        function abortLosers(reason: string, winner?: AbortController): void {
            for (const c of attemptControllers) {
                if (c !== winner && !c.signal.aborted) c.abort(reason);
            }
        }

        // Pre-allocated slots for deterministic, contention-free per-attempt output.
        const usageSlots:  (Usage | null)[]        = Array(maxRetries).fill(null);
        const errorSlots:  (string | null)[]       = Array(maxRetries).fill(null);
        const traceSlots:  (AttemptTrace | null)[] = debug ? Array(maxRetries).fill(null) : [];
        let nextTrialNumber = 0;

        try {
            const result = await racePromises({
                amount: maxRetries,
                waitTimeSeconds: expectedRunTime,

                shouldRetry: (e: unknown) => {
                    const decision = customRetryPolicy
                        ? customRetryPolicy(e)
                        : defaultRetryPolicy(e, abortSignal);
                    if (!decision.retry || decision.abortAll) {
                        abortLosers(decision.reason ?? "stopping retries");
                    }
                    return decision.retry;
                },

                onBackgroundError: (_e: unknown) => {
                    // Aborted losers reject with AbortError; suppress to prevent
                    // unhandled rejection warnings.
                },

                generatePromise: async () => {
                    if (abortSignal?.aborted) {
                        throw new NonRetryableError("Aborted by caller before attempt started");
                    }

                    // Both captured synchronously before any await.
                    const slotIndex   = nextTrialNumber;
                    const trialNumber = nextTrialNumber++;

                    const controller    = new AbortController();
                    attemptControllers.push(controller);
                    const signal        = buildAttemptSignal(controller, abortSignal);
                    const dedupedModels = selectModels(apiParams, trialNumber, autoRotateModels);

                    const headers = new Headers({
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    });
                    if (httpReferer) headers.set("HTTP-Referer", httpReferer);
                    if (xTitle)      headers.set("X-Title",      xTitle);

                    const body = buildRequestBody(messages, dedupedModels, apiParams, extraModels);

                    // ── fetch ──────────────────────────────────────────────
                    let rawResponse: RawResponse;
                    try {
                        rawResponse = await executeRequest(OPENROUTER_URL, body, headers, signal);
                    } catch (e) {
                        const status: AttemptStatus = isAbortError(e) ? "aborted"
                            : e instanceof HttpError   ? "http_error"
                                : "unknown_error";
                        const msg = extractErrorMessage(e);
                        errorSlots[slotIndex] = `[trial ${trialNumber}] ${msg}`;
                        if (debug) traceSlots[slotIndex] = { trialNumber, models: dedupedModels, status, error: msg };
                        throw e;
                    }

                    const { responseData, duration } = rawResponse;

                    // ── parse ──────────────────────────────────────────────
                    let parsed: ParsedChoice;
                    try {
                        parsed = parseChoice(responseData);
                    } catch (e) {
                        const msg = extractErrorMessage(e);
                        errorSlots[slotIndex] = `[trial ${trialNumber}] ${msg}`;
                        if (debug) traceSlots[slotIndex] = { trialNumber, models: dedupedModels, status: "parse_error", error: msg };
                        throw e;
                    }

                    let { responseText } = parsed;
                    const { annotations, toolCalls } = parsed;
                    const rawUsage = (responseData.usage ?? {}) as Record<string, unknown>;
                    const usage: Usage = {
                        ...(taskName ? { taskName } : {}),
                        model:                      responseData.model as string,
                        provider:                   (responseData.provider as string) ?? "",
                        duration,
                        trialNumber,
                        prompt_tokens:              (rawUsage.prompt_tokens as number) ?? 0,
                        completion_tokens:          (rawUsage.completion_tokens as number) ?? 0,
                        total_tokens:               (rawUsage.total_tokens as number) ?? 0,
                        completion_tokens_details:  rawUsage.completion_tokens_details as Usage["completion_tokens_details"],
                        prompt_tokens_details:      rawUsage.prompt_tokens_details as Usage["prompt_tokens_details"],
                        ...rawUsage, // spread remaining fields to satisfy `& Record<string, unknown>`
                    };
                    usageSlots[slotIndex] = usage;

                    // ── structured output repair + validation ──────────────
                    if (apiParams.format) {
                        try {
                            responseText = repairAndValidateJSON(responseText, repairJSONFn);
                        } catch (e) {
                            const msg = extractErrorMessage(e);
                            errorSlots[slotIndex] = `[trial ${trialNumber}] ${msg}`;
                            if (debug) traceSlots[slotIndex] = { trialNumber, models: dedupedModels, status: "parse_error", error: msg, usage };
                            throw e;
                        }
                    }

                    // ── acceptance check ───────────────────────────────────
                    let acceptance: { accepted: true } | { accepted: false; failureReason: string };
                    try {
                        acceptance = await checkResponseAcceptance(responseText);
                    } catch (checkError) {
                        throw new NonRetryableError(
                            `checkResponseAcceptance threw: ${extractErrorMessage(checkError)}`,
                            checkError
                        );
                    }

                    if (!acceptance.accepted) {
                        const err = new ResponseRejectedError(acceptance.failureReason, trialNumber);
                        errorSlots[slotIndex] = `[trial ${trialNumber}] ${err.message}`;
                        if (debug) traceSlots[slotIndex] = { trialNumber, models: dedupedModels, status: "rejected", error: err.message, usage };
                        throw err;
                    }

                    // ── winner ─────────────────────────────────────────────
                    if (!winnerChosen) {
                        winnerChosen = true;
                        abortLosers("race winner chosen", controller);
                    }

                    if (debug) traceSlots[slotIndex] = { trialNumber, models: dedupedModels, status: "success", usage };

                    return {
                        success: true as const,
                        text:         responseText,
                        winningUsage: usage,
                        annotations,
                        model:        responseData.model as string,
                        ...(toolCalls ? { tool_calls: toolCalls } : {}),
                    };
                },
            });

            const allAttemptUsages = usageSlots.filter((u): u is Usage => u !== null);
            const attempts         = debug ? traceSlots.filter((t): t is AttemptTrace => t !== null) : undefined;
            return { ...result, allAttemptUsages, ...(debug ? { attempts } : {}) };

        } catch (e) {
            const slottedErrors    = errorSlots.filter((s): s is string => s !== null);
            const errorMessage     = slottedErrors.length > 0
                ? slottedErrors.join(" | ")
                : extractErrorMessage(e);
            const allAttemptUsages = usageSlots.filter((u): u is Usage => u !== null);
            const attempts         = debug ? traceSlots.filter((t): t is AttemptTrace => t !== null) : undefined;
            return { success: false, errorMessage, allAttemptUsages, ...(debug ? { attempts } : {}) };
        }
    }

    createConversation(): OpenRouterConversation {
        return new OpenRouterConversation(this);
    }
}

// ─────────────────────────────────────────────
// Module-level convenience API
// ─────────────────────────────────────────────

let defaultClient: OpenRouterClient | null = null;

export function configure(config: OpenRouterConfig): void {
    defaultClient = new OpenRouterClient(config);
}

function getDefaultClient(): OpenRouterClient {
    if (!defaultClient) {
        throw new Error(
            "No OpenRouter client configured. Call configure({ apiKey }) first, " +
            "or instantiate OpenRouterClient directly."
        );
    }
    return defaultClient;
}

export async function complete(
    messages: Message[],
    params: RequestParams
): Promise<SuccessResponse | ErrorResponse> {
    return getDefaultClient().complete(messages, params);
}

// ─────────────────────────────────────────────
// Conversation class
// ─────────────────────────────────────────────

export class OpenRouterConversation {
    messages: Message[] = [];

    constructor(private readonly client: OpenRouterClient) {}

    addMessage(
        content: string | (string | null | undefined)[] | Message,
        role: Message["role"] = "user"
    ): void {
        if (Array.isArray(content)) {
            content = content.filter((s): s is string => s != null).join("\n");
        }
        if (typeof content === "string") {
            content = { role, content };
        }
        this.messages.push(content);
    }

    addUserMessage(content: string | (string | null | undefined)[]): void {
        this.addMessage(content, "user");
    }
    addAssistantMessage(content: string | (string | null | undefined)[]): void {
        this.addMessage(content, "assistant");
    }
    addSystemMessage(content: string | (string | null | undefined)[]): void {
        this.addMessage(content, "system");
    }

    async getResponse(params: RequestParams): Promise<SuccessResponse | ErrorResponse> {
        const result = await this.client.complete(this.messages, params);
        if (result.success) {
            this.messages.push({
                role:    "assistant",
                content: result.text,
                ...(result.tool_calls ? { tool_calls: result.tool_calls } : {}),
            });
        }
        return result;
    }

    clone(): OpenRouterConversation {
        const copy = new OpenRouterConversation(this.client);
        copy.messages = JSON.parse(JSON.stringify(this.messages));
        return copy;
    }
}

// ─────────────────────────────────────────────
// Request body builder
// ─────────────────────────────────────────────

function buildRequestBody(
    messages: Message[],
    dedupedModels: string[],
    params: APIParams,
    extraModelsRequiringReasoning: string[]
): string {
    return JSON.stringify(
        removeUndefined({
            ...(dedupedModels.length > 1
                ? { models: dedupedModels }
                : { model: dedupedModels[0] }),
            messages,
            provider:           params.provider,
            response_format:    params.format ? makeResponseFormat(params.format) : undefined,
            // Forwarded as-is; undefined is omitted by removeUndefined, so the
            // provider uses its own default. Pass 0 explicitly for greedy output.
            temperature:        params.temperature,
            max_tokens:         params.max_tokens,
            stop:               params.stop,
            top_p:              params.top_p,
            presence_penalty:   params.presence_penalty,
            frequency_penalty:  params.frequency_penalty,
            seed:               params.seed,
            logprobs:           params.logprobs,
            top_logprobs:       params.top_logprobs,
            logit_bias:         params.logit_bias,
            tools:              params.tools,
            tool_choice:        params.tool_choice,
            modalities:         params.modalities,
            reasoning:          adjustReasoningParam(params.reasoning, dedupedModels[0], extraModelsRequiringReasoning),
            plugins:            params.plugins,
            web_search_options: params.web_search_options,
            route:              params.route,
            session_id:         params.session_id,
            user:               params.user,
            metadata:           params.metadata,
        })
    );
}

// ─────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────

function makeResponseFormat(zodSchema: z.ZodObject<any>) {
    return {
        type: "json_schema",
        json_schema: {
            name: "structured_response",
            strict: true,
            schema: z.toJSONSchema(zodSchema),
        },
    };
}

/**
 * Returns true if the given model requires the reasoning parameter to be
 * explicitly force-enabled. Models in this set do not infer reasoning from
 * other fields and will not use it unless `enabled: true` is sent explicitly.
 */
function isReasoningRequired(model: string, extraModels: string[]): boolean {
    const modelName = model.split(":")[0]; // strip variant suffix e.g. ":nitro"
    return (
        BUILTIN_MODELS_REQUIRING_REASONING.has(modelName) ||
        extraModels.includes(modelName)
    );
}

function adjustReasoningParam(
    reasoning: Reasoning | undefined,
    model: string,
    extraModels: string[]
): Reasoning | undefined {
    if (reasoning === undefined) return undefined;

    if (isReasoningRequired(model, extraModels)) {
        // Always send `enabled: true` for models that require an explicit payload.
        // Sending a redundant `{ enabled: true }` is harmless; omitting it would
        // defeat the purpose of this list entirely.
        return { ...reasoning, enabled: true };
    }

    if (reasoning.enabled === false) return { enabled: false };
    return reasoning;
}

function rotateLeft<T>(arr: T[], steps: number): T[] {
    if (arr.length === 0) return arr;
    const n = steps % arr.length;
    return [...arr.slice(n), ...arr.slice(0, n)];
}

function unique<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}

function removeUndefined(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function extractErrorMessage(e: unknown): string {
    if (e instanceof AggregateError) return e.errors.map(extractErrorMessage).join(" | ");
    if (e instanceof Error)          return e.message;
    if (typeof e === "string")       return e;
    try { return JSON.stringify(e); } catch { return "Unknown error"; }
}

function defaultRepairJSON(text: string): string {
    return text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
}

// ─────────────────────────────────────────────
// Token counting
// ─────────────────────────────────────────────

/**
 * Override `getEncoder` to swap in a WASM-based tiktoken or a mock in tests.
 * @example
 * import * as tiktoken from '@dqbd/tiktoken';
 * tokenCounterTools.getEncoder = (model) => tiktoken.encoding_for_model(model);
 */
export const tokenCounterTools = {
    getEncoder: (model: TiktokenModel) => encodingForModel(model),
};

const MAX_ENCODER_CACHE_SIZE = 20;
const encoderCache = new Map<TiktokenModel, ReturnType<typeof encodingForModel>>();

function getEncoder(model: TiktokenModel): ReturnType<typeof encodingForModel> {
    if (!encoderCache.has(model)) {
        if (encoderCache.size >= MAX_ENCODER_CACHE_SIZE) {
            const oldestKey = encoderCache.keys().next().value!;
            // No .free() needed — js-tiktoken is pure JS, not WASM.
            // If you swap to @dqbd/tiktoken, add oldestEncoder.free() here.
            encoderCache.delete(oldestKey);
        }
        encoderCache.set(model, tokenCounterTools.getEncoder(model));
    }
    return encoderCache.get(model)!;
}

export function countTokens(text: string, model: TiktokenModel): number {
    return getEncoder(model).encode(text).length;
}

/**
 * Releases all cached encoders and frees their WASM allocations.
 * Call this on worker shutdown or when you know token counting is no longer needed,
 * particularly in long-running processes or environments with reused workers.
 */
export function clearEncoderCache(): void {
    // No .free() needed for js-tiktoken (pure JS, not WASM).
    // If you swap to @dqbd/tiktoken, call encoder.free() for each entry here.
    encoderCache.clear();
}

/**
 * Estimates token count by sampling random chunks of the text and extrapolating.
 *
 * Sampling strategy: divide the text into `numSamples` equal-sized blocks, draw
 * one random sample from each block, count tokens in those samples, compute the
 * average chars-per-token ratio, and scale up to the full text length.
 *
 * `numSamples` is derived from `Math.log10(text.length) - 1`, giving roughly:
 *   1 sample  for ~1 KB  (length ≈ 1 000)
 *   3 samples for ~100 KB
 *   5 samples for ~10 MB
 * Clamped to [1, 10] so short and very-long inputs produce sensible values.
 *
 * @param random - Random number source in [0, 1). Defaults to Math.random.
 *                 Inject a deterministic function for reproducible tests.
 */
export function estimateTokens(
    text: string,
    model: TiktokenModel,
    sampleLength = 100,
    random: () => number = Math.random
): number {
    if (text.length < 1000) return countTokens(text, model);

    const numSamples   = Math.min(Math.max(1, Math.round(Math.log10(text.length) - 1)), 10);
    const avgBlockSize = text.length / numSamples;

    let totalChars  = 0;
    let totalTokens = 0;

    for (let i = 0; i < numSamples; i++) {
        const blockStart     = Math.floor(i * avgBlockSize);
        const blockEnd       = Math.ceil((i + 1) * avgBlockSize);
        const maxSampleStart = Math.max(blockStart, blockEnd - sampleLength);
        const sampleStart    = Math.floor(random() * (maxSampleStart - blockStart + 1) + blockStart);
        const sample         = text.substring(sampleStart, sampleStart + sampleLength);
        if (sample.length === 0) continue;
        totalChars  += sample.length;
        totalTokens += countTokens(sample, model);
    }

    if (totalTokens === 0) return countTokens(text, model);
    return Math.round(text.length / (totalChars / totalTokens));
}

export type { TiktokenModel };
