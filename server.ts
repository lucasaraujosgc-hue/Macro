process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { db, initDB } from "./server/db";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import forge from "node-forge";
import { CookieJar } from "tough-cookie";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// ── Shared error responder ────────────────────────────────────────────────────
function sendError(res: express.Response, e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : String(e);
  res.status(status).json({ error: message });
}

const stealthHeaders: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Ch-Ua":
    '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ─── Per-execution cookie jar (persists session across proxy requests) ──────────
// Keyed by executionId so multiple concurrent sessions don't share cookies.
// For single-user use, we keep one global "recording" jar for the simulator.
const sessionJars: Map<string, CookieJar> = new Map();
const RECORDING_SESSION = "recording";

function getJar(sessionId: string): CookieJar {
  if (!sessionJars.has(sessionId)) sessionJars.set(sessionId, new CookieJar());
  return sessionJars.get(sessionId)!;
}

async function cookiesToHeader(jar: CookieJar, url: string): Promise<string> {
  try { return await jar.getCookieString(url); } catch { return ""; }
}

async function storeCookies(jar: CookieJar, response: Response, targetUrl: string) {
  const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookieHeaders) {
    try { await jar.setCookie(cookie, targetUrl); } catch { /* ignore invalid */ }
  }
}

// ─── In-memory capture store for real PDFs downloaded through the proxy ────────
interface CapturedFile {
  id: string;
  filename: string;
  mimeType: string;
  data: Buffer;         // raw bytes — served via /api/captured/:id
  capturedAt: string;
  sessionId: string;
  companyId?: string;
  macroId?: string;
}
const capturedFiles: Map<string, CapturedFile> = new Map();

// Serve captured file bytes to the browser for real download / gallery save
app.get("/api/captured/:id", (req, res) => {
  const cf = capturedFiles.get(req.params.id);
  if (!cf) return res.status(404).json({ error: "Arquivo não encontrado" });
  res.setHeader("Content-Type", cf.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${cf.filename}"`);
  res.setHeader("Content-Length", cf.data.byteLength);
  res.send(cf.data);
});

// Accept base64 blob PDF from client-side interception
app.post("/api/captured-blob", async (req, res) => {
  try {
    const { dataUrl, mimeType = "application/pdf", filename = "download.pdf" } = req.body;
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return res.status(400).json({ error: "Invalid dataUrl" });
    }
    const base64 = dataUrl.split(",")[1];
    const data = Buffer.from(base64, "base64");

    const captured: CapturedFile = {
      id: uuidv4(),
      filename,
      mimeType,
      data,
      capturedAt: new Date().toISOString(),
      sessionId: RECORDING_SESSION,
    };
    capturedFiles.set(captured.id, captured);
    console.log(`[Blob Capture] ${filename} (${data.byteLength} bytes)`);
    res.json({ id: captured.id, filename, size: data.byteLength, url: `/api/captured/${captured.id}` });
  } catch (e) { sendError(res, e); }
});

// List captured files for a session
app.get("/api/captured", (req, res) => {
  const sessionId = (req.query.session as string) || RECORDING_SESSION;
  const files = [...capturedFiles.values()]
    .filter(f => f.sessionId === sessionId)
    .map(({ data: _data, ...meta }) => meta); // strip binary from list
  res.json(files);
});

