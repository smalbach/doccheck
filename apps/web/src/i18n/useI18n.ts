import { useContext } from 'react';
import { I18nContext, type I18nState } from './I18nContext';

export function useI18n(): I18nState {
  const state = useContext(I18nContext);
  if (!state) throw new Error('useI18n must be used inside I18nProvider');
  return state;
}
