import { en, type Messages } from './messages/en';
import type { Locale } from './locales';

const loaded = new Map<Locale, Promise<Messages>>([['en', Promise.resolve(en)]]);

/**
 * The dictionary of a language. English is in the main bundle; Spanish and French are separate
 * chunks fetched the first time they are needed, so English visitors do not download them.
 */
export function loadMessages(locale: Locale): Promise<Messages> {
  let messages = loaded.get(locale);
  if (!messages) {
    messages = (locale === 'es' ? import('./messages/es').then((m) => m.es) : import('./messages/fr').then((m) => m.fr)).catch((err: unknown) => {
      loaded.delete(locale);
      throw err;
    });
    loaded.set(locale, messages);
  }
  return messages;
}
