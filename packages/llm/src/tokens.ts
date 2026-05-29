// A small, fast approximation. Real tokenizers are nice but adding tiktoken to
// every package is heavy. The error bar here is well within retrieval budgets.
export function approxTokenCount(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  return Math.ceil(Math.max(words * 1.3, chars / 4));
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (approxTokenCount(text) <= maxTokens) return text;
  const ratio = (maxTokens * 4) / text.length;
  return text.slice(0, Math.max(1, Math.floor(text.length * ratio)));
}
