export const DEFAULTS = {
  chunk: {
    targetTokens: 320,
    overlapTokens: 48,
    minChunkChars: 80,
    maxChunkChars: 4000,
  },
  retrieval: {
    bm25K: 40,
    denseK: 40,
    finalK: 8,
    mmrLambda: 0.5,
    hybridAlpha: 0.5,
  },
  prompt: {
    systemPath: 'system.md',
    maxContextChars: 16000,
  },
} as const;
