import { loadEnv, lancedbDir, bm25Dir, manifestPath, expand } from '@clawmind/config';
import { LanceStore, BM25Index, IngestManifest } from '@clawmind/store';
import { MlxEmbedClient, OpenAIEmbedClient, FallbackEmbedProvider } from '@clawmind/embed';
import { buildDefaultLLM } from '@clawmind/llm';

export async function buildRuntime() {
  const env = loadEnv();
  const lance = new LanceStore({ dir: lancedbDir(env), dim: env.CLAWMIND_EMBED_DIM });
  await lance.init();
  await lance.ensureTable();
  const bm25File = `${bm25Dir(env)}/bm25.json`;
  const bm25 = await BM25Index.load(bm25File);
  const manifest = new IngestManifest(manifestPath(env));
  await manifest.load();
  const mlx = new MlxEmbedClient({
    baseUrl: env.CLAWMIND_EMBED_URL, model: env.CLAWMIND_EMBED_MODEL, dim: env.CLAWMIND_EMBED_DIM,
  });
  const openai = new OpenAIEmbedClient({
    baseUrl: env.CLAWMIND_LLM_FALLBACK_URL, model: 'text-embedding-3-small', dim: env.CLAWMIND_EMBED_DIM,
  });
  const embed = new FallbackEmbedProvider([mlx, openai]);
  const llm = buildDefaultLLM(env);
  return {
    env, lance, bm25, bm25File, manifest, embed, llm,
    workspace: expand(env.CLAWMIND_WORKSPACE),
  };
}
