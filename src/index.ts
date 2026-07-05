import path from "path";
import { OefaScraper } from "./oefa-scraper";
import { PjScraper } from "./pj-scraper";
import { logger } from "./logger";
import type { ScraperConfig } from "./types";

interface CliArgs {
  site: "oefa" | "pj";
  outputDir: string;
  delay: number;
  maxRetries: number;
  initialBackoff: number;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string) =>
    argv.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1];

  const site = (get("site") ?? "pj").toLowerCase();
  if (site !== "oefa" && site !== "pj") {
    console.error(`Unknown --site="${site}". Valid values: oefa, pj`);
    process.exit(1);
  }

  return {
    site,
    outputDir: get("output-dir") ?? path.join("output"),
    delay: parseInt(get("delay") ?? "2000", 10),
    maxRetries: parseInt(get("max-retries") ?? "5", 10),
    initialBackoff: parseInt(get("initial-backoff") ?? "1000", 10),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const config: ScraperConfig = {
    baseUrl:
      args.site === "oefa"
        ? "https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml"
        : "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml",
    outputDir: args.outputDir,
    pdfsDir: path.join(args.outputDir, "pdfs"),
    delayBetweenRequests: args.delay,
    maxRetries: args.maxRetries,
    initialBackoff: args.initialBackoff,
  };

  if (args.site === "oefa") {
    logger.info("=== OEFA Scraper (no VPN required) ===");
    const scraper = new OefaScraper(config);
    const result = await scraper.run();
    logger.info("=== Summary ===");
    logger.info(`Documents scraped : ${result.totalScraped}`);
    logger.info(`PDFs downloaded   : ${result.totalDownloaded}`);
    logger.info(`Failed downloads  : ${result.failedDownloads.length}`);
  } else {
    logger.info("=== PJ Jurisprudencia Scraper (VPN required) ===");
    const scraper = new PjScraper(config);
    const result = await scraper.run();
    logger.info("=== Summary ===");
    logger.info(`Documents scraped : ${result.totalScraped}`);
    logger.info(`PDFs downloaded   : ${result.totalDownloaded}`);
    logger.info(`Failed downloads  : ${result.failedDownloads.length}`);
  }
}

main().catch((err) => {
  logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
