import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { HttpClient } from "./http-client";
import { logger } from "./logger";
import { buildSafeFilename, documentsToCSV, parsePagination, sleep } from "./utils";
import type { Document, FailedDownload, ScraperConfig, ScrapeResult, ViewState } from "./types";

const DELAY_BETWEEN_PAGES = 2_000;
const DELAY_BETWEEN_DOWNLOADS = 1_500;

export class OefaScraper {
  private readonly config: ScraperConfig;
  private readonly http: HttpClient;
  private viewState: ViewState = { value: "" };
  private readonly formId = "listarDetalleInfraccionRAAForm";

  constructor(config: ScraperConfig) {
    this.config = config;
    this.http = new HttpClient(config.maxRetries, config.initialBackoff);
    fs.mkdirSync(config.outputDir, { recursive: true });
    fs.mkdirSync(config.pdfsDir, { recursive: true });
  }

  private extractViewState($: cheerio.CheerioAPI): void {
    const vs = $('input[name="javax.faces.ViewState"]').first().val();
    if (vs && typeof vs === "string") {
      this.viewState.value = vs;
    }
  }

  private parseDocuments($: cheerio.CheerioAPI): Document[] {
    const documents: Document[] = [];

    $(`.ui-datatable-data tr, #${this.formId}\\:dt_data tr`).each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 5 || $(row).hasClass("ui-datatable-empty-message")) return;

      let pdfUrl: string | null = null;

