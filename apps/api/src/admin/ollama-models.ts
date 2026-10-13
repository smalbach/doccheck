export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  /** Embedding models (BERT family, or the one set in EMBED_MODEL) cannot read documents. */
  embedding: boolean;
}

const EMBEDDING_FAMILIES = /bert/i;

/** Models installed in Ollama (GET /api/tags), or null when it does not answer in time. */
export async function listOllamaModels(baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'): Promise<OllamaModel[] | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name: string; size: number; digest: string; modified_at: string; details?: { families?: string[] | null } }[] };
    const embedModel = (process.env.EMBED_MODEL || 'bge-m3').replace(/:latest$/, '');
    return (body.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest.slice(0, 12),
      modifiedAt: m.modified_at,
      embedding: m.name.replace(/:latest$/, '') === embedModel || (m.details?.families ?? []).some((f) => EMBEDDING_FAMILIES.test(f)),
    }));
  } catch {
    return null;
  }
}
