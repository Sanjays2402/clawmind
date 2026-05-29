export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}

export interface LLMProvider {
  id: string;
  chat(req: ChatRequest): Promise<string>;
  stream(req: ChatRequest): AsyncIterable<ChatChunk>;
  health(): Promise<boolean>;
}

export interface EmbedRequest {
  texts: string[];
  model?: string;
}

export interface EmbedResponse {
  vectors: number[][];
  model: string;
  dim: number;
}

export interface EmbedProvider {
  id: string;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
  health(): Promise<boolean>;
  dim(): number;
}
