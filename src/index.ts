import path from "path";
import { OefaScraper } from "./oefa-scraper";
import { PjScraper } from "./pj-scraper";
import { logger } from "./logger";
import { ScraperConfig } from "./types";

const args = process.argv.slice(2);
const useSite = args.find((a) => a.startsWith("--site="))?.split("=")[1] ?? "pj";

async function main() {
  const site = useSite.toLowerCase();

  if (site === "oefa") {
    const config: ScraperConfig = {
      baseUrl: "https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml",
      outputDir: path.join("output"),
      pdfsDir: path.join("output", "pdfs"),
      delayBetweenRequests: 2000,
      maxRetries: 5,
      initialBackoff: 1000,
    };

    logger.info("=== OEFA Scraper (no VPN required) ===");
    const scraper = new OefaScraper(config);
    const result = await scraper.run();

    logger.info("\n=== FINAL SUMMARY ===");
    logger.info(`Total documents scraped : ${result.totalScraped}`);
    logger.info(`Total PDFs downloaded   : ${result.totalDownloaded}`);
    logger.info(`Failed downloads        : ${result.failedDownloads.length}`);
  } else {
    const config: ScraperConfig = {
      baseUrl:
        "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml",
      outputDir: path.join("output"),
      pdfsDir: path.join("output", "pdfs"),
      delayBetweenRequests: 2500,
      maxRetries: 5,
      initialBackoff: 1500,
    };

    logger.info("=== PJ Jurisprudencia Scraper (VPN required) ===");
    const scraper = new PjScraper(config);
    const result = await scraper.run();

    logger.info("\n=== FINAL SUMMARY ===");
    logger.info(`Total documents scraped : ${result.totalScraped}`);
    logger.info(`Total PDFs downloaded   : ${result.totalDownloaded}`);
    logger.info(`Failed downloads        : ${result.failedDownloads.length}`);
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
