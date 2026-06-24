import fs from 'fs';
import path from 'path';

export async function runDiagnostics() {
  console.log("=== INICIANDO DIAGNÓSTICO DE SISTEMA (VPS LINUX) ===");
  
  // 1. Verificar permissões e diretórios
  const dirs = ['downloads', 'assets'];
  for (const d of dirs) {
    const dirPath = path.join(process.cwd(), d);
    if (!fs.existsSync(dirPath)) {
      console.log(`[AVISO] Diretório '${d}' ausente. Criando...`);
      fs.mkdirSync(dirPath, { recursive: true });
    }
    try {
      fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
      console.log(`[OK] Permissões de leitura/escrita no diretório '${d}'.`);
    } catch (e) {
      console.error(`[ERRO] Sem permissão no diretório '${d}'. Execução em VPS pode falhar.`);
    }
  }

  // 2. Dependências / Chromium
  try {
    const { chromium } = require('playwright');
    console.log(`[OK] Playwright está instalado.`);
    // Apenas verificando o caminho do executável do Playwright
    const executablePath = chromium.executablePath();
    console.log(`[OK] Chromium path: ${executablePath}`);
  } catch (e) {
    console.error(`[ERRO] Playwright Chromium não encontrado. Execute 'npx playwright install chromium'.`);
  }

  console.log("=== DIAGNÓSTICO CONCLUÍDO ===");
}
