import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';

class BrowserManager {
  private context: BrowserContext | null = null;
  
  async iniciar() {
     if (!this.context) {
        this.context = await chromium.launchPersistentContext('/tmp/playwright-session', {
           headless: process.env.NODE_ENV === 'production' || process.env.HEADLESS !== 'false',
           args: [
             '--no-sandbox',
             '--disable-setuid-sandbox',
             '--disable-dev-shm-usage',
             '--disable-gpu',
             '--ignore-certificate-errors'
           ],
           acceptDownloads: true,
           viewport: { width: 1280, height: 720 }
        });
     }
  }

  async obterContexto(): Promise<BrowserContext> {
    await this.iniciar();
    return this.context!;
  }

  async reiniciar() {
     if (this.context) {
        await this.context.close();
        this.context = null;
     }
     await this.iniciar();
  }
}

export const browserManager = new BrowserManager();
