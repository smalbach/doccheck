/**
 * Express "trust proxy" from TRUST_PROXY. Express reads a string as a list of addresses, so "1"
 * (one proxy hop, e.g. Fly.io's or Render's edge), "true" and "false" are turned into the number
 * or boolean they mean; anything else ("loopback", "uniquelocal", an IP or subnet list) is passed
 * through. Unset or empty: "loopback" (a proxy on this machine, such as ngrok or Caddy).
 */
export function trustProxySetting(value = process.env.TRUST_PROXY): string | number | boolean {
  const v = value?.trim();
  if (!v) return 'loopback';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
