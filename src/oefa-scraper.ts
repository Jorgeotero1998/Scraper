import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { HttpClient } from "./http-client";
import { logger } from "./logger";
import { Document, FailedDownload, PaginationInfo, ScraperConfig, ScrapeResult, ViewState } from "./types";

const DELAY_BETWEEN_PAGES = 2000;
const DELAY_BETWEEN_DOWNLOADS = 1500;

export class OefaScraper {
  private config: ScraperConfig;
  private http: HttpClient;
  private viewState: ViewState = { value: "" };
  private formId = "listarDetalleInfraccionRAAForm";

  constructor(config: ScraperConfig) {
    this.config = config;
    this.http = new HttpClient(config.maxRetries, config.initialBackoff);
    fs.mkdirSync(config.outputDir, { recursive: true });
    fs.mkdirSync(config.pdfsDir, { recursive: true });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractViewState($: cheerio.CheerioAPI): void {
    const vs = $('input[name="javax.faces.ViewState"]').first().val();
    if (vs && typeof vs === "string") {
      this.viewState.value = vs;
    }
  }

  private parsePagination($: cheerio.CheerioAPI): PaginationInfo {
    const paginationText = $(".ui-paginator-current").text().trim();
    const match = paginationText.match(/P[aá]gina\s+(\d+)\s+de\s+(\d+)\s*\((\d+)\s+registros?\)/i);

    if (match) {
      return {
        currentPage: parseInt(match[1], 10),
        totalPages: parseInt(match[2], 10),
        totalRecords: parseInt(match[3], 10),
      };
    }
    return { currentPage: 1, totalPages: 1, totalRecords: 0 };
  }

  private parseDocuments($: cheerio.CheerioAPI): Document[] {
    const documents: Document[] = [];

    $(`.ui-datatable-data tr, #${this.formId}\\:dt_data tr`).each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 5 || $(row).hasClass("ui-datatable-empty-message")) return;

      let pdfUrl: string | null = null;

      const interactiveElements = $(row).find("a, button, input[type='submit'], .ui-commandlink");
      interactiveElements.each((_, el) => {
        const id = $(el).attr("id");
        if (id && id.includes(`${this.formId}:dt:`)) {
          pdfUrl = id;
          return false;
        }
        const onclick = $(el).attr("onclick");
        if (onclick && onclick.includes(`${this.formId}:dt:`)) {
          const match = onclick.match(/'([^']+:[^']+:[^']+)'/);
          if (match && match[1]) {
            pdfUrl = match[1];
            return false;
          }
        }
      });

      if (!pdfUrl) {
        $(cells).each((_, cell) => {
          $(cell).find("*").each((_, child) => {
            const id = $(child).attr("id");
            if (id && id.includes(`${this.formId}:dt:`)) {
              pdfUrl = id;
              return false;
            }
          });
          if (pdfUrl) return false;
        });
      }

      const doc: Document = {
        rowNumber: $(cells[0]).text().trim(),
        expediente: $(cells[1]).text().trim(),
        administrado: $(cells[2]).text().trim(),
        unidadFiscalizable: $(cells[3]).text().trim(),
        sector: $(cells[4]).text().trim(),
        nroResolucion: $(cells[5])?.text().trim() || "",
        pdfUrl,
      };

