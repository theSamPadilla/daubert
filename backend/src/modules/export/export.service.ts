import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { accessSync } from 'fs';
import { PDFDocument } from 'pdf-lib';
import puppeteer, { Browser } from 'puppeteer-core';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HTMLtoDOCX: (html: string, header?: string | null, options?: Record<string, unknown>) => Promise<Buffer | ArrayBuffer> = require('html-to-docx');

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
        '--user-data-dir=/tmp/chrome-user-data',
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

  async htmlToPng(html: string, opts?: { width?: number; timeout?: number }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const timeout = opts?.timeout ?? 30_000;
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().startsWith('data:')) req.continue();
        else req.abort();
      });
      await page.setViewport({ width: opts?.width ?? 1200, height: 800 });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout });
      // Wait for web fonts to finish loading; otherwise the screenshot can
      // race the font swap and capture fallback metrics. (PDF tolerates this
      // better than a raster screenshot does.)
      await page.evaluate(() => (document as any).fonts?.ready ?? Promise.resolve());
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      return Buffer.from(png);
    } finally {
      await page.close();
    }
  }

  /**
   * Embed a PNG data URL into a single-page A4-landscape PDF, image centered
   * and scaled to fit (object-fit: contain). Pure pdf-lib, no Chrome — bounded
   * memory regardless of PNG size, and the image can't break across pages.
   */
  async pngToPdf(imageDataUrl: string): Promise<Buffer> {
    const base64 = imageDataUrl.replace(/^data:image\/png;base64,/, '');
    const pngBytes = Buffer.from(base64, 'base64');

    const pdfDoc = await PDFDocument.create();
    const png = await pdfDoc.embedPng(pngBytes);

    // A4 landscape in PDF points (1 pt = 1/72 inch). 28 pt ≈ 10mm margin.
    const PAGE_W = 842;
    const PAGE_H = 595;
    const MARGIN = 28;
    const maxW = PAGE_W - MARGIN * 2;
    const maxH = PAGE_H - MARGIN * 2;

    const scale = Math.min(maxW / png.width, maxH / png.height);
    const drawW = png.width * scale;
    const drawH = png.height * scale;
    const x = (PAGE_W - drawW) / 2;
    const y = (PAGE_H - drawH) / 2;

    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    page.drawImage(png, { x, y, width: drawW, height: drawH });

    return Buffer.from(await pdfDoc.save());
  }

  async htmlToDocx(html: string): Promise<Buffer> {
    const result = await HTMLtoDOCX(html, undefined, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    });
    return Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBuffer);
  }
}
