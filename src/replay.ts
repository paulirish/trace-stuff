import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface RecordedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string;
  bodyBase64: string;
}

export interface NetworkEntry {
  id: string;
  timestamp: string;
  request: RecordedRequest;
  response: RecordedResponse;
}

export interface NetworkArchiveData {
  version: string;
  createdAt: string;
  entries: NetworkEntry[];
}

export class NetworkRecordReplayer {
  private mode: 'record' | 'replay' | 'passthrough' = 'passthrough';
  private entries: NetworkEntry[] = [];

  constructor(mode: 'record' | 'replay' | 'passthrough' = 'passthrough') {
    this.mode = mode;
  }

  public setMode(mode: 'record' | 'replay' | 'passthrough'): void {
    this.mode = mode;
  }

  public getMode(): 'record' | 'replay' | 'passthrough' {
    return this.mode;
  }

  public clear(): void {
    this.entries = [];
  }

  public record(request: RecordedRequest, response: RecordedResponse): void {
    if (this.mode !== 'record') return;
    const entry: NetworkEntry = {
      id: `req-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      timestamp: new Date().toISOString(),
      request,
      response,
    };
    this.entries.push(entry);
  }

  public findResponse(method: string, url: string): RecordedResponse | undefined {
    if (this.mode !== 'replay') return undefined;
    const match = this.entries.find(
      (e) => e.request.method.toUpperCase() === method.toUpperCase() && e.request.url === url
    );
    return match ? match.response : undefined;
  }

  public async saveArchive(filePath: string): Promise<void> {
    const data: NetworkArchiveData = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      entries: this.entries,
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public async loadArchive(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as NetworkArchiveData;
    this.entries = parsed.entries || [];
  }

  public getEntries(): readonly NetworkEntry[] {
    return this.entries;
  }
}
