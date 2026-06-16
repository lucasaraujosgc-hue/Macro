process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { db, initDB } from "./server/db";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import forge from "node-forge";

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

// --- ASSET PROXY MIDDLEWARE ---
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
    activeExecution.logs.push(
      `\n▶️ Iniciando para: ${currentCompany.razaoSocial} (${currentCompany.cnpj})`,
    );
  }

  let i = startIndex;

  function next() {
    if (!activeExecution) return;

    // Respect cancellation
    if (activeExecution.status === "cancelled") {
      releaseLock();
      return;
    }

    if (i >= macro.steps.length) {
      activeExecution.logs.push(`✓ Macro finalizada para a empresa atual.`);

      if (currentCompany) {
        const cnpjClean = currentCompany.cnpj ? currentCompany.cnpj.replace(/\D/g, "") : Math.random().toString().slice(2, 8);
        const fakeFile = {
          id: uuidv4(),
          filename: `comprovante_${cnpjClean}_${Date.now()}.pdf`,
          size: Math.floor(Math.random() * 500000) + 50000,
          createdAt: new Date().toISOString(),
          companyId: currentCompany.id,
          macroId: macro.id,
        };
        db.addFile(fakeFile).catch((e: Error) => console.error("[File Save Error]", e));
        activeExecution.logs.push(
          `📥 Download Concluído: ${fakeFile.filename} salvo na galeria.`,
        );
      }

      // Move to next company
      simulateExecution(macro, targetCompanies, companyIndex + 1, 0);
      return;
    }

    const step = macro.steps[i];
    activeExecution.currentStepIndex = i;

    const evaluatedValue = interpolateValue(step.value, currentCompany);

    activeExecution.logs.push(
      `Passo ${i + 1}: ${step.type.toUpperCase()}${step.selector ? ` [${step.selector}]` : ""}${evaluatedValue ? ` → "${evaluatedValue}"` : ""}`,
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
      activeExecution.logs.push("⏸️ Aguardando resolução manual do captcha...");
      activeExecution.screenshot =
        "https://via.placeholder.com/600x200?text=Simulated+Captcha+Screenshot";
      // Save resume state: we want to continue at i+1 after captcha
      activeExecution._resumeState = {
        macro,
        targetCompanies,
        companyIndex,
        nextStepIndex: i + 1,
      };
      return; // Halt until /api/execution/resolve-captcha is called
    }

    const waitTimeMs = step.type === "wait" && step.waitTime
      ? step.waitTime * 1000
      : 1200;

    i++;
    setTimeout(next, waitTimeMs);
  }

  next();
}

// --- PROXY ROUTE FOR RECORDING SIMULATOR ---

// Helpers
function rewriteCookies(response: Response, res: express.Response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  cookies.forEach((cookie) => {
    let newCookie = cookie
      .replace(/SameSite=Strict/gi, "SameSite=None")
      .replace(/SameSite=Lax/gi, "SameSite=None");
    if (!newCookie.toLowerCase().includes("samesite=none")) {
      newCookie += "; SameSite=None; Secure";
    }
    res.append("Set-Cookie", newCookie);
  });
}

