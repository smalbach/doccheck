import { describe, expect, it } from 'vitest';
import { assertAiAllowed, isLocalUrl, localOnly } from './ai-policy';

describe('AI policy', () => {
  it('is local only unless AI_LOCAL_ONLY=false', () => {
    expect(localOnly({})).toBe(true);
    expect(localOnly({ AI_LOCAL_ONLY: 'true' })).toBe(true);
    expect(localOnly({ AI_LOCAL_ONLY: 'false' })).toBe(false);
  });

  it('tells local and private addresses from outside ones', () => {
    for (const url of ['http://localhost:11434', 'http://127.0.0.1:8000/v1', 'http://10.0.0.5', 'http://172.20.1.1', 'http://192.168.1.20:1234', 'http://[::1]:8080', 'http://ollama:11434', 'http://gpu.local', 'http://vllm.internal/v1']) {
      expect(isLocalUrl(url), url).toBe(true);
    }
    for (const url of ['https://api.openai.com/v1', 'https://api.anthropic.com', 'http://172.32.0.1', 'http://8.8.8.8', 'https://x.openai.azure.com', 'not a url']) {
      expect(isLocalUrl(url), url).toBe(false);
    }
  });

  it('refuses outside services while local only', () => {
    expect(() => assertAiAllowed('OpenAI', 'https://api.openai.com/v1', {})).toThrow(/local only/);
    expect(() => assertAiAllowed('vLLM', 'http://localhost:8000', {})).not.toThrow();
    expect(() => assertAiAllowed('OpenAI', 'https://api.openai.com/v1', { AI_LOCAL_ONLY: 'false' })).not.toThrow();
  });
});
