process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { db, initDB } from "./server/db";
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
// @ts-ignore
import forge from "node-forge";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

// Helper para iniciar o Playwright
async function getPage() {
  if (!browser) {
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
    } catch (err: any) {
      console.error("Erro ao iniciar Playwright:", err.message);
      throw new Error("Falha ao iniciar navegador: " + err.message);
    }
  }
  
  if (!context && browser) {
    const certificates = await db.getCertificates();
    const clientCertificates: any[] = [];
    
    for (const cert of certificates) {
      if (!cert.pfxBase64 || !cert.passwordEncrypted) continue;
      try {
        const pfxBuffer = Buffer.from(cert.pfxBase64, 'base64');
        const passphrase = Buffer.from(cert.passwordEncrypted, 'base64').toString('utf8');
        
        // Add to known ICP-Brasil endpoints
        clientCertificates.push({
          origin: 'https://certificado.sso.acesso.gov.br',
          pfx: pfxBuffer,
          passphrase
        });
        clientCertificates.push({
          origin: 'https://sso.acesso.gov.br',
          pfx: pfxBuffer,
          passphrase
        });
        clientCertificates.push({
          origin: 'https://cav.receita.fazenda.gov.br',
          pfx: pfxBuffer,
          passphrase
        });
      } catch (e) {
      }
    }

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      clientCertificates,
      ignoreHTTPSErrors: true,
    });
  }

  if (!page && context) {
    page = await context.newPage();
  }
  return page;
}