      $(row)
        .find("a, button, input[type='submit'], .ui-commandlink")
        .each((_, el) => {
          const id = $(el).attr("id");
          if (id?.includes(`${this.formId}:dt:`)) {
            pdfUrl = id;
            return false;
          }
          const onclick = $(el).attr("onclick");
          if (onclick?.includes(`${this.formId}:dt:`)) {
            const m = onclick.match(/'([^']+:[^']+:[^']+)'/);
            if (m?.[1]) {
              pdfUrl = m[1];
              return false;
            }
          }
          return;
        });

      if (!pdfUrl) {
        cells.each((_, cell) => {
          $(cell)
            .find("*")
            .each((_, child) => {
              const id = $(child).attr("id");
              if (id?.includes(`${this.formId}:dt:`)) {
                pdfUrl = id;
                return false;
              }
              return;
            });
          if (pdfUrl) return false;
          return;
        });
      }

      const doc: Document = {
        rowNumber: $(cells[0]).text().trim(),
        expediente: $(cells[1]).text().trim(),
        administrado: $(cells[2]).text().trim(),
        unidadFiscalizable: $(cells[3]).text().trim(),
        sector: $(cells[4]).text().trim(),
        nroResolucion: $(cells[5])?.text().trim() ?? "",
        pdfUrl,
      };

      if (doc.expediente || doc.nroResolucion) documents.push(doc);
    });

    return documents;
  }

  private async downloadPdf(doc: Document, failedDownloads: FailedDownload[]): Promise<boolean> {
    if (!doc.pdfUrl) return false;

    const filename = buildSafeFilename(doc);
    const filepath = path.join(this.config.pdfsDir, filename);

    if (fs.existsSync(filepath)) {
      logger.info(`Already downloaded: ${filename}`);
      return true;
    }

    try {
      logger.info(`Downloading PDF: ${filename}`);

      const params = new URLSearchParams({
        "javax.faces.partial.ajax": "true",
        "javax.faces.source": doc.pdfUrl,
        "javax.faces.partial.execute": "@all",
        "javax.faces.partial.render": "@all",
        [doc.pdfUrl]: doc.pdfUrl,
        [this.formId]: this.formId,
        "javax.faces.ViewState": this.viewState.value,
      });

      const buffer = await this.http.postBinary(this.config.baseUrl, params, {
        "X-Requested-With": "XMLHttpRequest",
        "Faces-Request": "partial/ajax",
        Referer: this.config.baseUrl,
      });

      fs.writeFileSync(filepath, buffer);
      logger.info(`Saved: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to download ${filename}: ${reason}`);
      failedDownloads.push({ document: doc, reason, attempts: this.config.maxRetries + 1 });
      return false;
    }
  }

  private async fetchInitialPage(): Promise<cheerio.CheerioAPI> {
    logger.info(`Fetching initial page: ${this.config.baseUrl}`);
    const response = await this.http.get(this.config.baseUrl);
    const $ = cheerio.load(response.data as string);
    this.extractViewState($);
    return $;
  }

  private async submitSearch(): Promise<cheerio.CheerioAPI> {
    logger.info("Submitting search to load all records…");

    const params = new URLSearchParams({
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": `${this.formId}:btnBuscar`,
      "javax.faces.partial.execute": "@all",
      "javax.faces.partial.render": "@all",
      [`${this.formId}:btnBuscar`]: `${this.formId}:btnBuscar`,
      [`${this.formId}:txtExpediente`]: "",
      [`${this.formId}:txtAdministrado`]: "",
      [`${this.formId}:txtUnidadFiscalizable`]: "",
      [`${this.formId}:cmbSector_input`]: "",
      [`${this.formId}:txtNroResolucion`]: "",
      [this.formId]: this.formId,
      "javax.faces.ViewState": this.viewState.value,
    });

    const response = await this.http.post(this.config.baseUrl, params, {
      "X-Requested-With": "XMLHttpRequest",
      "Faces-Request": "partial/ajax",
      Referer: this.config.baseUrl,
    });

    const $ = cheerio.load(response.data as string);
    this.extractViewState($);
    return $;
  }

  private async navigateToPage(pageIndex: number): Promise<cheerio.CheerioAPI> {
    logger.info(`Fetching page ${pageIndex + 1}…`);

    const params = new URLSearchParams({
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": `${this.formId}:dt`,
      "javax.faces.partial.execute": `${this.formId}:dt`,
      "javax.faces.partial.render": `${this.formId}:dt`,
      [`${this.formId}:dt_pagination`]: "true",
      [`${this.formId}:dt_first`]: String(pageIndex * 10),
      [`${this.formId}:dt_rows`]: "10",
      [`${this.formId}:dt_skipChildren`]: "true",
      [this.formId]: this.formId,
      "javax.faces.ViewState": this.viewState.value,
    });

    const response = await this.http.post(this.config.baseUrl, params, {
      "X-Requested-With": "XMLHttpRequest",
      "Faces-Request": "partial/ajax",
      Referer: this.config.baseUrl,
    });

    const $ = cheerio.load(response.data as string);
    this.extractViewState($);
    return $;
  }

  async run(): Promise<ScrapeResult> {
    const allDocuments: Document[] = [];
    const failedDownloads: FailedDownload[] = [];
    let totalDownloaded = 0;

    let $ = await this.fetchInitialPage();
    await sleep(DELAY_BETWEEN_PAGES);

    $ = await this.submitSearch();
    await sleep(DELAY_BETWEEN_PAGES);

    let pagination = parsePagination($);
    logger.info(`Found ${pagination.totalRecords} records across ${pagination.totalPages} pages`);

    if (pagination.totalRecords === 0) {
      logger.warn("No records found with initial search payload.");
      allDocuments.push(...this.parseDocuments($));
    } else {
      const firstPageDocs = this.parseDocuments($);
      allDocuments.push(...firstPageDocs);
      logger.info(`Page 1/${pagination.totalPages}: extracted ${firstPageDocs.length} documents`);

      for (let page = 1; page < pagination.totalPages; page++) {
        await sleep(DELAY_BETWEEN_PAGES);
        $ = await this.navigateToPage(page);
        pagination = parsePagination($);
        const docs = this.parseDocuments($);
        allDocuments.push(...docs);
        logger.info(`Page ${page + 1}/${pagination.totalPages}: extracted ${docs.length} documents`);
      }
    }

    logger.info(`Total documents extracted: ${allDocuments.length}`);
    logger.info("Starting PDF downloads…");

    for (const doc of allDocuments) {
      if (doc.pdfUrl) {
        const ok = await this.downloadPdf(doc, failedDownloads);
        if (ok) totalDownloaded++;
        await sleep(DELAY_BETWEEN_DOWNLOADS);
      } else {
        logger.warn(`No PDF URL for: ${doc.nroResolucion || doc.expediente}`);
      }
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
