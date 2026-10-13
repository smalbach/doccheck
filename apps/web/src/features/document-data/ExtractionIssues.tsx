export function ExtractionIssues({ issues }: { issues: readonly string[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues" lang="en">
      {issues.map((issue, i) => (
        <li key={i}>{issue}</li>
      ))}
    </ul>
  );
}
