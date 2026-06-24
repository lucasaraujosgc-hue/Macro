import { browserManager } from './playwrightManager';
import { Page } from 'playwright';

let remotePage: Page | null = null;

export async function getRemotePage(): Promise<Page> {
  if (!remotePage || remotePage.isClosed()) {
    const context = await browserManager.obterContexto();
    remotePage = await context.newPage();
  }
  return remotePage;
}

export async function getSelectorAtPoint(page: Page, x: number, y: number) {
  return await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    
    // Simple selector generation
    if (el.id) return `#${el.id}`;
    
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
    
    let selector = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/).filter(c => /^[a-zA-Z_-]+$/.test(c)).slice(0, 2);
      if (classes.length) {
        selector += '.' + classes.join('.');
      }
    }
    
    if (['div', 'span', 'p', 'a', 'button'].includes(selector) && el.textContent) {
       const text = el.textContent.trim().substring(0, 20);
       if (text.length > 3 && !text.includes('"')) {
          return `${selector}:has-text("${text}")`;
       }
    }
    
    return selector;
  }, { x, y });
}

export async function takeRemoteScreenshot(page: Page) {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 60 });
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}
