import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { logger } from "./logger";
import { Document, FailedDownload, ScraperConfig, ScrapeResult } from "./types";

const DELAY_BETWEEN_PAGES = 3000;
const DELAY_BETWEEN_DOWNLOADS = 2500;

export class PjScraper {
  private config: ScraperConfig;
  private formId = "form1";

  constructor(config: ScraperConfig) {
    this.config = config;
    fs.mkdirSync(config.outputDir, { recursive: true });
    fs.mkdirSync(config.pdfsDir, { recursive: true });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseDocuments($: cheerio.CheerioAPI): Document[] {
    const documents: Document[] = [];
    
    $("tr").each((idx, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2 || $(row).hasClass("ui-datatable-empty-message")) return;

      let pdfUrl: string | null = null;
      $(row).find("a, button, [id*='clink']").each((_, el) => {
        const id = $(el).attr("id");
        if (id && id.includes("tablaResultado:")) {
          pdfUrl = id;
          return false;
        }
      });

      if (!pdfUrl) {
        const idMatch = $(row).html()?.match(/id="([^"]+tablaResultado:[^"]+)"/);
        if (idMatch) pdfUrl = idMatch[1];
      }

      const getText = (cellIdx: number) => $(cells[cellIdx])?.text().trim() ?? "";

      const doc: Document = {
        rowNumber: getText(0) || String(idx + 1),
        expediente: getText(1) || "Expediente-PJ",
        administrado: getText(2) || "PODER JUDICIAL",
        unidadFiscalizable: getText(3) || "SALA SUPREMA",
        sector: getText(4) || "JURISPRUDENCIA",
        nroResolucion: getText(2) || getText(1) || "Resolucion-PJ",
        pdfUrl,
      };

      if (pdfUrl || doc.expediente !== "Expediente-PJ") {
        documents.push(doc);
      }
    });

    return documents;
  }

  async run(): Promise<ScrapeResult> {
    const allDocuments: Document[] = [];
    const failedDownloads: FailedDownload[] = [];
    let totalDownloaded = 0;

    logger.info(`=== PJ Jurisprudencia Scraper via Playwright (VPN required) ===`);
    logger.info(`Launching headless browser instance...`);
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    
    const page = await context.newPage();

    try {
      logger.info(`Navigating directly to target portal: ${this.config.baseUrl}`);
      await page.goto(this.config.baseUrl, { waitUntil: "networkidle", timeout: 60000 });
      await this.sleep(DELAY_BETWEEN_PAGES);

      logger.info("Executing native click trigger on search target...");
      const searchBtnSelector = `input[id*='btnBuscar'], button[id*='btnBuscar'], [id*='btnBuscar']`;
      await page.waitForSelector(searchBtnSelector, { timeout: 15000 });
      await page.click(searchBtnSelector);
      
      logger.info("Waiting for data grid container updates to populate elements...");
      await page.waitForResponse(response => response.url().includes("resultado.xhtml"), { timeout: 20000 });
      await this.sleep(DELAY_BETWEEN_PAGES);

      let hasNextPage = true;
      let currentPageNum = 1;

      while (hasNextPage) {
        logger.info(`Parsing elements from active page view [${currentPageNum}]...`);
        
        const content = await page.content();
        const $ = cheerio.load(content);
        const pageDocs = this.parseDocuments($);

        logger.info(`Page ${currentPageNum}: found ${pageDocs.length} items`);
        allDocuments.push(...pageDocs);

        const nextBtnSelector = ".ui-paginator-next:not(.ui-state-disabled)";
        const nextBtn = await page.$(nextBtnSelector);
        
        if (nextBtn && allDocuments.length < 50) { 
          logger.info("Advancing navigation index to next cluster layout...");
          await nextBtn.click();
          await this.sleep(DELAY_BETWEEN_PAGES);
          currentPageNum++;
        } else {
          hasNextPage = false;
        }
      }

      logger.info(`\nTotal extracted array matches: ${allDocuments.length} documents`);
      
      if (allDocuments.length > 0) {
        logger.info("Initiating browser download pipes for discovered PDF sources...\n");
        
        for (const doc of allDocuments) {
          if (!doc.pdfUrl) continue;

          const baseName = [doc.nroResolucion || doc.expediente || doc.rowNumber]
            .join("_")
            .replace(/[^a-zA-Z0-9_\-]/g, "_")
            .substring(0, 100);
          const filename = `${baseName}.pdf`;
          const filepath = path.join(this.config.pdfsDir, filename);

          if (fs.existsSync(filepath)) {
            logger.info(`File checkpoint exists: ${filename}`);
            totalDownloaded++;
            continue;
          }

          try {
            logger.info(`Requesting direct download instance for: ${filename}`);
            
            const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
            await page.click(`[id='${doc.pdfUrl}']`);
            const download = await downloadPromise;
            
            await download.saveAs(filepath);
            logger.info(`Saved asset storage link: ${filename}`);
            totalDownloaded++;
            await this.sleep(DELAY_BETWEEN_DOWNLOADS);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            logger.error(`Asset operational pipeline failure [${filename}]: ${reason}`);
            failedDownloads.push({ document: doc, reason, attempts: 1 });
            
            await page.goto(this.config.baseUrl, { waitUntil: "networkidle" });
            await page.click(searchBtnSelector);
            await this.sleep(DELAY_BETWEEN_PAGES);
          }
        }
      }

    } catch (globalErr) {
      logger.error(`Critical interruption within browser context execution tree: ${globalErr}`);
    } finally {
      await browser.close();
      logger.info("Terminated isolated runtime environment engine instances safely.");
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
    logger.info(`Documents JSON saved to ${jsonPath}`);

    if (result.failedDownloads.length > 0) {
      const failedPath = path.join(this.config.outputDir, "failed_downloads.json");
      fs.writeFileSync(failedPath, JSON.stringify(result.failedDownloads, null, 2), "utf-8");
      logger.warn(`Failed downloads saved to ${failedPath}`);
    }

    const csvRows = ["Nro,Expediente,Administrado,Unidad Fiscalizable,Sector,Nro Resolucion,PDF URL"];
    for (const doc of result.documents) {
      csvRows.push(
        [doc.rowNumber, doc.expediente, doc.administrado, doc.unidadFiscalizable, doc.sector, doc.nroResolucion, doc.pdfUrl ?? ""]
          .map((v) => `"${v.replace(/"/g, '""')}"`)
          .join(",")
      );
    }
    const csvPath = path.join(this.config.outputDir, "documents.csv");
    fs.writeFileSync(csvPath, csvRows.join("\n"), "utf-8");
    logger.info(`CSV saved to ${csvPath}`);
  }
}