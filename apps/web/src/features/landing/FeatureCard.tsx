import type { ComponentType } from 'react';

export interface FeatureCardProps {
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  title: string;
  text: string;
}

export function FeatureCard({ icon: Icon, title, text }: FeatureCardProps) {
  return (
    <div className="feature-card">
      <span className="feature-icon">
        <Icon aria-hidden />
      </span>
      <h3>{title}</h3>
      <p className="muted">{text}</p>
    </div>
  );
}
