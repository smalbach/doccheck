import type { TransportMode } from '../api/types';
import type { MessageKey } from '../i18n/keys';

export const TRANSPORT_MODES: readonly TransportMode[] = ['SEA', 'AIR', 'ROAD'];

export const TRANSPORT_MODE_KEY: Record<TransportMode, MessageKey> = { SEA: 'transportModes.SEA', AIR: 'transportModes.AIR', ROAD: 'transportModes.ROAD' };
