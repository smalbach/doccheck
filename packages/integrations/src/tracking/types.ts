/** A container milestone, the same whichever provider reported it. */
export type ContainerEventType = 'GATE_IN' | 'LOADED' | 'DEPARTED' | 'TRANSSHIPPED' | 'ARRIVED' | 'DISCHARGED' | 'GATE_OUT' | 'EMPTY_RETURN' | 'OTHER';

export interface ContainerEvent {
  containerNumber: string;
  type: ContainerEventType;
  /** ISO 8601 as the provider gives it, local time with its offset when known. */
  at: string;
  /** Actual (true) or estimated/planned (false). Checks use actual events only. */
  actual: boolean;
  location?: { name?: string; unLocode?: string };
  vessel?: string;
  voyage?: string;
  /** The provider's own event code, for display. */
  code?: string;
}

export interface TrackingQuery {
  containerNumber: string;
  blNumber?: string;
  scac?: string;
}

/** Fetches a container's events from a tracking provider. */
export interface TrackingProvider {
  readonly id: TrackingProviderId;
  events(query: TrackingQuery): Promise<ContainerEvent[]>;
}

export type TrackingProviderId = 'mock' | 'project44' | 'vizion' | 'terminal49';
export const TRACKING_PROVIDERS: readonly TrackingProviderId[] = ['mock', 'project44', 'vizion', 'terminal49'];
