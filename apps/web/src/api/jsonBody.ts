/** Request options for a JSON body. */
export function jsonBody(body: unknown, method: 'POST' | 'PUT' = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
