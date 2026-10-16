import { usageApi } from '../api/usage';
import { useQuery } from './useQuery';

/** This month's usage of the signed-in account (reloaded when `key` changes). */
export function useUsage(key = '') {
  return useQuery(`usage:${key}`, usageApi.usage);
}
