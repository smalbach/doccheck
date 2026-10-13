import { ChatBubbleIcon, CheckCircledIcon, FileTextIcon, GlobeIcon, LockClosedIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import type { ComponentType } from 'react';

type Icon = ComponentType<{ 'aria-hidden'?: boolean }>;

export const LANDING_STEPS: { title: string; text: string }[] = [
  { title: 'Upload the PDFs', text: 'Commercial invoice, packing list and bill of lading, plus the ISF for US ocean freight. Scans work too.' },
  { title: 'DocCheck reads them', text: 'A local model copies what is printed; plain code turns it into dates, decimals, kilograms and country codes.' },
  { title: 'Fix before filing', text: 'Every inconsistency comes with the line of the PDF it was found on and the regulation that requires it.' },
];

export const LANDING_FEATURES: { icon: Icon; title: string; text: string }[] = [
  { icon: CheckCircledIcon, title: 'Cross-document checks', text: 'Package counts, weights, quantities per SKU, invoice arithmetic, currencies, dates and container check digits.' },
  { icon: GlobeIcon, title: 'CBSA and CBP profiles', text: 'The invoice fields Canada (CI1) and the US (19 CFR 141.86) require, and the ISF 10+2 against the invoice.' },
  { icon: FileTextIcon, title: 'Evidence on the page', text: 'Each finding opens the PDF at the cited line, highlighted, so a reviewer can confirm it in seconds.' },
  { icon: MagnifyingGlassIcon, title: 'Regulation citations', text: 'Passages from CBSA memoranda and 19 CFR found by search, never written by the model.' },
  { icon: ChatBubbleIcon, title: 'An agent for grey areas', text: 'The model only decides narrow questions, like whether two names are the same company, and explains why.' },
  { icon: LockClosedIcon, title: 'Private by design', text: 'Models run on this server. Documents never leave it, and each account sees only its own shipments.' },
];

export const LANDING_CHECKS: string[] = [
  'Package count across invoice, packing list and BL',
  'Gross weight between packing list and BL',
  'Quantity × unit price and invoice totals',
  'One currency on the whole invoice',
  'Invoice quantities against the packing list, per SKU',
  'ISO 6346 container check digits',
  'Invoice date against the shipped-on-board date',
  'Terms of sale against freight terms',
  'ISF seller, buyer, origin and HTS against the invoice',
  'CBSA CI1 and 19 CFR 141.86 required invoice fields',
];
