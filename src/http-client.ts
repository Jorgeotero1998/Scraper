import axios, { AxiosInstance, AxiosResponse } from "axios";
import { logger } from "./logger";

const RATE_LIMIT_STATUS = 429;
const SERVER_ERROR_STATUS = 500;

export class HttpClient {
  private client: AxiosInstance;
  private maxRetries: number;
  private initialBackoff: number;
  private cookies: Map<string, string> = new Map();

  constructor(maxRetries = 5, initialBackoff = 1000) {
    this.maxRetries = maxRetries;
    this.initialBackoff = initialBackoff;

    this.client = axios.create({
      timeout: 30000,
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
      validateStatus: () => true,
    });

    this.client.interceptors.response.use((response) => {
      const setCookie = response.headers["set-cookie"];
      if (setCookie) {
        setCookie.forEach((cookieStr: string) => {
          const [pair] = cookieStr.split(";");
          const [key, value] = pair.split("=");
          if (key && value) {
            this.cookies.set(key.trim(), value.trim());
          }
        });
      }
      return response;
    });
  }

  private buildCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getBackoffTime(attempt: number): number {
    return this.initialBackoff * Math.pow(2, attempt) + Math.random() * 500;
  }

  async get(url: string, extraHeaders: Record<string, string> = {}): Promise<AxiosResponse> {
    const cookieHeader = this.buildCookieHeader();
    const headers: Record<string, string> = { ...extraHeaders };
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.get(url, { headers });

        if (response.status === RATE_LIMIT_STATUS) {
          const backoff = this.getBackoffTime(attempt);
          logger.warn(
            `Rate limited (429) on GET ${url}. Attempt ${attempt + 1}/${this.maxRetries + 1}. Waiting ${Math.round(backoff)}ms...`
          );
          await this.sleep(backoff);
          continue;
        }

        if (response.status === SERVER_ERROR_STATUS && attempt < this.maxRetries) {
          const backoff = this.getBackoffTime(attempt);
          logger.warn(`Server error (500) on GET ${url}. Retrying in ${Math.round(backoff)}ms...`);
          await this.sleep(backoff);
          continue;
        }

        return response;
      } catch (error) {
        if (attempt === this.maxRetries) throw error;
        const backoff = this.getBackoffTime(attempt);
        logger.warn(`Network error on GET ${url}. Retrying in ${Math.round(backoff)}ms...`);
        await this.sleep(backoff);
      }
    }

    throw new Error(`Max retries exceeded for GET ${url}`);
  }

  async post(
    url: string,
    data: URLSearchParams | string,
    extraHeaders: Record<string, string> = {}
  ): Promise<AxiosResponse> {
    const cookieHeader = this.buildCookieHeader();
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    };
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post(url, data.toString(), { headers });

        if (response.status === RATE_LIMIT_STATUS) {
          const backoff = this.getBackoffTime(attempt);
          logger.warn(
            `Rate limited (429) on POST ${url}. Attempt ${attempt + 1}/${this.maxRetries + 1}. Waiting ${Math.round(backoff)}ms...`
          );
          await this.sleep(backoff);
          continue;
        }

        if (response.status === SERVER_ERROR_STATUS && attempt < this.maxRetries) {
          const backoff = this.getBackoffTime(attempt);
          logger.warn(`Server error (500) on POST ${url}. Retrying in ${Math.round(backoff)}ms...`);
          await this.sleep(backoff);
          continue;
        }

        return response;
      } catch (error) {
        if (attempt === this.maxRetries) throw error;
        const backoff = this.getBackoffTime(attempt);
        logger.warn(`Network error on POST ${url}. Retrying in ${Math.round(backoff)}ms...`);
        await this.sleep(backoff);
      }
    }

    throw new Error(`Max retries exceeded for POST ${url}`);
  }

  async getBinary(url: string): Promise<Buffer> {
    const cookieHeader = this.buildCookieHeader();
    const headers: Record<string, string> = {};
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.get(url, {
          headers,
          responseType: "arraybuffer",
        });

        if (response.status === RATE_LIMIT_STATUS) {
          const backoff = this.getBackoffTime(attempt);
          logger.warn(
            `Rate limited (429) downloading ${url}. Attempt ${attempt + 1}/${this.maxRetries + 1}. Waiting ${Math.round(backoff)}ms...`
          );
          await this.sleep(backoff);
          continue;
        }

        if (response.status === 200) {
          return Buffer.from(response.data);
        }

        throw new Error(`Unexpected status ${response.status} for binary GET ${url}`);
      } catch (error) {
        if (attempt === this.maxRetries) throw error;
        const backoff = this.getBackoffTime(attempt);
        logger.warn(`Error downloading ${url}. Retrying in ${Math.round(backoff)}ms...`);
        await this.sleep(backoff);
      }
    }

    throw new Error(`Max retries exceeded for binary GET ${url}`);
  }

  async postBinary(
    url: string,
    data: URLSearchParams | string,
    extraHeaders: Record<string, string> = {}
  ): Promise<Buffer> {
    const cookieHeader = this.buildCookieHeader();
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    };
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post(url, data.toString(), {
          headers,
          responseType: "arraybuffer",
        });

        if (response.status === RATE_LIMIT_STATUS) {
          const backoff = this.getBackoffTime(attempt);
          logger.warn(
            `Rate limited (429) downloading binary via POST. Attempt ${attempt + 1}/${this.maxRetries + 1}. Waiting ${Math.round(backoff)}ms...`
          );
          await this.sleep(backoff);
          continue;
        }

        return Buffer.from(response.data);
      } catch (error) {
        if (attempt === this.maxRetries) throw error;
        const backoff = this.getBackoffTime(attempt);
        logger.warn(`Error downloading binary via POST. Retrying in ${Math.round(backoff)}ms...`);
        await this.sleep(backoff);
      }
    }

    throw new Error(`Max retries exceeded for binary POST ${url}`);
  }
}