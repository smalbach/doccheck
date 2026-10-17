/**
 * Where model calls may go. DocCheck reads documents with local models by default; an admin can
 * allow outside AI services (OpenAI, Anthropic, Gemini, Google Vision, Textract, Azure) by turning
 * "local only" off. AI_LOCAL_ONLY=false is that switch for the API and the command-line tools.
 */
export const localOnly = (env: NodeJS.ProcessEnv = process.env): boolean => env.AI_LOCAL_ONLY !== 'false';

/**
 * A URL on this machine or the private network (loopback, RFC 1918, link-local, *.local, a bare
 * host name): a self-hosted server such as vLLM, LM Studio or Ollama on another box.
 */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
  // A single-label name (a container or a host on the LAN: "ollama", "vllm").
  if (/^[a-z0-9-]+$/.test(host)) return true;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export class ExternalAiBlockedError extends Error {
  constructor(what: string) {
    super(`${what} is an outside AI service and "local only" is on (AI_LOCAL_ONLY); an admin can allow outside services in the settings`);
  }
}

/** Throws when `url` is outside and local-only is on. */
export function assertAiAllowed(what: string, url: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  if (localOnly(env) && !(url && isLocalUrl(url))) throw new ExternalAiBlockedError(what);
}
