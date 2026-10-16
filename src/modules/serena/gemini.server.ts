// Google Gemini over its REST API (fetch only, so it runs in the edge/worker runtime without extra packages).
// Docs: https://ai.google.dev/api/generate-content and https://ai.google.dev/api/models

const base = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call(path: string, apiKey: string, init: RequestInit = {}) {
  const response = await fetch(`${base}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new GeminiError(data?.error?.message ?? `Gemini ${response.status}`, response.status);
  return data;
}

export async function listGeminiModels(apiKey: string) {
  const models: any[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const data = await call(
      `models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      apiKey,
    );
    models.push(...(data.models ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return models as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
}

export type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: unknown;
  thought?: boolean;
  thoughtSignature?: string;
};
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type GeminiTool = { name: string; description: string; parameters: Record<string, unknown> };

/**
 * One answer with tool use: Gemini may ask for data (function calls), we run the tools and send the results
 * back, until it answers in text. The model's parts are sent back unchanged (they carry thought signatures).
 */
export async function runGemini(options: {
  apiKey: string;
  model: string;
  system: string;
  contents: GeminiContent[];
  tools: GeminiTool[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxSteps?: number;
}) {
  const contents = [...options.contents];
  const used: string[] = [];
  for (let step = 0; step < (options.maxSteps ?? 8); step++) {
    const data = await call(
      `models/${encodeURIComponent(options.model)}:generateContent`,
      options.apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: options.system }] },
          contents,
          tools: [{ functionDeclarations: options.tools }],
          generationConfig: { maxOutputTokens: 8192 },
        }),
      },
    );
    const candidate = data.candidates?.[0];
    const parts: GeminiPart[] = candidate?.content?.parts ?? [];
    if (!candidate || data.promptFeedback?.blockReason || candidate.finishReason === "SAFETY") {
      return { text: "", blocked: true, used };
    }
    const calls = parts.filter((part) => part.functionCall);
    if (!calls.length) {
      const text = parts
        .filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join("")
        .trim();
      return { text, blocked: false, used, truncated: candidate.finishReason === "MAX_TOKENS" };
    }
    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const part of calls) {
      const { name, args = {} } = part.functionCall!;
      used.push(name);
      let result: unknown;
      try {
        result = await options.runTool(name, args);
      } catch (error) {
        result = { error: error instanceof Error ? error.message : "tool_failed" };
      }
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { text: "", blocked: false, used, tooManySteps: true };
}
