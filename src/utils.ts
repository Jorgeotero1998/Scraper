import * as cheerio from "cheerio";
import type { Document, PaginationInfo } from "./types";

/** Pause execution for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute exponential backoff duration with jitter.
 * Formula: base * 2^attempt + rand(0, 500ms)
 */
export function getBackoffMs(baseMs: number, attempt: number): number {
  return baseMs * Math.pow(2, attempt) + Math.random() * 500;
}

/**
 * Build a safe filesystem filename from a `Document`.
 * Strips characters not safe on Windows/Linux, collapses underscores, caps length.
 */
export function buildSafeFilename(doc: Document): string {
  const stem = (doc.nroResolucion || doc.expediente || doc.rowNumber)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 100);
  return `${stem}.pdf`;
}

/**
 * Parse PrimeFaces paginator text of the form
 * "Página N de T (R registro(s))".
 * Returns safe defaults when the element is absent.
 */
export function parsePagination($: cheerio.CheerioAPI): PaginationInfo {
  const text = $(".ui-paginator-current").text().trim();
  const match = text.match(/P[aá]gina\s+(\d+)\s+de\s+(\d+)\s*\((\d+)\s+registros?\)/i);
  if (match) {
    return {
      currentPage: parseInt(match[1], 10),
      totalPages: parseInt(match[2], 10),
      totalRecords: parseInt(match[3], 10),
    };
  }
  return { currentPage: 1, totalPages: 1, totalRecords: 0 };
}

/**
 * Escape a value for RFC-4180 CSV (wrap in quotes, double internal quotes).
 */
export function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Serialize an array of `Document` records to RFC-4180 CSV text.
 */
export function documentsToCSV(documents: Document[]): string {
  const header = "Nro,Expediente,Administrado,Unidad Fiscalizable,Sector,Nro Resolucion,PDF URL";
  const rows = documents.map((doc) =>
    [
      doc.rowNumber,
      doc.expediente,
      doc.administrado,
      doc.unidadFiscalizable,
      doc.sector,
      doc.nroResolucion,
      doc.pdfUrl ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );
  return [header, ...rows].join("\n");
}
