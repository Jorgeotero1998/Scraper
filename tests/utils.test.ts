import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import {
  buildSafeFilename,
  csvEscape,
  documentsToCSV,
  getBackoffMs,
  parsePagination,
  sleep,
} from "../src/utils";
import type { Document } from "../src/types";

const makeDoc = (overrides: Partial<Document> = {}): Document => ({
  rowNumber: "1",
  expediente: "EXP-001",
  administrado: "Empresa SA",
  unidadFiscalizable: "Planta Norte",
  sector: "MINERÍA",
  nroResolucion: "RES-2024-001",
  pdfUrl: null,
  ...overrides,
});

// ─── sleep ───────────────────────────────────────────────────────────────────
describe("sleep", () => {
  it("resolves after approximately the requested delay", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

// ─── getBackoffMs ─────────────────────────────────────────────────────────────
describe("getBackoffMs", () => {
  it("doubles on each attempt (ignoring jitter)", () => {
    const base = 1000;
    // backoff = base * 2^attempt + jitter; jitter ∈ [0, 500)
    const b0 = getBackoffMs(base, 0);
    const b1 = getBackoffMs(base, 1);
    const b2 = getBackoffMs(base, 2);
    // Deterministic lower bounds
    expect(b0).toBeGreaterThanOrEqual(base * 1); // 2^0 = 1
    expect(b1).toBeGreaterThanOrEqual(base * 2); // 2^1 = 2
    expect(b2).toBeGreaterThanOrEqual(base * 4); // 2^2 = 4
    // Upper bounds (jitter < 500)
    expect(b0).toBeLessThan(base * 1 + 500);
    expect(b1).toBeLessThan(base * 2 + 500);
    expect(b2).toBeLessThan(base * 4 + 500);
  });
});

// ─── buildSafeFilename ────────────────────────────────────────────────────────
describe("buildSafeFilename", () => {
  it("uses nroResolucion as the filename stem", () => {
    const doc = makeDoc({ nroResolucion: "RES-2024/001" });
    expect(buildSafeFilename(doc)).toBe("RES-2024_001.pdf");
  });

  it("falls back to expediente when nroResolucion is empty", () => {
    const doc = makeDoc({ nroResolucion: "", expediente: "EXP/2024-5" });
    expect(buildSafeFilename(doc)).toBe("EXP_2024-5.pdf");
  });

  it("falls back to rowNumber when both are empty", () => {
    const doc = makeDoc({ nroResolucion: "", expediente: "" });
    expect(buildSafeFilename(doc)).toBe("1.pdf");
  });

  it("strips characters unsafe for the filesystem", () => {
    const doc = makeDoc({ nroResolucion: "RES 2024 : 001 <test>" });
    const filename = buildSafeFilename(doc);
    expect(filename).not.toMatch(/[ :<>]/);
    expect(filename.endsWith(".pdf")).toBe(true);
  });

  it("caps the stem at 100 characters", () => {
    const doc = makeDoc({ nroResolucion: "A".repeat(200) });
    const stem = buildSafeFilename(doc).replace(".pdf", "");
    expect(stem.length).toBeLessThanOrEqual(100);
  });
});

// ─── parsePagination ──────────────────────────────────────────────────────────
describe("parsePagination", () => {
  it("parses a typical paginator string", () => {
    const html = `<span class="ui-paginator-current">Página 2 de 10 (95 registros)</span>`;
    const $ = cheerio.load(html);
    const result = parsePagination($);
    expect(result).toEqual({ currentPage: 2, totalPages: 10, totalRecords: 95 });
  });

  it("handles singular 'registro'", () => {
    const html = `<span class="ui-paginator-current">Página 1 de 1 (1 registro)</span>`;
    const $ = cheerio.load(html);
    const result = parsePagination($);
    expect(result).toEqual({ currentPage: 1, totalPages: 1, totalRecords: 1 });
  });

  it("returns safe defaults when the element is absent", () => {
    const $ = cheerio.load("<html><body></body></html>");
    expect(parsePagination($)).toEqual({ currentPage: 1, totalPages: 1, totalRecords: 0 });
  });

  it("handles accented 'Página'", () => {
    const html = `<span class="ui-paginator-current">Página 3 de 5 (42 registros)</span>`;
    const $ = cheerio.load(html);
    expect(parsePagination($).currentPage).toBe(3);
  });
});

// ─── csvEscape ────────────────────────────────────────────────────────────────
describe("csvEscape", () => {
  it("wraps value in double quotes", () => {
    expect(csvEscape("hello")).toBe('"hello"');
  });

  it("doubles internal double quotes per RFC 4180", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("preserves commas inside the quoted field", () => {
    expect(csvEscape("foo,bar")).toBe('"foo,bar"');
  });
});

// ─── documentsToCSV ───────────────────────────────────────────────────────────
describe("documentsToCSV", () => {
  it("produces a header row and one data row per document", () => {
    const docs = [makeDoc({ pdfUrl: "form:dt:0:link" })];
    const csv = documentsToCSV(docs);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Expediente");
    expect(lines).toHaveLength(2);
  });

  it("uses empty string for missing pdfUrl", () => {
    const docs = [makeDoc({ pdfUrl: null })];
    const csv = documentsToCSV(docs);
    expect(csv.split("\n")[1]).toMatch(/""$/);
  });
});
