import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

export interface ValidatedAddress {
  address: string;
  family: number;
}

export interface HttpGetResult {
  status: number;
  contentType: string | null;
  contentEncoding: string | null;
  bytes: Uint8Array;
}

export interface HttpGetOptions {
  address: ValidatedAddress;
  timeoutMs: number;
  maxBytes: number;
}

export type HttpGet = (url: string, options: HttpGetOptions) => Promise<HttpGetResult>;

export type HttpGetErrorCode = "TIMEOUT" | "TOO_LARGE" | "ENCODING" | "NETWORK";

export class HttpGetError extends Error {
  readonly code: HttpGetErrorCode;

  constructor(code: HttpGetErrorCode, message: string) {
    super(message);
    this.name = "HttpGetError";
    this.code = code;
  }
}

export function createPinnedLookup(address: ValidatedAddress): LookupFunction {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options && typeof options === "object" && (options as { all?: boolean }).all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
  return lookup;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export const httpsGetPinned: HttpGet = (url, options) =>
  new Promise<HttpGetResult>((resolve, reject) => {
    const parsed = new URL(url);
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: parsed.hostname,
        port: 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        servername: parsed.hostname,
        lookup: createPinnedLookup(options.address),
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "accept-encoding": "identity",
          "user-agent": "VYXO-Research/1.0 (+local)",
        },
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = response.headers["content-type"] ?? null;
        const contentEncoding = response.headers["content-encoding"] ?? null;

        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, contentType, contentEncoding, bytes: new Uint8Array() });
          return;
        }

        const chunks: Uint8Array[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > options.maxBytes) {
            request.destroy();
            reject(new HttpGetError("TOO_LARGE", "The source is larger than the allowed size."));
            return;
          }
          chunks.push(new Uint8Array(chunk));
        });
        response.on("end", () => {
          resolve({ status, contentType, contentEncoding, bytes: concat(chunks, total) });
        });
        response.on("error", () => {
          reject(new HttpGetError("NETWORK", "The response failed."));
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new HttpGetError("TIMEOUT", "The source took too long to respond."));
    });
    request.on("error", (error: Error) => {
      if (error instanceof HttpGetError) reject(error);
      else reject(new HttpGetError("NETWORK", "The source could not be retrieved."));
    });
    request.end();
  });