// 1. Raw Passthrough
app.all("/api/proxy/raw/*", async (req, res) => {
  let targetUrl = req.originalUrl.replace("/api/proxy/raw/", "");
  if (!targetUrl.startsWith("http")) return res.status(400).send("Invalid URL");

  try {
    console.log(`[Proxy Raw] ${req.method} ${targetUrl}`);

    // Forward request body for POST/PUT/PATCH
    const hasBody = ["POST", "PUT", "PATCH"].includes(req.method);
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: { ...stealthHeaders },
      ...(hasBody && req.body && {
        body: typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body),
      }),
    };

    const response = await fetch(targetUrl, fetchOptions);

    res.setHeader("Access-Control-Allow-Origin", "*");
    rewriteCookies(response, res);

    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "set-cookie") return; // Already handled above
      if (["content-type", "cache-control", "location"].includes(lowerKey)) {
        res.setHeader(key, value);
      }
    });

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/css")) {
      let css = await response.text();
      css = css.replace(
        /url\((['"]?)([^'"\)]+)(['"]?)\)/gi,
        (_match, q1, url, q2) => {
          if (url.startsWith("data:")) return `url(${q1}${url}${q2})`;
          if (url.startsWith("http://") || url.startsWith("https://")) {
            return `url(${q1}/api/proxy/raw/${url}${q2})`;
          }
          const absoluteUrl = new URL(url, targetUrl).href;
          return `url(${q1}/api/proxy/raw/${absoluteUrl}${q2})`;
        },
      );
      css = css.replace(
        /@import\s+(['"])([^'"]+)(['"])/gi,
        (_match, q1, url, q2) => {
          if (url.startsWith("http://") || url.startsWith("https://")) {
            return `@import ${q1}/api/proxy/raw/${url}${q2}`;
          }
          const absoluteUrl = new URL(url, targetUrl).href;
          return `@import ${q1}/api/proxy/raw/${absoluteUrl}${q2}`;
        },
      );
      // Set Content-Length AFTER all transformations
      const buf = Buffer.from(css, "utf-8");
      res.setHeader("Content-Length", buf.byteLength);
      return res.send(buf);
    }

    if (
      contentType.includes("javascript") ||
      contentType.includes("ecmascript") ||
      targetUrl.match(/\.m?js(\?|$)/)
    ) {
      const js = await response.text();
      const buf = Buffer.from(js, "utf-8");
      res.setHeader("Content-Length", buf.byteLength);
      res.setHeader("Content-Type", "application/javascript");
      return res.send(buf);
    }

    if (contentType.includes("image/svg+xml")) {
      let svg = await response.text();
      svg = svg.replace(/(href|src)=["']([^"']+)["']/gi, (_match, attr, url) => {
        if (url.startsWith("data:") || url.startsWith("#")) return _match;
        if (url.startsWith("http")) return `${attr}="/api/proxy/raw/${url}"`;
        const absoluteUrl = new URL(url, targetUrl).href;
        return `${attr}="/api/proxy/raw/${absoluteUrl}"`;
      });
      const buf = Buffer.from(svg, "utf-8");
      res.setHeader("Content-Length", buf.byteLength);
      return res.send(buf);
    }

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e: any) {
    console.error(`[Proxy Raw Error] ${targetUrl}:`, e.message);
    res.status(500).send(`Failed to proxy: ${e.message}`);
  }
});

