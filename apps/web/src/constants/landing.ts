import { ChatBubbleIcon, CheckCircledIcon, FileTextIcon, GlobeIcon, LockClosedIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import type { ComponentType } from 'react';

type Icon = ComponentType<{ 'aria-hidden'?: boolean }>;

/** Keys under landing.steps, landing.features and landing.checks, in display order. */
export const LANDING_STEPS = ['upload', 'read', 'fix'] as const;

export const LANDING_FEATURES: readonly { id: 'cross' | 'profiles' | 'evidence' | 'citations' | 'agent' | 'privacy'; icon: Icon }[] = [
  { id: 'cross', icon: CheckCircledIcon },
  { id: 'profiles', icon: GlobeIcon },
  { id: 'evidence', icon: FileTextIcon },
  { id: 'citations', icon: MagnifyingGlassIcon },
  { id: 'agent', icon: ChatBubbleIcon },
  { id: 'privacy', icon: LockClosedIcon },
];

export const LANDING_CHECKS = ['packages', 'weight', 'arithmetic', 'currency', 'quantities', 'containers', 'dates', 'terms', 'isf', 'required'] as const;
