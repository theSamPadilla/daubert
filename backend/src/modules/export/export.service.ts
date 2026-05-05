import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { accessSync } from 'fs';
import puppeteer, { Browser } from 'puppeteer-core';

const DEV_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

@Injectable()
export class ExportService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = this.launchBrowser();
      // Reset on unexpected disconnect so next call re-launches
      this.browserPromise.then((b) => {
        b.on('disconnected', () => {
          this.browserPromise = null;
        });
      });
    }
    return this.browserPromise;
  }

  private resolveExecutablePath(): string {
    if (process.env.NODE_ENV === 'production') {
      return '/usr/bin/chromium';
    }
    const found = DEV_CHROME_CANDIDATES.find((p) => {
      try {
        accessSync(p);
        return true;
      } catch {
        return false;
      }
    });
    if (!found) {
      throw new Error(
        `No Chrome/Chromium executable found. Tried: ${DEV_CHROME_CANDIDATES.join(', ')}`,
      );
    }
    return found;
  }

  private async launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
      headless: true,
      executablePath: this.resolveExecutablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });
  }

  async onModuleDestroy() {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      this.browserPromise = null;
      await browser.close();
    }
  }

  async htmlToPdf(
    html: string,
    options?: { landscape?: boolean; timeout?: number },
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const timeout = options?.timeout ?? 30_000;

    try {
      // Defense in depth: disable JS and block network
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().startsWith('data:')) {
          req.continue();
        } else {
          req.abort();
        }
      });

      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout });
      const pdf = await page.pdf({
        format: 'A4',
        landscape: options?.landscape ?? false,
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        timeout,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
