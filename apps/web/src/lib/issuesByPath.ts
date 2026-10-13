import type { ApiIssue } from '../api/ApiError';

/** API issues by JSON pointer, messages joined; issues without a pointer go under "". */
export function issuesByPath(issues: readonly ApiIssue[]): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const issue of issues) {
    const path = typeof issue.path === 'string' ? issue.path : '';
    const before = byPath.get(path);
    byPath.set(path, before ? `${before}. ${issue.message}` : issue.message);
  }
  return byPath;
}
