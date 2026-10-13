import type { en } from './messages/en';

type Plural = { readonly one: string; readonly other: string };

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every translatable key, e.g. "shipment.findings.summary". A typo is a type error. */
export type MessageKey = Paths<typeof en>;

export type MessageVars = Record<string, string | number>;
