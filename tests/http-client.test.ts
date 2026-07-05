import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { HttpClient } from "../src/http-client";

vi.mock("axios");

const mockedAxios = vi.mocked(axios);

// Convenience: create a minimal fake Axios instance returned by axios.create()
function makeMockAxiosInstance(overrides: Partial<Record<string, unknown>> = {}) {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: {
      response: { use: vi.fn() },
    },
    ...overrides,
  };
  mockedAxios.create = vi.fn().mockReturnValue(instance);
  return instance;
}

describe("HttpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get()", () => {
    it("returns the response on HTTP 200", async () => {
      const instance = makeMockAxiosInstance();
      const fakeResponse = { status: 200, data: "<html>ok</html>", headers: {} };
      (instance.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeResponse);

      const client = new HttpClient(1, 10);
      const response = await client.get("https://example.com");

      expect(response.status).toBe(200);
      expect(response.data).toBe("<html>ok</html>");
    });

    it("retries once on HTTP 429 then succeeds", async () => {
      const instance = makeMockAxiosInstance();
      const rateLimitResponse = { status: 429, data: "", headers: {} };
      const okResponse = { status: 200, data: "ok", headers: {} };

      (instance.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(okResponse);

      // Patch sleep so the test doesn't actually wait
      const sleepModule = await import("../src/utils");
      vi.spyOn(sleepModule, "sleep").mockResolvedValue(undefined);

      const client = new HttpClient(2, 10);
      const response = await client.get("https://example.com");

      expect(instance.get).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(200);
    });

    it("throws after exhausting all retries", async () => {
      const instance = makeMockAxiosInstance();
      (instance.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));

      const sleepModule = await import("../src/utils");
      vi.spyOn(sleepModule, "sleep").mockResolvedValue(undefined);

      const client = new HttpClient(2, 10);
      await expect(client.get("https://example.com")).rejects.toThrow("ECONNREFUSED");
      expect(instance.get).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe("post()", () => {
    it("sends URLSearchParams serialised as a string", async () => {
      const instance = makeMockAxiosInstance();
      const fakeResponse = { status: 200, data: "ok", headers: {} };
      (instance.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeResponse);

      const client = new HttpClient(1, 10);
      const params = new URLSearchParams({ key: "value" });
      await client.post("https://example.com", params);

      const [, body] = (instance.post as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).toBe("key=value");
    });
  });
});
