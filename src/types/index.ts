export interface Document {
  rowNumber: string;
  expediente: string;
  administrado: string;
  unidadFiscalizable: string;
  sector: string;
  nroResolucion: string;
  pdfUrl: string | null;
}

export interface ScraperConfig {
  baseUrl: string;
  outputDir: string;
  pdfsDir: string;
  delayBetweenRequests: number;
  maxRetries: number;
  initialBackoff: number;
}

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
}

export interface ScrapeResult {
  documents: Document[];
  failedDownloads: FailedDownload[];
  totalScraped: number;
  totalDownloaded: number;
}

export interface FailedDownload {
  document: Document;
  reason: string;
  attempts: number;
}

export interface ViewState {
  value: string;
  sessionId?: string;
}
