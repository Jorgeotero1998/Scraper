import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { logger } from "./logger";
import { buildSafeFilename, documentsToCSV, sleep } from "./utils";
import type { Document, FailedDownload, ScraperConfig, ScrapeResult } from "./types";

const DELAY_BETWEEN_PAGES = 3_000;
const DELAY_BETWEEN_DOWNLOADS = 2_500;
const MAX_PAGES_WITHOUT_VPN_GUARD = 50;

export class PjScraper {
  private readonly config: ScraperConfig;
  private readonly formId = "form1";

  constructor(config: ScraperConfig) {
    this.config = config;
    fs.mkdirSync(config.outputDir, { recursive: true });
    fs.mkdirSync(config.pdfsDir, { recursive: true });
  }

  private parseDocuments($: cheerio.CheerioAPI): Document[] {
    const documents: Document[] = [];

    $("tr").each((idx, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2 || $(row).hasClass("ui-datatable-empty-message")) return;

      let pdfUrl: string | null = null;

      $(row)
        .find("a, button, [id*='clink']")
        .each((_, el) => {
          const id = $(el).attr("id");
          if (id?.includes("tablaResultado:")) {
            pdfUrl = id;
            return false;
          }
          return;
        });

      if (!pdfUrl) {
        const idMatch = $(row)
          .html()
          ?.match(/id="([^"]+tablaResultado:[^"]+)"/);
        if (idMatch) pdfUrl = idMatch[1];
      }

      const getText = (cellIdx: number) => $(cells[cellIdx])?.text().trim() ?? "";

      const doc: Document = {
        rowNumber: getText(0) || String(idx + 1),
        expediente: getText(1) || "N/A",
        administrado: getText(2) || "PODER JUDICIAL",
        unidadFiscalizable: getText(3) || "SALA SUPREMA",
        sector: getText(4) || "JURISPRUDENCIA",
        nroResolucion: getText(2) || getText(1) || "N/A",
        pdfUrl,
      };

      if (pdfUrl || doc.expediente !== "N/A") documents.push(doc);
    });

    return documents;
  }

  async run(): Promise<ScrapeResult> {
    const allDocuments: Document[] = [];
    const failedDownloads: FailedDownload[] = [];
    let totalDownloaded = 0;

    logger.info("Launching headless browser (Playwright/Chromium)…");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
      logger.info(`Navigating to: ${this.config.baseUrl}`);
      await page.goto(this.config.baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
      await sleep(DELAY_BETWEEN_PAGES);

      const searchBtnSelector = `input[id*='btnBuscar'], button[id*='btnBuscar'], [id*='btnBuscar']`;
      logger.info("Triggering search…");
      await page.waitForSelector(searchBtnSelector, { timeout: 15_000 });
      await page.click(searchBtnSelector);

      await page.waitForResponse((res) => res.url().includes("resultado.xhtml"), {
        timeout: 20_000,
      });
      await sleep(DELAY_BETWEEN_PAGES);

      let hasNextPage = true;
      let currentPage = 1;

      while (hasNextPage && currentPage <= MAX_PAGES_WITHOUT_VPN_GUARD) {
        logger.info(`Parsing page ${currentPage}…`);
        const content = await page.content();
        const $ = cheerio.load(content);
        const pageDocs = this.parseDocuments($);
        logger.info(`Page ${currentPage}: found ${pageDocs.length} documents`);
        allDocuments.push(...pageDocs);

        const nextBtn = await page.$(".ui-paginator-next:not(.ui-state-disabled)");
        if (nextBtn) {
          await nextBtn.click();
          await sleep(DELAY_BETWEEN_PAGES);
          currentPage++;
        } else {
          hasNextPage = false;
        }
      }

      logger.info(`Total documents extracted: ${allDocuments.length}`);

      if (allDocuments.length > 0) {
        logger.info("Downloading PDFs…");

        for (const doc of allDocuments) {
          if (!doc.pdfUrl) continue;

          const filename = buildSafeFilename(doc);
          const filepath = path.join(this.config.pdfsDir, filename);

          if (fs.existsSync(filepath)) {
            logger.info(`Already downloaded: ${filename}`);
            totalDownloaded++;
            continue;
          }

          try {
            logger.info(`Downloading: ${filename}`);
            const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
            await page.click(`[id='${doc.pdfUrl}']`);
            const download = await downloadPromise;
            await download.saveAs(filepath);
            logger.info(`Saved: ${filename}`);
            totalDownloaded++;
            await sleep(DELAY_BETWEEN_DOWNLOADS);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to download ${filename}: ${reason}`);
            failedDownloads.push({ document: doc, reason, attempts: 1 });

            // Re-navigate to search results to recover session state.
            await page.goto(this.config.baseUrl, { waitUntil: "networkidle" });
            await page.click(searchBtnSelector);
            await sleep(DELAY_BETWEEN_PAGES);
          }
        }
      }
    } catch (err) {
      logger.error(`Scraper failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await browser.close();
      logger.info("Browser closed.");
    }

    const result: ScrapeResult = {
      documents: allDocuments,
      failedDownloads,
      totalScraped: allDocuments.length,
      totalDownloaded,
    };

    this.saveResults(result);
    return result;
  }

  private saveResults(result: ScrapeResult): void {
    const jsonPath = path.join(this.config.outputDir, "documents.json");
    fs.writeFileSync(jsonPath, JSON.stringify(result.documents, null, 2), "utf-8");
    logger.info(`Saved JSON → ${jsonPath}`);

    if (result.failedDownloads.length > 0) {
      const failedPath = path.join(this.config.outputDir, "failed_downloads.json");
      fs.writeFileSync(failedPath, JSON.stringify(result.failedDownloads, null, 2), "utf-8");
      logger.warn(`${result.failedDownloads.length} failed downloads → ${failedPath}`);
    }

    const csvPath = path.join(this.config.outputDir, "documents.csv");
    fs.writeFileSync(csvPath, documentsToCSV(result.documents), "utf-8");
    logger.info(`Saved CSV  → ${csvPath}`);
  }
}
