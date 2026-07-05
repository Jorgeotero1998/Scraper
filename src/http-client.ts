import axios, { AxiosInstance, AxiosResponse } from "axios";
import { logger } from "./logger";
import { getBackoffMs, sleep } from "./utils";

const RATE_LIMIT_STATUS = 429;
const SERVER_ERROR_STATUS = 500;

export class HttpClient {
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly initialBackoff: number;
  private readonly cookies: Map<string, string> = new Map();

  constructor(maxRetries = 5, initialBackoff = 1000) {
    this.maxRetries = maxRetries;
    this.initialBackoff = initialBackoff;

    this.client = axios.create({
      timeout: 30_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
      },
      maxRedirects: 5,
      // Surface all status codes so retry logic can handle them.
      validateStatus: () => true,
    });

    this.client.interceptors.response.use((response) => {
      this.parseCookies(response.headers["set-cookie"]);
      return response;
    });
  }

  private parseCookies(setCookie: string[] | undefined): void {
    if (!setCookie) return;
    for (const cookieStr of setCookie) {
      const [pair] = cookieStr.split(";");
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const key = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      if (key) this.cookies.set(key, value);
    }
  }

  private buildCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private extraHeaders(override: Record<string, string> = {}): Record<string, string> {
    const cookieHeader = this.buildCookieHeader();
    const headers: Record<string, string> = { ...override };
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    return headers;
  }

  private async retryOrThrow(
    method: string,
    url: string,
    attempt: number,
    error: unknown
  ): Promise<void> {
    if (attempt >= this.maxRetries) {
      if (error instanceof Error) throw error;
      throw new Error(String(error));
    }
    const backoff = getBackoffMs(this.initialBackoff, attempt);
    logger.warn(`${method} ${url} — network error, retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${this.maxRetries})`);
    await sleep(backoff);
  }

  async get(url: string, extraHeaders: Record<string, string> = {}): Promise<AxiosResponse> {
    const headers = this.extraHeaders(extraHeaders);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.get(url, { headers });

        if (response.status === RATE_LIMIT_STATUS || response.status === SERVER_ERROR_STATUS) {
          const backoff = getBackoffMs(this.initialBackoff, attempt);
          logger.warn(`GET ${url} — HTTP ${response.status}, retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`);
          await sleep(backoff);
          continue;
        }

        return response;
      } catch (error) {
        await this.retryOrThrow("GET", url, attempt, error);
      }
    }

    throw new Error(`Max retries (${this.maxRetries}) exceeded for GET ${url}`);
  }

  async post(
    url: string,
    data: URLSearchParams | string,
    extraHeaders: Record<string, string> = {}
  ): Promise<AxiosResponse> {
    const headers = this.extraHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post(url, data.toString(), { headers });

        if (response.status === RATE_LIMIT_STATUS || response.status === SERVER_ERROR_STATUS) {
          const backoff = getBackoffMs(this.initialBackoff, attempt);
          logger.warn(`POST ${url} — HTTP ${response.status}, retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`);
          await sleep(backoff);
          continue;
        }

        return response;
      } catch (error) {
        await this.retryOrThrow("POST", url, attempt, error);
      }
    }

    throw new Error(`Max retries (${this.maxRetries}) exceeded for POST ${url}`);
  }

  async getBinary(url: string): Promise<Buffer> {
    const headers = this.extraHeaders();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.get(url, { headers, responseType: "arraybuffer" });

        if (response.status === RATE_LIMIT_STATUS) {
          const backoff = getBackoffMs(this.initialBackoff, attempt);
          logger.warn(`GET ${url} — rate limited, retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`);
          await sleep(backoff);
          continue;
        }

        if (response.status === 200) return Buffer.from(response.data as ArrayBuffer);

        throw new Error(`Unexpected status ${response.status} downloading ${url}`);
      } catch (error) {
        await this.retryOrThrow("GET (binary)", url, attempt, error);
      }
    }

    throw new Error(`Max retries (${this.maxRetries}) exceeded for binary GET ${url}`);
  }

  async postBinary(
    url: string,
    data: URLSearchParams | string,
    extraHeaders: Record<string, string> = {}
  ): Promise<Buffer> {
    const headers = this.extraHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post(url, data.toString(), {
          headers,
          responseType: "arraybuffer",
        });

        if (response.status === RATE_LIMIT_STATUS) {
          const backoff = getBackoffMs(this.initialBackoff, attempt);
          logger.warn(`POST ${url} — rate limited, retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`);
          await sleep(backoff);
          continue;
        }

        return Buffer.from(response.data as ArrayBuffer);
      } catch (error) {
        await this.retryOrThrow("POST (binary)", url, attempt, error);
      }
    }

    throw new Error(`Max retries (${this.maxRetries}) exceeded for binary POST ${url}`);
  }
}
