/** One problem the API found in a request; `path` is a JSON pointer for corrections. */
export interface ApiIssue {
  path?: unknown;
  message: string;
}

/** An API response that was not 2xx, with the server's message and, for invalid input, its issues. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
