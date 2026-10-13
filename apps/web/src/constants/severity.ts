import type { Finding } from '../api/types';

export type Severity = Finding['severity'];

/** Most severe first. */
export const SEVERITY_ORDER: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