app.post('/api/browser/goto', async (req, res) => {
  try {
    const { url } = req.body;
    const p = await getPage();
    if (!p) throw new Error("Página não encontrada");
    await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    const screenshotBuffer = await p.screenshot({ type: 'jpeg', quality: 70 });
    const screenshot = screenshotBuffer.toString('base64');
    const currentUrl = p.url();
    const title = await p.title();
    res.json({ screenshot: `data:image/jpeg;base64,${screenshot}`, url: currentUrl, title });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/browser/click', async (req, res) => {
  try {
    const { x, y } = req.body;
    const p = await getPage();
    if (!p) throw new Error("Página não encontrada");
    await p.mouse.click(x, y);
    await new Promise(r => setTimeout(r, 400));
    const screenshotBuffer = await p.screenshot({ type: 'jpeg', quality: 70 });
    const screenshot = screenshotBuffer.toString('base64');
    const currentUrl = p.url();
    const title = await p.title();
    res.json({ screenshot: `data:image/jpeg;base64,${screenshot}`, url: currentUrl, title });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/browser/type', async (req, res) => {
  try {
    const { text, key } = req.body;
    const p = await getPage();
    if (!p) throw new Error("Página não encontrada");
    if (text) {
      await p.keyboard.type(text);
    }
    if (key) {
      await p.keyboard.press(key);
    }
    
    await new Promise(r => setTimeout(r, 200));
    const screenshotBuffer = await p.screenshot({ type: 'jpeg', quality: 70 });
    const screenshot = screenshotBuffer.toString('base64');
    res.json({ screenshot: `data:image/jpeg;base64,${screenshot}`, url: p.url() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/browser/scroll', async (req, res) => {
  try {
    const { deltaY } = req.body;
    const p = await getPage();
    if (!p) throw new Error("Página não encontrada");
    await p.evaluate((y) => window.scrollBy(0, y), deltaY);
    await new Promise(r => setTimeout(r, 150));
    const screenshotBuffer = await p.screenshot({ type: 'jpeg', quality: 70 });
    const screenshot = screenshotBuffer.toString('base64');
    res.json({ screenshot: `data:image/jpeg;base64,${screenshot}`, url: p.url() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/browser/close', async (req, res) => {
  if (context) {
    await context.close();
    context = null;
    page = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
  res.json({ success: true });
});

const upload = multer({ storage: multer.memoryStorage() });

// --- API ROUTES ---

// Companies
app.get("/api/companies", async (req, res) => {
  res.json(await db.getCompanies());
});

app.post("/api/companies", async (req, res) => {
  const company = { ...req.body, id: uuidv4() };
  await db.addCompany(company);
  res.json(company);
});

app.put("/api/companies/:id", async (req, res) => {
  await db.updateCompany(req.params.id, req.body);
  res.json({ success: true });
});

app.delete("/api/companies/:id", async (req, res) => {
  await db.deleteCompany(req.params.id);
  res.json({ success: true });
});

// Macros
app.get("/api/macros", async (req, res) => {
  res.json(await db.getMacros());
});

app.post("/api/macros", async (req, res) => {
  const macro = { ...req.body, id: uuidv4() };
  if (!macro.steps) macro.steps = [];
  await db.addMacro(macro);
  res.json(macro);
});

app.put("/api/macros/:id", async (req, res) => {
  await db.updateMacro(req.params.id, req.body);
  res.json({ success: true });
});

app.delete("/api/macros/:id", async (req, res) => {
  await db.deleteMacro(req.params.id);
  res.json({ success: true });
});

// Files
app.get("/api/files", async (req, res) => {
  res.json(await db.getFiles());
});

app.post("/api/files", async (req, res) => {
  const file = {
    ...req.body,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  await db.addFile(file);
  res.json(file);
});

// Certificates
app.get("/api/certificates", async (req, res) => {
  res.json(await db.getCertificates());
});

app.post("/api/certificates/upload", upload.single("pfx"), async (req, res) => {
  try {
    const file = req.file;
    const password = req.body.password;

    if (!file) return res.status(400).json({ error: "No file uploaded" });
    if (!password)
      return res.status(400).json({ error: "Password is required" });

    // Parse PFX
    const p12Asn1 = forge.asn1.fromDer(file.buffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    let validFrom = new Date();
    let validTo = new Date();
    let titular = "Unknown";
    let serial = "Unknown";
    let issuer = "Unknown";
    let cpfCnpj = "N/A";

    const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = bags[forge.pki.oids.certBag]?.[0];

    if (certBag && certBag.cert) {
      const cert = certBag.cert;
      validFrom = cert.validity.notBefore;
      validTo = cert.validity.notAfter;
      serial = cert.serialNumber;

      const subject = cert.subject.attributes.reduce((acc: Record<string, string>, attr: any) => {
        acc[attr.shortName || attr.name] = attr.value;
        return acc;
      }, {});

      const issuerAttr = cert.issuer.attributes.reduce(
        (acc: Record<string, string>, attr: any) => {
          acc[attr.shortName || attr.name] = attr.value;
          return acc;
        },
        {}
      );

      titular = subject["CN"] || "Unknown";
      issuer = issuerAttr["CN"] || issuerAttr["O"] || "Unknown";

      // Extract CPF/CNPJ from BR certificate CN (format: "NAME:CPF_OR_CNPJ")
      if (titular.includes(":")) {
        const parts = titular.split(":");
        const raw = parts[parts.length - 1].replace(/\D/g, "");
        cpfCnpj = raw;
      }
    }

    const type = cpfCnpj.replace(/\D/g, "").length > 11 ? "PJ" : "PF";

    const certificate = {
      id: uuidv4(),
      name: titular, // Use titular as name for the existing UI
      filename: file.originalname,
      pfxBase64: file.buffer.toString("base64"),
      passwordEncrypted: Buffer.from(password).toString("base64"),
      titular,
      cpfCnpj,
      serial,
      issuer,
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      type: type as "PF" | "PJ",
      valid: true,
      uploadedAt: new Date().toISOString()
    };

    await db.addCertificate(certificate);

    // Fechar o contexto atual para que no próximo getPage ele recarregue com o novo certificado
    if (context) {
      await context.close();
      context = null;
      page = null;
    }

    res.json({ success: true, message: 'Certificado e senha válidos!', certificate });
  } catch (error: any) {
    console.error("[Certificate Upload Error]", error);
    res
      .status(500)
      .json({
        error: "Certificado inválido ou senha incorreta. " + error.message,
      });
  }
});

app.delete("/api/certificates/:id", async (req, res) => {
  await db.deleteCertificate(req.params.id);
  res.json({ success: true });
});

// Helper execution endpoints
let activeExecution: {
  macroId: string;
  status: "running" | "paused" | "completed" | "error";
  currentStepIndex: number;
  screenshot?: string;
  currentUrl?: string;
  logs: string[];
  _resumeState?: any;
  currentAction?: { type: string; selector?: string; value?: string };
} | null = null;

app.post("/api/execute/:macroId", async (req, res) => {
  const macroId = req.params.macroId;
  const companyIds = req.body.companyIds || [];
  const macro = await db.getMacro(macroId);
  if (!macro) return res.status(404).json({ error: "Macro not found" });

  const companies = await db.getCompanies();
  const targetCompanies = companies.filter((c) => companyIds.includes(c.id));
  const companyNames = targetCompanies.map((c) => c.razaoSocial).join(", ");

  activeExecution = {
    macroId,
    status: "running",
    currentStepIndex: 0,
    currentUrl: "about:blank",
    logs: [
      `Started macro ${macro.name}`,
      `Empresas selecionadas (${targetCompanies.length}): ${companyNames}`,
    ],
  };

  simulateExecution(macro, targetCompanies, 0, 0);

  res.json({ success: true, execution: activeExecution });
});

app.get("/api/execution", (req, res) => {
  res.json(activeExecution);
});

app.post("/api/execution/resolve-captcha", async (req, res) => {
  if (activeExecution && activeExecution.status === "paused") {
    activeExecution.logs.push(`Captcha resolved with: ${req.body.text}`);
    activeExecution.status = "running";

    if (activeExecution._resumeState) {
      const { macro, targetCompanies, companyIndex, nextStepIndex } =
        activeExecution._resumeState;
      simulateExecution(
        macro,
        targetCompanies,
        companyIndex,
        nextStepIndex + 1,
      );
    } else {
      const macro = await db.getMacro(activeExecution.macroId);
      if (macro) {
        simulateExecution(macro, [], 0, activeExecution.currentStepIndex + 1);
      }
    }
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "No paused execution" });
  }
});

function simulateExecution(
  macro: any,
  targetCompanies: any[],
  companyIndex = 0,
  startIndex = 0,
) {
  if (targetCompanies.length > 0 && companyIndex >= targetCompanies.length) {
    if (activeExecution) {
      activeExecution.status = "completed";
      activeExecution.logs.push("✅ Fim da execução para todas as empresas.");
    }
    return;
  }

  const currentCompany =
    targetCompanies.length > 0 ? targetCompanies[companyIndex] : null;
  if (startIndex === 0 && activeExecution && currentCompany) {
    activeExecution.logs.push(
      `\n▶️ Iniciando para: ${currentCompany.razaoSocial} (${currentCompany.cnpj})`,
    );
  }

  let i = startIndex;

  function next() {
    if (!activeExecution) return;
    if (i >= macro.steps.length) {
      activeExecution.logs.push(`✓ Macro finalizada para a empresa atual.`);

      // Simulação de download interceptado via CDP
      if (currentCompany) {
        const fakeFile = {
          id: uuidv4(),
          filename: `comprovante_${currentCompany.cnpj ? currentCompany.cnpj.replace(/\D/g, "") : Math.random().toString().slice(2, 8)}.pdf`,
          size: Math.floor(Math.random() * 500000) + 50000,
          createdAt: new Date().toISOString(),
          companyId: currentCompany.id,
          macroId: macro.id,
        };
        db.addFile(fakeFile).catch((e) => console.error(e));
        activeExecution.logs.push(
          `📥 Download Concluído: O arquivo ${fakeFile.filename} foi salvo na galeria.`,
        );
      }

      simulateExecution(macro, targetCompanies, companyIndex + 1, 0);
      return;
    }

    const step = macro.steps[i];
    activeExecution.currentStepIndex = i;

    let evaluatedValue = step.value;
    if (evaluatedValue && currentCompany) {
      evaluatedValue = evaluatedValue
        .replace(/\{\{CNPJ\}\}/g, currentCompany.cnpj || "")
        .replace(/\{\{RAZAO_SOCIAL\}\}/g, currentCompany.razaoSocial || "")
        .replace(/\{\{FANTASIA\}\}/g, currentCompany.nomeFantasia || "")
        .replace(/\{\{EMAIL\}\}/g, currentCompany.email || "")
        .replace(/\{\{TELEFONE\}\}/g, currentCompany.telefone || "")
        .replace(/\{\{IE\}\}/g, currentCompany.inscricaoEstadual || "")
        .replace(/\{\{IM\}\}/g, currentCompany.inscricaoMunicipal || "");
    }

    activeExecution.logs.push(
      `Executing step ${i + 1}: ${step.type} - ${step.selector || ""} ${evaluatedValue ? `(Value: ${evaluatedValue})` : ""}`,
    );

    activeExecution.currentAction = {
      type: step.type,
      selector: step.selector,
      value: evaluatedValue,
    };

    if (step.type === "navigate" && evaluatedValue) {
      activeExecution.currentUrl = evaluatedValue;
    }

    if (step.type === "captcha_wait") {
      activeExecution.status = "paused";
      activeExecution.logs.push(
        "Paused. Waiting for manual captcha resolution.",
      );
      // We would set a screenshot here for real.
      activeExecution.screenshot =
        "https://via.placeholder.com/600x200?text=Simulated+Captcha+Screenshot";
      activeExecution._resumeState = {
        macro,
        targetCompanies,
        companyIndex,
        nextStepIndex: i,
      };
      return; // Wait for user to call resolve-captcha
    }

    let waitTimeMs = 1500;
    if (step.type === "wait" && step.waitTime)
      waitTimeMs = step.waitTime * 1000;

    i++;
    setTimeout(next, waitTimeMs);
  }

  next();
}

// --- FRONTEND ROUTES ---
async function startServer() {
  await initDB();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
