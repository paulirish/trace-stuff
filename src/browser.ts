import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import puppeteer, { type Browser, type Page, type CDPSession } from 'puppeteer-core';
import type {
  BrowserPolicy,
  ContextDriver,
  SerializedDOMNode,
  SerializedA11yNode,
  SemanticCompletionPredicate,
} from './types.ts';

export function getDefaultChromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of candidates) {
    if (c) {
      try {
        if (fsSync.existsSync(c)) return c;
      } catch {
        // Continue
      }
    }
  }
  return '/usr/bin/google-chrome';
}

export interface TrialRunOptions {
  policy: BrowserPolicy;
  url: string;
  executablePath?: string;
}

export class BrowserDriver implements ContextDriver {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private userDataDir: string = '';
  private baseOrigin: string = '';
  private virtualTimeActive: boolean = false;
  private tracingDataLoss: boolean = false;
  private traceEvents: Array<{ name: string; cat?: string; ts: number; ph: string; dur?: number }> = [];

  public async launch(options: TrialRunOptions): Promise<void> {
    this.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-exp-profile-'));
    this.baseOrigin = options.url;
    const execPath = options.executablePath || getDefaultChromePath();

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-domain-reliability',
      '--disable-extensions',
      '--disable-features=AudioServiceOutOfProcess',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--no-first-run',
      `--window-size=${options.policy.windowWidth},${options.policy.windowHeight}`,
      `--lang=${options.policy.locale}`,
    ];

    if (options.policy.enableGpu) {
      args.push('--enable-gpu-rasterization', '--ignore-gpu-blocklist');
    }

    this.browser = await puppeteer.launch({
      executablePath: execPath,
      headless: options.policy.headless ? 'shell' : false,
      userDataDir: this.userDataDir,
      args,
    });

    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();

    await this.page.setViewport({
      width: options.policy.windowWidth,
      height: options.policy.windowHeight,
      deviceScaleFactor: options.policy.deviceScaleFactor,
    });

    this.cdp = await this.page.createCDPSession();

    if (options.policy.timezone) {
      await this.cdp.send('Emulation.setTimezoneOverride', { timezoneId: options.policy.timezone });
    }

