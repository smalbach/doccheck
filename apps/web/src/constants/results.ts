/** Labels of the evaluation sets in eval/reports (extraction-<model>[-<set>].json). */
export const EVALUATION_SET_LABEL: Record<string, string> = {
  v1: 'PDFs with a text layer',
  'v1-scans': 'Scanned PDFs (OCR)',
  'v1-isf': 'ISF filings',
  v2: 'Unseen layouts and formats (v2)',
};

export const AGENT_DECISION_LABEL: Record<string, string> = {
  party: 'same consignee?',
  description: 'BL description vs goods?',
};
