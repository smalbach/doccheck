import type { ReactNode } from 'react';

export interface StatCardProps {
  value: string;
  label: ReactNode;
  detail: ReactNode;
}

export function StatCard({ value, label, detail }: StatCardProps) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      <span className="muted small">{detail}</span>
    </div>
  );
}
