/** Local preparation only. None of these states are an operational approval. */
export const MANUAL_DOCUMENT_VERSION = 'local-review-1';
export const MANUAL_DOCUMENT_LIMITS = Object.freeze({
  fileBytes: 4 * 1024 * 1024,
  sessionBytes: 16 * 1024 * 1024,
  files: 5,
  pages: 40,
  rows: 2_000,
  columns: 100,
  cells: 40_000,
  textCharacters: 400_000,
  archiveEntries: 500,
  expandedBytes: 16 * 1024 * 1024,
  compressionRatio: 100,
  parseTimeoutMs: 25_000,
});

export type DocumentFormat = 'pdf' | 'xlsx' | 'csv' | 'tsv';
export type DocumentScope = { userId: string; departmentId: string | null };
export type DocumentEvidence = {
  id: string;
  text: string;
  origin?: 'extracted' | 'manual-transcription';
  page?: number;
  x?: number;
  y?: number;
  sheet?: string;
  cell?: string;
  row?: number;
  column?: number;
  warning?: string;
};
export type DocumentExtraction = {
  evidence: DocumentEvidence[];
  warnings: string[];
  pageCount: number | null;
  sheets: string[];
};
export type ReviewClaim = {
  id: string;
  evidenceId: string;
  label: string;
  kind: 'text' | 'money' | 'date';
  value: string;
  currency: '' | 'CLP' | 'USD' | 'EUR';
  numberFormat: '' | 'es-CL' | 'en-US';
  dateFormat: '' | 'yyyy-mm-dd' | 'dd/mm/yyyy';
  correctionReason: string;
  interpretation: string;
};
export type LocalReviewDecision = 'DRAFT' | 'PROPOSE_APPROVAL' | 'PROPOSE_RETURN';
export type LocalReviewRevision = {
  revision: number;
  at: string;
  actor: { id: string; name: string };
  decision: LocalReviewDecision;
  claims: ReviewClaim[];
  note: string;
  originalCompared: boolean;
  unresolvedQuestions: string;
};
export type ManualDocumentDraft = DocumentExtraction & {
  key: string;
  sha256: string;
  name: string;
  size: number;
  format: DocumentFormat;
  parserVersion: string;
  scope: DocumentScope;
  history: LocalReviewRevision[];
};

/** Fail closed until storage/AI capacity and a shared review contract are verified.
 * Not an env toggle: introducing a provider call needs a separate reviewed change.
 */
export const MANUAL_DOCUMENT_CAPABILITIES = Object.freeze({
  remoteOriginalStorage: false,
  sharedReviewPersistence: false,
  frontiTextInference: false,
  scannedDocumentVision: false,
});
