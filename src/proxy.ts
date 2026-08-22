import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { NetworkRecordReplayer } from './replay.ts';

export interface NetworkAccountingSummary {
  requestCount: number;
  encodedResponseBytes: number;
  decodedResponseBytes: number;
  htmlBytes: number;
  jsBytes: number;
  cssBytes: number;
  externalRequestCount: number;
}

export class DeterministicOriginProxy {
  private server: http.Server | null = null;
  private port: number = 0;
  private variantADir: string = '';
  private variantBDir: string = '';
  private activeVariant: 'A' | 'B' = 'A';
  private replayer: NetworkRecordReplayer = new NetworkRecordReplayer('passthrough');

  private metrics: NetworkAccountingSummary = {
    requestCount: 0,
    encodedResponseBytes: 0,
    decodedResponseBytes: 0,
    htmlBytes: 0,
    jsBytes: 0,
    cssBytes: 0,
    externalRequestCount: 0,
  };

  public setVariants(variantADir: string, variantBDir: string): void {
    this.variantADir = variantADir;
    this.variantBDir = variantBDir;
  }

  public setActiveVariant(variant: 'A' | 'B'): void {
    this.activeVariant = variant;
  }

  public getActiveVariant(): 'A' | 'B' {
    return this.activeVariant;
  }

  public setReplayMode(mode: 'record' | 'replay' | 'passthrough'): void {
    this.replayer.setMode(mode);
  }

  public getReplayer(): NetworkRecordReplayer {
    return this.replayer;
  }

  public resetMetrics(): void {
    this.metrics = {
      requestCount: 0,
      encodedResponseBytes: 0,
      decodedResponseBytes: 0,
      htmlBytes: 0,
      jsBytes: 0,
      cssBytes: 0,
      externalRequestCount: 0,
    };
  }

  public getNetworkSummary(): NetworkAccountingSummary {
    return { ...this.metrics };
  }

  public getOrigin(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  public async start(requestedPort: number = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err: Error) => {
          res.statusCode = 500;
          res.end(`Internal Server Error: ${err.message}`);
        });
      });

      this.server.listen(requestedPort, '127.0.0.1', () => {
        const addr = this.server?.address() as AddressInfo;
        this.port = addr.port;
        resolve(this.port);
      });

      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        return resolve();
      }
      this.server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.metrics.requestCount++;
    const method = req.method || 'GET';
    const reqUrl = req.url || '/';

    if (this.replayer.getMode() === 'replay') {
      const recorded = this.replayer.findResponse(method, reqUrl);
      if (recorded) {
        const body = Buffer.from(recorded.bodyBase64, 'base64');
        this.metrics.encodedResponseBytes += body.byteLength;
        this.metrics.decodedResponseBytes += body.byteLength;
        res.writeHead(recorded.status, recorded.headers);
        res.end(body);
        return;
      }
    }

    const currentDir = this.activeVariant === 'A' ? this.variantADir : this.variantBDir;
    const parsedPath = reqUrl.split('?')[0];

    let relativePath = parsedPath === '/' ? 'index.html' : parsedPath;
    if (relativePath.startsWith('/')) {
      relativePath = relativePath.slice(1);
    }

    const filePath = path.join(currentDir, relativePath);

    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();

      let contentType = 'text/plain';
      if (ext === '.html') contentType = 'text/html; charset=utf-8';
      else if (ext === '.js' || ext === '.mjs') contentType = 'text/javascript; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css; charset=utf-8';
      else if (ext === '.json') contentType = 'application/json';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.svg') contentType = 'image/svg+xml';

      const byteLength = content.byteLength;
      this.metrics.encodedResponseBytes += byteLength;
      this.metrics.decodedResponseBytes += byteLength;

      if (contentType.includes('html')) {
        this.metrics.htmlBytes += byteLength;
      } else if (contentType.includes('javascript')) {
        this.metrics.jsBytes += byteLength;
      } else if (contentType.includes('css')) {
        this.metrics.cssBytes += byteLength;
      }

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Length': String(byteLength),
        'Cache-Control': 'no-store, must-revalidate',
      };

      if (this.replayer.getMode() === 'record') {
        this.replayer.record(
          { method, url: reqUrl, headers: {} },
          { status: 200, statusText: 'OK', headers, contentType, bodyBase64: content.toString('base64') }
        );
      }

      res.writeHead(200, headers);
      res.end(content);
    } catch {
      this.metrics.externalRequestCount++;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
  }
}