    if (options.policy.cpuThrottlingRate > 1) {
      await this.cdp.send('Emulation.setCPUThrottlingRate', { rate: options.policy.cpuThrottlingRate });
    }
  }

  public async enableVirtualTime(budgetMs: number = 5000): Promise<void> {
    if (!this.cdp) return;
    this.virtualTimeActive = true;
    await this.cdp.send('Emulation.setVirtualTimePolicy', {
      policy: 'advance',
      budget: budgetMs,
      maxVirtualTimeTicks: 1000,
    });
  }

  public async disableVirtualTime(): Promise<void> {
    if (!this.cdp || !this.virtualTimeActive) return;
    await this.cdp.send('Emulation.setVirtualTimePolicy', {
      policy: 'pause',
    });
    this.virtualTimeActive = false;
  }

  public isVirtualTimeActive(): boolean {
    return this.virtualTimeActive;
  }

  public async startTracing(): Promise<void> {
    if (!this.cdp) return;
    this.traceEvents = [];
    this.tracingDataLoss = false;

    this.cdp.on('Tracing.dataCollected', (data: { value?: Array<{ name: string; cat?: string; ts: number; ph: string; dur?: number }> }) => {
      if (data.value) {
        this.traceEvents.push(...data.value);
      }
    });

    this.cdp.on('Tracing.tracingComplete', (data: { dataLossOccurred?: boolean }) => {
      if (data.dataLossOccurred) {
        this.tracingDataLoss = true;
      }
    });

    await this.cdp.send('Tracing.start', {
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: ['devtools.timeline', 'v8.execute', 'blink.user_timing'],
      },
      transferMode: 'ReportEvents',
    });
  }

  public async stopTracing(): Promise<{
    events: Array<{ name: string; cat?: string; ts: number; ph: string; dur?: number }>;
    dataLossOccurred: boolean;
  }> {
    if (!this.cdp) return { events: [], dataLossOccurred: false };

    const completePromise = new Promise<void>((resolve) => {
      this.cdp?.once('Tracing.tracingComplete', () => resolve());
    });

    await this.cdp.send('Tracing.end');
    await Promise.race([
      completePromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);

    return {
      events: this.traceEvents,
      dataLossOccurred: this.tracingDataLoss,
    };
  }

  public async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    let targetUrl = url;
    if (url.startsWith('/')) {
      if (this.baseOrigin) {
        targetUrl = new URL(url, this.baseOrigin).toString();
      }
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (this.baseOrigin) {
        targetUrl = new URL(url, this.baseOrigin).toString();
      }
    }
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  }

  public async waitForFonts(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.evaluate(() => document.fonts.ready);
  }

  public async waitForSemanticState(stateName: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.waitForFunction(
      (name) => (window as { [key: string]: string | undefined })['__SEMANTIC_STATE__'] === name,
      { timeout: 5000 },
      stateName
    );
  }

  public async focus(selector: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.focus(selector);
  }

  public async typeTrusted(text: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.keyboard.type(text, { delay: 0 });
  }

  public async clickTrusted(selector: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.click(selector);
  }

  public async scrollTrusted(selector: string, deltaY: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.evaluate(
      (sel, dY) => {
        const el = document.querySelector(sel);
        if (el) el.scrollTop += dY;
      },
      selector,
      deltaY
    );
  }

  public async waitForCompletion(completion: SemanticCompletionPredicate): Promise<number> {
    if (!this.page) throw new Error('Page not initialized');
    const selector = completion.selector;
    const expectedText = completion.expectedText;
    const minChildCount = completion.minChildCount;

    await this.page.waitForFunction(
      (sel, text, minChild) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        if (text !== undefined && !el.textContent?.includes(text)) return false;
        if (minChild !== undefined && el.children.length < minChild) return false;
        return true;
      },
      { timeout: 5000 },
      selector,
      expectedText,
      minChildCount
    );

    const nowMs = await this.page.evaluate(() => performance.timeOrigin + performance.now());
    return Math.round(nowMs * 1000);
  }

  public async getMonotonicTimeUs(): Promise<number> {
    if (!this.page) throw new Error('Page not initialized');
    const nowMs = await this.page.evaluate(() => performance.timeOrigin + performance.now());
    return Math.round(nowMs * 1000);
  }

  public async getDOMSnapshot(): Promise<SerializedDOMNode> {
    if (!this.page) throw new Error('Page not initialized');
    return await this.page.evaluate(() => {
      function serialize(node: Node, depth = 0): SerializedDOMNode {
        const el = node as HTMLElement;
        const attrs: Record<string, string> = {};
        if (el.attributes) {
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            attrs[attr.name] = attr.value;
          }
        }
        const children: SerializedDOMNode[] = [];
        if (depth < 15) {
          for (let i = 0; i < node.childNodes.length; i++) {
            const child = node.childNodes[i];
            if (child.nodeType === Node.ELEMENT_NODE) {
              children.push(serialize(child, depth + 1));
            }
          }
        }
        return {
          tagName: el.tagName ? el.tagName.toLowerCase() : 'text',
          id: el.id || undefined,
          className: el.className || undefined,
          attributes: attrs,
          textContent: el.children && el.children.length === 0 ? el.textContent || undefined : undefined,
          children,
        };
      }
      return serialize(document.body);
    });
  }

  public async getAccessibilityTree(): Promise<SerializedA11yNode> {
    if (!this.cdp) throw new Error('CDP not initialized');
    await this.cdp.send('Accessibility.enable');
    const res = await this.cdp.send('Accessibility.getFullAXTree');

    const nodes = res.nodes;
    if (!nodes || nodes.length === 0) {
      return { role: 'WebArea', children: [] };
    }

    const nodeMap = new Map<string, SerializedA11yNode>();
    for (const node of nodes) {
      nodeMap.set(node.nodeId, {
        role: node.role?.value ? String(node.role.value) : 'unknown',
        name: node.name?.value ? String(node.name.value) : undefined,
        value: node.value?.value ? String(node.value.value) : undefined,
        children: [],
      });
    }

    for (const node of nodes) {
      const parentObj = nodeMap.get(node.nodeId);
      if (parentObj && node.childIds) {
        for (const childId of node.childIds) {
          const childObj = nodeMap.get(childId);
          if (childObj) {
            parentObj.children.push(childObj);
          }
        }
      }
    }

    return nodeMap.get(nodes[0].nodeId) || { role: 'WebArea', children: [] };
  }

  public async takeScreenshotBuffer(): Promise<Buffer> {
    if (!this.page) throw new Error('Page not initialized');
    const buffer = await this.page.screenshot({ type: 'png', fullPage: true });
    return Buffer.from(buffer);
  }

  public async close(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch {
      // Ignore
    } finally {
      if (this.userDataDir) {
        await fs.rm(this.userDataDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
