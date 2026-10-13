import { Popover } from 'radix-ui';
import { useRef, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { splitActivity } from '../../lib/activity';
import { ActivityPanel } from './ActivityPanel';
import { useActivity } from './ActivityContext';

export interface ActivityIndicatorProps {
  /** Where the panel opens: next to the sidebar, or below the mobile top bar. */
  side?: 'right' | 'bottom';
}

/**
 * "2 running" in the app shell while anything of the user's is extracting or validating (hidden when
 * idle). It opens the activity panel: what runs now across their shipments, and what just finished.
 */
export function ActivityIndicator({ side = 'right' }: ActivityIndicatorProps) {
  const { t } = useI18n();
  const { state } = useActivity();
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const count = splitActivity(state).running.length;
  // Stays while the panel is open, so the last run finishing does not close it under the user.
  if (count === 0 && !open) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="activity-badge">
        {count > 0 && <span className="activity-pulse" aria-hidden />}
        <span aria-hidden>{t('activity.badge', { count })}</span>
        <span className="visually-hidden">{t('activity.badgeLabel', { count })}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="activity-popover"
          side={side}
          align={side === 'right' ? 'start' : 'end'}
          sideOffset={8}
          collisionPadding={12}
          aria-label={t('activity.title')}
          ref={content}
          tabIndex={-1}
          // Focus the panel itself, not its first Cancel button: Tab then walks through the links and buttons.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            content.current?.focus();
          }}
        >
          <ActivityPanel onNavigate={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
