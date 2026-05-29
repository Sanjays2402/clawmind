import type { LLMProvider } from '@clawmind/types';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { FallbackLLMProvider } from './fallback.js';

export interface RouterEnv {
  CLAWMIND_LLM_PRIMARY_URL: string;
  CLAWMIND_LLM_PRIMARY_MODEL: string;
  CLAWMIND_LLM_FALLBACK_URL: string;
  CLAWMIND_LLM_FALLBACK_MODEL: string;
}

export function buildDefaultLLM(env: RouterEnv): LLMProvider {
  const primary = new OpenAICompatibleProvider({
    id: 'hermes-agent',
    baseUrl: env.CLAWMIND_LLM_PRIMARY_URL,
    defaultModel: env.CLAWMIND_LLM_PRIMARY_MODEL,
  });
  const fallback = new OpenAICompatibleProvider({
    id: 'copilot-proxy',
    baseUrl: env.CLAWMIND_LLM_FALLBACK_URL,
    defaultModel: env.CLAWMIND_LLM_FALLBACK_MODEL,
  });
  return new FallbackLLMProvider([primary, fallback]);
}
