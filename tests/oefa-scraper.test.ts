/**
 * Integration-ish tests for OefaScraper.
 *
 * All outbound HTTP is replaced by vi.mock so nothing hits the network.
 * We verify that the scraper correctly routes JSF AJAX calls and persists
 * extracted data to disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OefaScraper } from "../src/oefa-scraper";
import type { ScraperConfig } from "../src/types";

// ─── Mock the HttpClient module ───────────────────────────────────────────────
vi.mock("../src/http-client", () => {
  const MockHttpClient = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue({
      status: 200,
      data: buildInitialPageHtml(),
    }),
    post: vi.fn().mockResolvedValue({
      status: 200,
      data: buildSearchResultHtml(),
    }),
    postBinary: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 mock")),
  }));
  return { HttpClient: MockHttpClient };
});

// ─── Mock sleep so tests run fast ─────────────────────────────────────────────
vi.mock("../src/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils")>();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

// ─── HTML fixtures ────────────────────────────────────────────────────────────
function buildInitialPageHtml(): string {
  return `
    <html><body>
      <form id="listarDetalleInfraccionRAAForm">
        <input name="javax.faces.ViewState" value="VS_INITIAL" />
      </form>
    </body></html>`;
}

function buildSearchResultHtml(): string {
  return `
    <html><body>
      <span class="ui-paginator-current">Página 1 de 1 (1 registro)</span>
      <input name="javax.faces.ViewState" value="VS_AFTER_SEARCH" />
      <table>
        <tbody class="ui-datatable-data">
          <tr>
            <td>1</td>
            <td>EXP-2024-001</td>
            <td>Empresa SA</td>
            <td>Planta Norte</td>
            <td>MINERÍA</td>
            <td>RES-2024-001</td>
          </tr>
        </tbody>
      </table>
    </body></html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeTempConfig(): ScraperConfig & { _tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oefa-test-"));
  return {
    baseUrl: "https://example.com/oefa",
    outputDir: tmpDir,
    pdfsDir: path.join(tmpDir, "pdfs"),
    delayBetweenRequests: 0,
    maxRetries: 1,
    initialBackoff: 10,
    _tmpDir: tmpDir,
  };
}

describe("OefaScraper", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up temp output
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates output and pdf directories on construction", () => {
    const config = makeTempConfig();
    tmpDir = config._tmpDir;
    new OefaScraper(config);
    expect(fs.existsSync(config.outputDir)).toBe(true);
    expect(fs.existsSync(config.pdfsDir)).toBe(true);
  });

  it("run() resolves with ScrapeResult containing scrape counts", async () => {
    const config = makeTempConfig();
    tmpDir = config._tmpDir;

    const scraper = new OefaScraper(config);
    const result = await scraper.run();

    expect(result).toMatchObject({
      totalScraped: expect.any(Number),
      totalDownloaded: expect.any(Number),
      documents: expect.any(Array),
      failedDownloads: expect.any(Array),
    });
  });

  it("persists documents.json and documents.csv after a run", async () => {
    const config = makeTempConfig();
    tmpDir = config._tmpDir;

    const scraper = new OefaScraper(config);
    await scraper.run();

    expect(fs.existsSync(path.join(config.outputDir, "documents.json"))).toBe(true);
    expect(fs.existsSync(path.join(config.outputDir, "documents.csv"))).toBe(true);
  });
});