      if (doc.expediente || doc.nroResolucion) {
        documents.push(doc);
      }
    });

    return documents;
  }

  private buildSafeFilename(doc: Document): string {
    const base = [doc.nroResolucion || doc.expediente || doc.rowNumber]
      .join("_")
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 100);
    return `${base}.pdf`;
  }

  private async downloadPdf(doc: Document, failedDownloads: FailedDownload[]): Promise<boolean> {
    if (!doc.pdfUrl) return false;

    const filename = this.buildSafeFilename(doc);
    const filepath = path.join(this.config.pdfsDir, filename);

    if (fs.existsSync(filepath)) {
      logger.info(`Already downloaded: ${filename}`);
      return true;
    }

    try {
      logger.info(`Downloading PDF via JSF POST: ${filename}`);

      const params = new URLSearchParams();
      params.set("javax.faces.partial.ajax", "true");
      params.set("javax.faces.source", doc.pdfUrl);
      params.set("javax.faces.partial.execute", "@all");
      params.set("javax.faces.partial.render", "@all");
      params.set(doc.pdfUrl, doc.pdfUrl);
      params.set(this.formId, this.formId);
      params.set("javax.faces.ViewState", this.viewState.value);

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
    logger.info("Submitting search to load all records...");

    const params = new URLSearchParams();
    params.set("javax.faces.partial.ajax", "true");
    params.set("javax.faces.source", `${this.formId}:btnBuscar`);
    params.set("javax.faces.partial.execute", "@all");
    params.set("javax.faces.partial.render", "@all");
    params.set(`${this.formId}:btnBuscar`, `${this.formId}:btnBuscar`);
    params.set(`${this.formId}:txtExpediente`, "");
    params.set(`${this.formId}:txtAdministrado`, "");
    params.set(`${this.formId}:txtUnidadFiscalizable`, "");
    params.set(`${this.formId}:cmbSector_input`, "");
    params.set(`${this.formId}:txtNroResolucion`, "");
    params.set(`${this.formId}`, this.formId);
    params.set("javax.faces.ViewState", this.viewState.value);

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
    logger.info(`Navigating to page ${pageIndex + 1}...`);

    const params = new URLSearchParams();
    params.set("javax.faces.partial.ajax", "true");
    params.set("javax.faces.source", `${this.formId}:dt`);
    params.set("javax.faces.partial.execute", `${this.formId}:dt`);
    params.set("javax.faces.partial.render", `${this.formId}:dt`);
    params.set(`${this.formId}:dt_pagination`, "true");
    params.set(`${this.formId}:dt_first`, String(pageIndex * 10));
    params.set(`${this.formId}:dt_rows`, "10");
    params.set(`${this.formId}:dt_skipChildren`, "true");
    params.set(`${this.formId}`, this.formId);
    params.set("javax.faces.ViewState", this.viewState.value);

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
    await this.sleep(DELAY_BETWEEN_PAGES);

    $ = await this.submitSearch();
    await this.sleep(DELAY_BETWEEN_PAGES);

    let pagination = this.parsePagination($);
    logger.info(`Found ${pagination.totalRecords} records across ${pagination.totalPages} pages`);

    if (pagination.totalRecords === 0) {
      logger.warn("No records found with initial search payload.");
      const docs = this.parseDocuments($);
      allDocuments.push(...docs);
    } else {
      const docsOnFirstPage = this.parseDocuments($);
      allDocuments.push(...docsOnFirstPage);
      logger.info(`Page 1: extracted ${docsOnFirstPage.length} documents`);

      for (let page = 1; page < pagination.totalPages; page++) {
        await this.sleep(DELAY_BETWEEN_PAGES);
        $ = await this.navigateToPage(page);
        pagination = this.parsePagination($);

        const docs = this.parseDocuments($);
        allDocuments.push(...docs);
        logger.info(`Page ${page + 1}: extracted ${docs.length} documents`);
      }
    }

    logger.info(`\nTotal documents extracted: ${allDocuments.length}`);
    logger.info("Starting PDF downloads...\n");

    for (const doc of allDocuments) {
      if (doc.pdfUrl) {
        const success = await this.downloadPdf(doc, failedDownloads);
        if (success) totalDownloaded++;
        await this.sleep(DELAY_BETWEEN_DOWNLOADS);
      } else {
        logger.warn(`No PDF URL found for: ${doc.nroResolucion || doc.expediente}`);
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
    logger.info(`Documents saved to ${jsonPath}`);

    if (result.failedDownloads.length > 0) {
      const failedPath = path.join(this.config.outputDir, "failed_downloads.json");
      fs.writeFileSync(failedPath, JSON.stringify(result.failedDownloads, null, 2), "utf-8");
      logger.warn(`${result.failedDownloads.length} failed downloads saved to ${failedPath}`);
    }

    const csvRows = ["Nro,Expediente,Administrado,Unidad Fiscalizable,Sector,Nro Resolucion,PDF URL"];
    for (const doc of result.documents) {
      csvRows.push(
        [
          doc.rowNumber,
          doc.expediente,
          doc.administrado,
          doc.unidadFiscalizable,
          doc.sector,
          doc.nroResolucion,
          doc.pdfUrl ?? "",
        ]
          .map((v) => `"${v.replace(/"/g, '""')}"`)
          .join(",")
      );
    }
    const csvPath = path.join(this.config.outputDir, "documents.csv");
    fs.writeFileSync(csvPath, csvRows.join("\n"), "utf-8");
    logger.info(`CSV saved to ${csvPath}`);
  }
}