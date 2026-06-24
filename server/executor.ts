import { browserManager } from './playwrightManager';
import { SELECTORS } from './selectors';
import { v4 as uuidv4 } from 'uuid';
import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';

// Retries logic
export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  backoff = 1000,
  onRetry?: (e: any, attempt: number) => void
): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (onRetry) onRetry(error, attempt);
      if (attempt >= retries) throw error;
      await new Promise((res) => setTimeout(res, backoff * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error("Unreachable code in retry");
}

export interface ExecutionContext {
  macroId: string;
  status: "running" | "paused" | "completed" | "cancelled" | "failed";
  currentStepIndex: number;
  currentUrl: string;
  logs: string[];
  currentAction?: any;
  _resumeState?: any;
}

let _activeExecution: ExecutionContext | null = null;

export const executionState = {
  get activeExecution() { return _activeExecution; },
  set activeExecution(val: ExecutionContext | null) { _activeExecution = val; }
};

export function logExecution(msg: string) {
  if (executionState.activeExecution) {
    const timestamp = new Date().toISOString();
    executionState.activeExecution.logs.push(`[${timestamp}] ${msg}`);
    console.log(`[Execution Log] ${msg}`);
  }
}

export async function executeMacro(
  macro: any,
  targetCompanies: any[],
  companyIndex: number,
  startIndex: number
) {
  if (!executionState.activeExecution || executionState.activeExecution.status === "cancelled") {
    return;
  }

  if (targetCompanies.length > 0 && companyIndex >= targetCompanies.length) {
    executionState.activeExecution.status = "completed";
    logExecution("✅ Fim da execução para todas as empresas.");
    return;
  }

  const currentCompany = targetCompanies.length > 0 ? targetCompanies[companyIndex] : null;
  if (startIndex === 0 && currentCompany) {
    logExecution(`🏢 Tratando empresa: ${currentCompany.razaoSocial} (${currentCompany.cnpj || ''})`);
  }

  try {
    const context = await browserManager.obterContexto();
    
    // We get the first page or create a new one
    let page = context.pages()[0];
    if (!page) {
      page = await context.newPage();
    }

    // Add Network Inspection
    page.on('request', request => {
      // logExecution(`[Rede] Requisitando: ${request.method()} ${request.url()}`);
    });
    page.on('response', response => {
      // logExecution(`[Rede] Resposta: ${response.status()} ${response.url()}`);
    });

    // Start Trace
    await context.tracing.start({ screenshots: true, snapshots: true });

    // Step Iteration Loop inside Playwright
    for (let i = startIndex; i < macro.steps.length; i++) {
      if ((executionState.activeExecution.status as string) === "cancelled") break;

      const step = macro.steps[i];
      executionState.activeExecution.currentStepIndex = i;
      executionState.activeExecution.currentAction = step;
      const value = interpolateValue(step.value, currentCompany) || "";

      logExecution(`Executando passo ${i}: ${step.type} - ${step.selector || step.value || ''}`);

      await retry(async () => {
        if (step.type === "navigate") {
          executionState.activeExecution!.currentUrl = step.value;
          await page.goto(step.value, { waitUntil: 'load' });
          
        } else if (step.type === "click") {
          // Playwright's auto-waiting robust selectors
          await page.locator(step.selector).click();
          
        } else if (step.type === "type") {
          await page.locator(step.selector).fill(value);
          
        } else if (step.type === "captcha_wait") {
          logExecution(`⏳ Aguardando solução de Captcha manual...`);
          executionState.activeExecution!.status = "paused";
          executionState.activeExecution!._resumeState = { macro, targetCompanies, companyIndex, nextStepIndex: i + 1 };
          throw new Error("CAPTCHA_PAUSE"); // Break retry loop
          
        } else if (step.type === "download_wait") {
          logExecution(`⏳ Aguardando download...`);
          const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
          if (step.selector) {
            await page.locator(step.selector).click();
          }
          const download = await downloadPromise;
          
          if (!fs.existsSync(path.join(process.cwd(), 'downloads'))) {
            fs.mkdirSync(path.join(process.cwd(), 'downloads'));
          }

          const downloadPath = path.join(process.cwd(), 'downloads', download.suggestedFilename());
          await download.saveAs(downloadPath);
          logExecution(`📥 Download salvo em: ${downloadPath}`);
        } else {
          logExecution(`Passo não reconhecido: ${step.type}`);
        }
      }, 3, 1000, (err, attempt) => {
         if (err.message === "CAPTCHA_PAUSE") throw err; // Don't retry captcha
         logExecution(`⚠️ Falha na etapa ${i} (tentativa ${attempt}): ${err.message}`);
      });

      // Avoid racing the event loop too hard
      await page.waitForTimeout(500); 
    }

    await context.tracing.stop({ path: `trace-${Date.now()}.zip` });

    if (executionState.activeExecution.status === "running") {
      // Move to next company
      if (targetCompanies.length > 0 && companyIndex + 1 < targetCompanies.length) {
        // Wait a bit before next company
        await new Promise(res => setTimeout(res, 2000));
        executeMacro(macro, targetCompanies, companyIndex + 1, 0);
      } else {
        executionState.activeExecution.status = "completed";
        logExecution("✅ Fim da execução.");
      }
    }

  } catch (err: any) {
    if (err.message === "CAPTCHA_PAUSE") {
       // Just pause execution, it will be resumed by /api/execution/resolve-captcha
       return;
    }

    logExecution(`❌ Falha crítica: ${err.message}`);
    executionState.activeExecution.status = "failed";
    const context = await browserManager.obterContexto();
    await context.tracing.stop({ path: `trace-error-${Date.now()}.zip` });
  }
}

function interpolateValue(value: string | undefined, company: any | null): string {
  if (!value || !company) return value || "";
  return value
    .replace(/\{\{CNPJ\}\}/g, company.cnpj || "")
    .replace(/\{\{RAZAO_SOCIAL\}\}/g, company.razaoSocial || "")
    .replace(/\{\{FANTASIA\}\}/g, company.nomeFantasia || "")
    .replace(/\{\{EMAIL\}\}/g, company.email || "")
    .replace(/\{\{TELEFONE\}\}/g, company.telefone || "")
    .replace(/\{\{IE\}\}/g, company.inscricaoEstadual || "")
    .replace(/\{\{IM\}\}/g, company.inscricaoMunicipal || "");
}