// 2. HTML Injector
app.all("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send("No URL provided");

  try {
    const hasBody = req.method === "POST";
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: {
        ...stealthHeaders,
        ...(hasBody && { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      ...(hasBody && req.body && {
        body: new URLSearchParams(req.body as Record<string, string>).toString(),
      }),
      redirect: "follow",
    };

    const response = await fetch(targetUrl, fetchOptions);

    res.setHeader("Access-Control-Allow-Origin", "*");
    rewriteCookies(response, res);

    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "location") {
        const absoluteRedirect = value.startsWith("http")
          ? value
          : new URL(value, targetUrl).href;
        res.setHeader(key, `/api/proxy?url=${encodeURIComponent(absoluteRedirect)}`);
      }
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      return res.send(Buffer.from(buffer));
    }

    let html = await response.text();

    // Rewrite absolute paths (/something) relative to origin
    try {
      const origin = new URL(targetUrl).origin;

      html = html.replace(
        /(src|href|action|data-src|data-href)="(\/[^"]*)"/gi,
        `$1="/api/proxy/raw/${origin}$2"`,
      );
      html = html.replace(
        /(src|href|action|data-src|data-href)='(\/[^']*)'/gi,
        `$1='/api/proxy/raw/${origin}$2'`,
      );

      // Rewrite srcset
      html = html.replace(/srcset="([^"]+)"/gi, (_match, val) => {
        const parts = val.split(",").map((p: string) => {
          const [url, size] = p.trim().split(/\s+/);
          if (!url) return "";
          if (url.startsWith("http://") || url.startsWith("https://")) {
            return `/api/proxy/raw/${url} ${size || ""}`.trim();
          } else if (url.startsWith("/")) {
            return `/api/proxy/raw/${origin}${url} ${size || ""}`.trim();
          }
          return `${url} ${size || ""}`.trim();
        });
        return `srcset="${parts.join(", ")}"`;
      });
    } catch (_e) {
      // Malformed URL — skip origin rewriting
    }

    // Rewrite absolute HTTP/HTTPS links
    html = html.replace(
      /(src|href|action|data-src|data-href)="(https?:\/\/[^"]*)"/gi,
      (_match, attr, val) => `${attr}="/api/proxy?url=${encodeURIComponent(val)}"`,
    );
    html = html.replace(
      /(src|href|action|data-src|data-href)='(https?:\/\/[^']*)'/gi,
      (_match, attr, val) => `${attr}='/api/proxy?url=${encodeURIComponent(val)}'`,
    );

    // Inject recorder + stealth script
    const script = `
    <script>
      (function() {
        if (window.__proxyPatched) return;
        window.__proxyPatched = true;

        // Stealth overrides
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.apply(this, arguments);
          };
          window.chrome = { runtime: {} };
        } catch(e) {}

        // Intercept dynamic script/link injections
        function patchChild(child) {
          if (!child || !child.tagName) return;
          if (child.tagName === 'SCRIPT' && child.src) {
            try {
              const url = new URL(child.src, window.location.href);
              if (url.origin !== window.location.origin) {
                child.src = '/api/proxy/raw/' + child.src;
              }
            } catch(e) {}
          }
          if (child.tagName === 'LINK' && child.href) {
            try {
              const url = new URL(child.href, window.location.href);
              if (url.origin !== window.location.origin) {
                child.href = '/api/proxy/raw/' + child.href;
              }
            } catch(e) {}
          }
        }

        const originalAppendChild = Element.prototype.appendChild;
        Element.prototype.appendChild = function(child) {
          patchChild(child);
          return originalAppendChild.call(this, child);
        };

        const originalInsertBefore = Element.prototype.insertBefore;
        Element.prototype.insertBefore = function(child, ref) {
          patchChild(child);
          return originalInsertBefore.call(this, child, ref);
        };

        // Intercept fetch
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          try {
            if (typeof args[0] === 'string') {
              if (args[0].startsWith('http://') || args[0].startsWith('https://')) {
                const url = new URL(args[0]);
                if (url.origin !== window.location.origin) {
                  args[0] = '/api/proxy/raw/' + args[0];
                }
              } else if (args[0].startsWith('/')) {
                args[0] = window.document.baseURI
                  ? new URL(args[0], window.document.baseURI).href
                  : args[0];
              }
            } else if (args[0] instanceof Request) {
              const r = args[0];
              if (r.url.startsWith('http://') || r.url.startsWith('https://')) {
                const url = new URL(r.url);
                if (url.origin !== window.location.origin) {
                  args[0] = new Request('/api/proxy/raw/' + r.url, r);
                }
              }
            }
          } catch(e) {}
          return originalFetch.apply(this, args);
        };

        // Intercept XHR
        const originalXHR = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          try {
            if (typeof url === 'string') {
              if (url.startsWith('http://') || url.startsWith('https://')) {
                const u = new URL(url);
                if (u.origin !== window.location.origin) {
                  url = '/api/proxy/raw/' + url;
                }
              } else if (url.startsWith('/')) {
                url = window.document.baseURI
                  ? new URL(url, window.document.baseURI).href
                  : url;
              }
            }
          } catch(e) {}
          return originalXHR.call(this, method, url, ...rest);
        };

        // Intercept Worker
        const originalWorker = window.Worker;
        window.Worker = function(url, options) {
          if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            url = '/api/proxy/raw/' + url;
          }
          return new originalWorker(url, options);
        };

        // WebSocket — no-op, proxy would require WS upgrade handling
        // EventSource intercept
        const originalEventSource = window.EventSource;
        window.EventSource = function(url, options) {
          if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            url = '/api/proxy/raw/' + url;
          }
          return options ? new originalEventSource(url, options) : new originalEventSource(url);
        };

        // Form submit intercept
        document.addEventListener('submit', function(e) {
          e.preventDefault();
          const form = e.target;
          const action = form.action.startsWith('http')
            ? form.action
            : new URL(form.action, document.baseURI).href;
          const method = (form.method || 'GET').toUpperCase();
          const formData = new FormData(form);
          const body = new URLSearchParams(formData).toString();
          window.parent.postMessage({
            type: 'recorder_navigate',
            url: action,
            method: method,
            body: body
          }, '*');
        }, true);

        // Unique selector generator
        function getSelector(el) {
          if (el.id) return '#' + CSS.escape(el.id);
          const safeClasses = Array.from(el.classList || [])
            .filter(function(c) { return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c); })
            .slice(0, 2);
          let base = el.tagName.toLowerCase();
          if (safeClasses.length) base += '.' + safeClasses.join('.');
          const siblings = el.parentElement
            ? Array.from(el.parentElement.children).filter(function(s) { return s.tagName === el.tagName; })
            : [];
          if (siblings.length > 1) base += ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')';
          return base;
        }

        // Click recorder
        document.addEventListener('click', function(e) {
          var target = e.target;
          var selector = getSelector(target);
          var isInput = ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase());
          window.parent.postMessage({
            type: isInput ? 'recorder_type' : 'recorder_click',
            selector: selector,
            tagName: target.tagName.toLowerCase()
          }, '*');

          var a = target.closest('a');
          if (a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')) {
            e.preventDefault();
            e.stopPropagation();
            const url = a.href.startsWith('http') ? a.href : new URL(a.href, document.baseURI).href;
            window.parent.postMessage({ type: 'recorder_navigate', url: url }, '*');
          }
        }, true);

        // Simulate actions from parent
        window.addEventListener('message', function(e) {
          if (!e.data || e.data.type !== 'simulate_execution_action') return;
          var action = e.data.action;
          if (!action || !action.selector) return;
          var el = document.querySelector(action.selector);
          if (!el) {
            console.warn('[Proxy] Element not found for simulation:', action.selector);
            return;
          }

          // Highlight
          var origOutline = el.style.outline;
          var origTransition = el.style.transition;
          el.style.transition = 'outline 0.1s ease-in-out';
          el.style.outline = '4px solid #ef4444';
          setTimeout(function() {
            el.style.outline = origOutline;
            el.style.transition = origTransition;
          }, 600);

          if (action.type === 'click') {
            try { el.click(); } catch(err) {}
          } else if (action.type === 'type') {
            try {
              el.focus();
              el.value = action.value || '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } catch(err) {}
          }
        });
      })();
    </script>
    <base href="/api/proxy/raw/${targetUrl}">
    `;

    if (html.toLowerCase().includes("<head>")) {
      html = html.replace(/<head>/i, "<head>" + script);
    } else {
      html = script + html;
    }

    res.send(html);
  } catch (e: any) {
    const msg = (e.message ?? "").toLowerCase();
    const code = (e.cause?.code ?? "").toUpperCase();

    const isCertError =
      msg.includes("certificate") ||
      msg.includes("ssl") ||
      msg.includes("tls") ||
      msg.includes("econnreset") ||
      ["ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ECONNRESET"].includes(code);

    if (isCertError) {
      res.send(`
        <html><body>
          <div style="padding:20px;font-family:sans-serif;text-align:center;color:white;background:#1e1e2f;border-radius:8px;">
            <h2>⚠️ Certificado Digital Solicitado</h2>
            <p>O site destino requer autenticação via Certificado Digital (A1/A3) ou ocorreu um erro de SSL.</p>
            <p>A ação 'Selecionar Certificado' foi registrada na automação.</p>
            <script>window.parent.postMessage({ type: 'recorder_cert_request' }, '*');<\/script>
          </div>
        </body></html>
      `);
    } else {
      console.error(`[Proxy HTML Error] ${targetUrl}:`, e.message);
      res.send(`
        <html><body>
          <div style="padding:20px;font-family:sans-serif;color:#ff6b6b;background:#2d1b1b;border-radius:8px;">
            <h2>❌ Erro ao Carregar Site (Proxy)</h2>
            <p><strong>${e.message}</strong></p>
            <p>Alguns sites bloqueiam acessos automatizados (CORS, Cloudflare, WAF etc). Em produção, recomendamos usar a extensão do navegador.</p>
          </div>
        </body></html>
      `);
    }
  }
});

// --- FRONTEND ---
async function startServer() {
  try {
    await initDB();
    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ Failed to initialize database:", err);
    process.exit(1);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global unhandled-error guard (must be last middleware)
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Unhandled Express Error]", err);
    res.status(500).json({ error: "Erro interno do servidor." });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("❌ Fatal startup error:", err);
  process.exit(1);
});