// ─── ASSET PROXY MIDDLEWARE ────────────────────────────────────────────────────
// Catches assets that escaped the proxy prefix (e.g. absolute paths like /fonts/font.woff loaded from CSS)
app.use(async (req, res, next) => {
  if (
    req.originalUrl.startsWith("/api/") ||
    req.originalUrl.startsWith("/@") ||
    req.originalUrl.startsWith("/node_modules/")
  ) {
    return next();
  }

  const referer = req.headers.referer;
  if (referer && referer.includes("/api/proxy/raw/")) {
    try {
      const match = referer.match(/\/api\/proxy\/raw\/(.+)/);
      if (match && match[1]) {
        const targetBase = decodeURIComponent(match[1]);
        const targetUrl = new URL(req.originalUrl, targetBase).href;

        console.log(
          `[Proxy Recovery] Proxying escaped asset ${req.originalUrl} to ${targetUrl}`,
        );

        const response = await fetch(targetUrl, {
          headers: { ...stealthHeaders },
        });

        if (response.ok) {
          const contentType = response.headers.get("content-type") || "";
          res.setHeader("Content-Type", contentType);
          res.setHeader("Access-Control-Allow-Origin", "*");
          const buffer = await response.arrayBuffer();
          return res.send(Buffer.from(buffer));
        }
      }
    } catch (e) {
      console.error("[Proxy Recovery Error]", req.originalUrl, e);
    }
  }
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

// --- API ROUTES ---

// Companies
app.get("/api/companies", async (_req, res) => {
  try {
    res.json(await db.getCompanies());
  } catch (e) { sendError(res, e); }
});

app.post("/api/companies", async (req, res) => {
  try {
    if (!req.body.razaoSocial?.trim()) {
      return res.status(400).json({ error: "Razão social é obrigatória." });
    }
    const company = { ...req.body, id: uuidv4() };
    await db.addCompany(company);
    res.json(company);
  } catch (e) { sendError(res, e); }
});

app.put("/api/companies/:id", async (req, res) => {
  try {
    await db.updateCompany(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) { sendError(res, e); }
});

app.delete("/api/companies/:id", async (req, res) => {
  try {
    await db.deleteCompany(req.params.id);
    res.json({ success: true });
  } catch (e) { sendError(res, e); }
});

// Macros
app.get("/api/macros", async (_req, res) => {
  try {
    res.json(await db.getMacros());
  } catch (e) { sendError(res, e); }
});

app.post("/api/macros", async (req, res) => {
  try {
    if (!req.body.name?.trim()) {
      return res.status(400).json({ error: "O nome da macro é obrigatório." });
    }
    const macro = { ...req.body, id: uuidv4() };
    if (!macro.steps) macro.steps = [];
    await db.addMacro(macro);
    res.json(macro);
  } catch (e) { sendError(res, e); }
});

app.put("/api/macros/:id", async (req, res) => {
  try {
    await db.updateMacro(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) { sendError(res, e); }
});

app.delete("/api/macros/:id", async (req, res) => {
  try {
    await db.deleteMacro(req.params.id);
    res.json({ success: true });
  } catch (e) { sendError(res, e); }
});

// Files
app.get("/api/files", async (_req, res) => {
  try {
    res.json(await db.getFiles());
  } catch (e) { sendError(res, e); }
});

app.post("/api/files", async (req, res) => {
  try {
    const file = {
      ...req.body,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await db.addFile(file);
    res.json(file);
  } catch (e) { sendError(res, e); }
});

// Certificates
app.get("/api/certificates", async (_req, res) => {
  try {
    res.json(await db.getCertificates());
  } catch (e) { sendError(res, e); }
});

app.post("/api/certificates/upload", upload.single("pfx"), async (req, res) => {
  try {
    const file = req.file;
    const password = req.body.password;

    if (!file) return res.status(400).json({ error: "No file uploaded" });
    if (!password) return res.status(400).json({ error: "Password is required" });

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
        {},
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

    // CPF = 11 digits, CNPJ = 14 digits
    const type = cpfCnpj.replace(/\D/g, "").length > 11 ? "PJ" : "PF";

    // Store password as base64 — NOTE: production should use proper encryption (AES-256-GCM etc.)
    const certificate = {
      id: uuidv4(),
      filename: file.originalname,
      passwordEncrypted: Buffer.from(password).toString("base64"),
      titular,
      cpfCnpj,
      serial,
      issuer,
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      type: type as "PF" | "PJ",
    };

    await db.addCertificate(certificate);
    res.json(certificate);
  } catch (error: any) {
    console.error("[Certificate Upload Error]", error);
    res.status(500).json({
      error: "Certificado inválido ou senha incorreta. " + error.message,
    });
  }
});

app.delete("/api/certificates/:id", async (req, res) => {
  try {
    await db.deleteCertificate(req.params.id);
    res.json({ success: true });
  } catch (e) { sendError(res, e); }
});

// --- EXECUTION ENGINE ---

type ExecutionStatus = "running" | "paused" | "completed" | "error" | "cancelled";

interface ActiveExecution {
  macroId: string;
  status: ExecutionStatus;
  currentStepIndex: number;
  screenshot?: string;
  currentUrl?: string;
  logs: string[];
  _resumeState?: {
    macro: any;
    targetCompanies: any[];
    companyIndex: number;
    nextStepIndex: number;
  };
  currentAction?: { type: string; selector?: string; value?: string };
}

let activeExecution: ActiveExecution | null = null;

// Mutex to prevent concurrent execution state mutations
let executionLock = false;

function acquireLock(): boolean {
  if (executionLock) return false;
  executionLock = true;
  return true;
}

function releaseLock() {
  executionLock = false;
}

app.post("/api/execute/:macroId", async (req, res) => {
  // Prevent starting a new execution while one is already running
  if (activeExecution && activeExecution.status === "running") {
    return res.status(409).json({ error: "Já existe uma execução em andamento. Cancele-a primeiro." });
  }

  const macroId = req.params.macroId;
  const companyIds: string[] = req.body.companyIds || [];
  const macro = await db.getMacro(macroId);
  if (!macro) return res.status(404).json({ error: "Macro não encontrada" });

  const companies = await db.getCompanies();
  const targetCompanies = companies.filter((c) => companyIds.includes(c.id));
  const companyNames = targetCompanies.map((c) => c.razaoSocial).join(", ");

  activeExecution = {
    macroId,
    status: "running",
    currentStepIndex: 0,
    currentUrl: "about:blank",
    logs: [
      `▶️ Iniciando macro: ${macro.name}`,
      `Empresas selecionadas (${targetCompanies.length}): ${companyNames || "(nenhuma)"}`,
    ],
  };

  // Start execution async — don't await so request returns immediately
  simulateExecution(macro, targetCompanies, 0, 0);

  res.json({ success: true, execution: activeExecution });
});

app.get("/api/execution", (_req, res) => {
  res.json(activeExecution);
});

// Called by the frontend when proxy_download_captured fires during an execution
app.post("/api/execution/capture-file", async (req, res) => {
  const { capturedId } = req.body;
  const cf = capturedFiles.get(capturedId);
  if (!cf) return res.status(404).json({ error: "Captured file not found" });

  if (activeExecution) {
    const currentCompanies = activeExecution._resumeState?.targetCompanies;
    const companyIndex = activeExecution._resumeState?.companyIndex;
    const company = currentCompanies?.[companyIndex ?? 0];
    cf.companyId = company?.id;
    cf.macroId = activeExecution.macroId;

    // Persist to DB gallery
    await db.addFile({
      id: cf.id,
      filename: cf.filename,
      size: cf.data.byteLength,
      createdAt: cf.capturedAt,
      companyId: cf.companyId,
      macroId: cf.macroId,
      downloadUrl: `/api/captured/${cf.id}`,
    }).catch((e: Error) => console.error("[File Save Error]", e));

    activeExecution.logs.push(`📥 PDF capturado: ${cf.filename} (${Math.round(cf.data.byteLength / 1024)} KB)`);
  }

  res.json({ success: true, filename: cf.filename });
});

app.post("/api/execution/cancel", (_req, res) => {
  if (!activeExecution) return res.status(400).json({ error: "Nenhuma execução ativa" });
  activeExecution.status = "cancelled";
  activeExecution._resumeState = undefined;
  activeExecution.logs.push("🛑 Execução cancelada pelo usuário.");
  releaseLock();
  res.json({ success: true });
});

app.post("/api/execution/resolve-captcha", async (req, res) => {
  if (!activeExecution || activeExecution.status !== "paused") {
    return res.status(400).json({ error: "Nenhuma execução pausada" });
  }

  const captchaText = req.body.text || "(sem texto)";
  activeExecution.logs.push(`✅ Captcha resolvido: ${captchaText}`);
  activeExecution.status = "running";

  if (activeExecution._resumeState) {
    const { macro, targetCompanies, companyIndex, nextStepIndex } =
      activeExecution._resumeState;
    activeExecution._resumeState = undefined;
    // Resume from the step AFTER the captcha_wait (nextStepIndex + 1 was already the next step)
    simulateExecution(macro, targetCompanies, companyIndex, nextStepIndex);
  } else {
    const macro = await db.getMacro(activeExecution.macroId);
    if (macro) {
      const nextStep = activeExecution.currentStepIndex + 1;
      simulateExecution(macro, [], 0, nextStep);
    }
  }

  res.json({ success: true });
});

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

function simulateExecution(
  macro: any,
  targetCompanies: any[],
  companyIndex: number,
  startIndex: number,
) {
  if (!activeExecution || activeExecution.status === "cancelled") {
    releaseLock();
    return;
  }

  if (targetCompanies.length > 0 && companyIndex >= targetCompanies.length) {
    activeExecution.status = "completed";
    activeExecution.logs.push("✅ Fim da execução para todas as empresas.");
    releaseLock();
    return;
  }

  const currentCompany = targetCompanies.length > 0 ? targetCompanies[companyIndex] : null;
  if (startIndex === 0 && currentCompany) {
    activeExecution.logs.push(`🏢 Tratando empresa: ${currentCompany.razaoSocial} (${currentCompany.cnpj || ''})`);
  }

  const step = macro.steps[startIndex];
  if (!step) {
    if (targetCompanies.length > 0 && companyIndex + 1 < targetCompanies.length) {
      setTimeout(() => simulateExecution(macro, targetCompanies, companyIndex + 1, 0), 1000);
    } else {
      activeExecution.status = "completed";
      activeExecution.logs.push("✅ Fim da execução.");
      releaseLock();
    }
    return;
  }

  activeExecution.currentStepIndex = startIndex;
  activeExecution.currentAction = step;
  const value = interpolateValue(step.value, currentCompany) || "";

  if (step.type === "navigate") {
    activeExecution.logs.push(`🌐 Navegando para ${step.value}`);
    activeExecution.currentUrl = step.value;
  } else if (step.type === "click") {
    activeExecution.logs.push(`🖱️ Clicando em ${step.selector}`);
  } else if (step.type === "type") {
    activeExecution.logs.push(`⌨️ Digitando em ${step.selector}: ${value}`);
  } else if (step.type === "captcha_wait") {
    activeExecution.logs.push(`⏳ Aguardando solução de Captcha manual...`);
    activeExecution.status = "paused";
    activeExecution._resumeState = { macro, targetCompanies, companyIndex, nextStepIndex: startIndex + 1 };
    releaseLock();
    return;
  } else if (step.type === "download_wait") {
    activeExecution.logs.push(`⏳ Aguardando download...`);
  } else {
    activeExecution.logs.push(`⏳ Executando ${step.type}`);
  }

  setTimeout(() => {
    if (activeExecution?.status === "running") {
      simulateExecution(macro, targetCompanies, companyIndex, startIndex + 1);
    }
  }, 1500);
}

const rewriteCookies = (response, res) => {
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const cookie of setCookie) {
    res.append("Set-Cookie", cookie);
  }
};

app.all("/api/proxy/raw/*", async (req, res) => {
  try {
    const targetUrl = req.originalUrl.replace("/api/proxy/raw/", "");
    if (!targetUrl.startsWith("http")) return res.status(400).json({error: "Invalid URL"});
    
    const sessionId = (req.query.session as string) || RECORDING_SESSION;
    const jar = getJar(sessionId);
    
    const headers = new Headers(stealthHeaders);
    for (const [k, v] of Object.entries(req.headers)) {
      if (!['host', 'referer', 'cookie', 'accept-encoding'].includes(k.toLowerCase()) && typeof v === 'string') {
        headers.set(k, v);
      }
    }
    const cookieHeader = await cookiesToHeader(jar, targetUrl);
    if (cookieHeader) headers.set("Cookie", cookieHeader);
    
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };
    
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      if (req.headers["content-type"]?.includes("application/json")) {
         fetchOptions.body = JSON.stringify(req.body);
      } else if (req.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
         fetchOptions.body = new URLSearchParams(req.body).toString();
      } else {
         fetchOptions.body = Buffer.isBuffer(req.body) ? Reflect.get(req, 'rawBody') || req.body : req.body;
      }
    }
    
    const response = await fetch(targetUrl, fetchOptions);
    await storeCookies(jar, response, targetUrl);
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    rewriteCookies(response, res);
    
    const contentDisposition = response.headers.get("content-disposition") || "";
    const contentTypeCheck = response.headers.get("content-type") || "";
    const isDirectDownload = contentDisposition.toLowerCase().includes("attachment") || contentTypeCheck.includes("application/pdf");
    
    if (isDirectDownload) {
      const buffer = await response.arrayBuffer();
      const data = Buffer.from(buffer);
      let filename = "arquivo.pdf";
      const fnMatch = contentDisposition.match(/filename[^;=\n]*=(['\"]?)([^;\n]*)\1/i);
      if (fnMatch?.[2]) filename = decodeURIComponent(fnMatch[2].replace(/['\"]/g, "").trim());
      
      const captured: CapturedFile = {
        id: uuidv4(),
        filename,
        mimeType: contentTypeCheck || "application/pdf",
        data,
        capturedAt: new Date().toISOString(),
        sessionId,
      };
      capturedFiles.set(captured.id, captured);
      
      res.setHeader("Content-Type", "text/html");
      return res.send(`<script>window.parent.postMessage({ type: 'PROXY_DOWNLOAD', id: '${captured.id}', filename: '${filename}' }, '*');</script>`);
    }
    
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);
    
    if (contentType.includes("text/html")) {
       let html = Buffer.from(buffer).toString("utf-8");
       const baseUrl = new URL(targetUrl);
       if (!html.includes('<base ')) {
           html = html.replace('<head>', `<head><base href="${baseUrl.origin}">`);
       }
       return res.send(html);
    }
    
    return res.send(Buffer.from(buffer));
  } catch (e) {
    sendError(res, e);
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
