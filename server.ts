process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { db, initDB } from "./server/db";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
// @ts-ignore
import forge from "node-forge";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ASSET PROXY MIDDLEWARE ---
// Catches assets that escaped the proxy prefix (e.g. absolute paths like /fonts/font.woff loaded from CSS)
app.use(async (req, res, next) => {
  if (req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/@") || req.originalUrl.startsWith("/node_modules/")) {
    return next();
  }

  const referer = req.headers.referer;
  if (referer && referer.includes("/api/proxy/raw/")) {
    try {
      const match = referer.match(/\/api\/proxy\/raw\/(.+)/);
      if (match && match[1]) {
        // e.g. targetBase = https://host.com/some/path/
        const targetBase = decodeURIComponent(match[1]);
        const targetUrl = new URL(req.originalUrl, targetBase).href;

        console.log(`[Proxy Recovery] Proxying escaped asset ${req.originalUrl} to ${targetUrl}`);

        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          }
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
  const file = { ...req.body, id: uuidv4(), createdAt: new Date().toISOString() };
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
    if (!password) return res.status(400).json({ error: "Password is required" });

    // Parse PFX
    const p12Asn1 = forge.asn1.fromDer(file.buffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    
    // Extract info - very simplified for demo
    let validFrom = new Date();
    let validTo = new Date();
    let titular = "Unknown";
    let serial = "Unknown";
    let issuer = "Unknown";
    let cpfCnpj = "N/A";

    const bags = p12.getBags({bagType: forge.pki.oids.certBag});
    let certBag = bags[forge.pki.oids.certBag]?.[0];
    
    if (certBag && certBag.cert) {
      const cert = certBag.cert;
      validFrom = cert.validity.notBefore;
      validTo = cert.validity.notAfter;
      serial = cert.serialNumber;
      
      const subject = cert.subject.attributes.reduce((acc: any, attr: any) => {
        acc[attr.shortName || attr.name] = attr.value;
        return acc;
      }, {});
      
      const issuerAttr = cert.issuer.attributes.reduce((acc: any, attr: any) => {
        acc[attr.shortName || attr.name] = attr.value;
        return acc;
      }, {});

      titular = subject.CN || "Unknown";
      issuer = issuerAttr.CN || issuerAttr.O || "Unknown";

      // Basic extraction logic for BR certs
      if (titular.includes(":")) {
         const parts = titular.split(":");
         cpfCnpj = parts[parts.length - 1]; // usually contains CPF/CNPJ
      }
    }

    const type = cpfCnpj.length > 11 ? "PJ" : "PF";

    const certificate = {
      id: uuidv4(),
      filename: file.originalname,
      passwordEncrypted: forge.util.encode64(password), // dummy encryption
      titular,
      cpfCnpj,
      serial,
      issuer,
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      type: type as "PF" | "PJ"
    };

    await db.addCertificate(certificate);

    res.json(certificate);

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: "Invalid certificate or wrong password. " + error.message });
  }
});

app.delete("/api/certificates/:id", async (req, res) => {
  await db.deleteCertificate(req.params.id);
  res.json({ success: true });
});


// Helper execution endpoints
let activeExecution: {
    macroId: string,
    status: 'running' | 'paused' | 'completed' | 'error',
    currentStepIndex: number,
    screenshot?: string,
    currentUrl?: string,
    logs: string[]
} | null = null;

app.post("/api/execute/:macroId", async (req, res) => {
  const macroId = req.params.macroId;
  const companyIds = req.body.companyIds || [];
  const macro = await db.getMacro(macroId);
  if (!macro) return res.status(404).json({ error: "Macro not found" });

  const companies = await db.getCompanies();
  const targetCompanies = companies.filter(c => companyIds.includes(c.id));
  const companyNames = targetCompanies.map(c => c.razaoSocial).join(", ");

  activeExecution = {
      macroId,
      status: 'running',
      currentStepIndex: 0,
      currentUrl: 'about:blank',
      logs: [`Started macro ${macro.name}`, `Empresas selecionadas (${targetCompanies.length}): ${companyNames}`]
  };

  simulateExecution(macro);

  res.json({ success: true, execution: activeExecution });
});

app.get("/api/execution", (req, res) => {
  res.json(activeExecution);
});

app.post("/api/execution/resolve-captcha", async (req, res) => {
  if (activeExecution && activeExecution.status === 'paused') {
    activeExecution.logs.push(`Captcha resolved with: ${req.body.text}`);
    activeExecution.status = 'running';
    activeExecution.currentStepIndex++;
    const macro = await db.getMacro(activeExecution.macroId);
    if (macro) {
        simulateExecution(macro, activeExecution.currentStepIndex);
    }
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "No paused execution" });
  }
});

function simulateExecution(macro: any, startIndex = 0) {
    let i = startIndex;
    
    function next() {
        if (!activeExecution) return;
        if (i >= macro.steps.length) {
            activeExecution.status = 'completed';
            activeExecution.logs.push("Execution completed successfully.");
            return;
        }

        const step = macro.steps[i];
        activeExecution.currentStepIndex = i;
        activeExecution.logs.push(`Executing step ${i+1}: ${step.type} - ${step.selector || step.value || ''}`);

        if (step.type === 'navigate' && step.value) {
           activeExecution.currentUrl = step.value;
        }

        if (step.type === 'captcha_wait') {
            activeExecution.status = 'paused';
            activeExecution.logs.push("Paused. Waiting for manual captcha resolution.");
            // We would set a screenshot here for real.
            activeExecution.screenshot = "https://via.placeholder.com/600x200?text=Simulated+Captcha+Screenshot";
            return; // Wait for user to call resolve-captcha
        }

        let waitTimeMs = 1500;
        if (step.type === 'wait' && step.waitTime) waitTimeMs = step.waitTime * 1000;

        i++;
        setTimeout(next, waitTimeMs);
    }

    next();
}


// --- PROXY ROUTE FOR RECORDING SIMULATOR ---
// 1. Raw Passthrough
app.all("/api/proxy/raw/*", async (req, res) => {
    let targetUrl = req.originalUrl.replace("/api/proxy/raw/", "");
    if (!targetUrl.startsWith("http")) return res.status(400).send("Invalid URL");
    
    try {
        console.log(`[Proxy Fetch] ${req.method} ${targetUrl}`);
        const response = await fetch(targetUrl, {
          method: req.method,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          } // omit accept headers to avoid issues
        });
        
        res.setHeader("Access-Control-Allow-Origin", "*");
        response.headers.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            if (lowerKey === 'set-cookie') {
                // Ensure cookies work in iframe via SameSite=None
                const cookies = response.headers.getSetCookie();
                cookies.forEach(cookie => {
                    let newCookie = cookie.replace(/SameSite=Strict/gi, 'SameSite=None')
                                           .replace(/SameSite=Lax/gi, 'SameSite=None');
                    if (!newCookie.toLowerCase().includes('samesite=none')) {
                        newCookie += '; SameSite=None; Secure';
                    }
                    res.append('Set-Cookie', newCookie);
                    console.log(`[Proxy Cookie] ${newCookie.split('=')[0]} preserved`);
                });
            } else if (['content-type', 'content-length', 'cache-control', 'location'].includes(lowerKey)) {
                res.setHeader(key, value);
            }
        });

        // Do not set Content-Security-Policy or X-Frame-Options to allow iframe usage

        const contentType = response.headers.get("content-type") || "";
        
        if (contentType.includes("text/css")) {
            let css = await response.text();
            // Rewrite url(...) in CSS
            css = css.replace(/url\((['"]?)([^'"\)]+)(['"]?)\)/gi, (match, q1, url, q2) => {
                if (url.startsWith("data:")) return match;
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return `url(${q1}/api/proxy/raw/${url}${q2})`;
                }
                const absoluteUrl = new URL(url, targetUrl).href;
                return `url(${q1}/api/proxy/raw/${absoluteUrl}${q2})`;
            });
            // Also rewrite @import "..."
            css = css.replace(/@import\s+(['"])([^'"]+)(['"])/gi, (match, q1, url, q2) => {
                 if (url.startsWith("http://") || url.startsWith("https://")) {
                    return `@import ${q1}/api/proxy/raw/${url}${q2}`;
                }
                const absoluteUrl = new URL(url, targetUrl).href;
                return `@import ${q1}/api/proxy/raw/${absoluteUrl}${q2}`;
            });
            res.setHeader("Content-Length", Buffer.byteLength(css));
            return res.send(css);
        } else if (contentType.includes("javascript") || contentType.includes("ecmascript") || targetUrl.includes(".js")) {
             let js = await response.text();
             res.setHeader("Content-Length", Buffer.byteLength(js));
             res.setHeader("Content-Type", "application/javascript");
             return res.send(js);
        } else if (contentType.includes("image/svg+xml")) {
             let svg = await response.text();
             // Some naive SVG relative rewrites if needed
             svg = svg.replace(/(href|src)=["']([^"']+)["']/gi, (match, attr, url) => {
                 if (url.startsWith("data:") || url.startsWith("#")) return match;
                 if (url.startsWith("http")) return `${attr}="/api/proxy/raw/${url}"`;
                 const absoluteUrl = new URL(url, targetUrl).href;
                 return `${attr}="/api/proxy/raw/${absoluteUrl}"`;
             });
             res.setHeader("Content-Length", Buffer.byteLength(svg));
             return res.send(svg);
        }
        
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (e: any) {
        res.status(500).send(`Failed to proxy: ${e.message}`);
    }
});

// 2. HTML Injector
app.all("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send("No URL");

  // Removed Fallback Mode 3


  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(req.method === 'POST' && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      ...(req.method === 'POST' && req.body && { body: new URLSearchParams(req.body as Record<string, string>).toString() }),
      redirect: 'follow',
    };

    const response = await fetch(targetUrl, fetchOptions);

    res.setHeader("Access-Control-Allow-Origin", "*");
    
    // Cookie rewrite
    const cookies = response.headers.getSetCookie();
    cookies.forEach(cookie => {
        let newCookie = cookie.replace(/SameSite=Strict/gi, 'SameSite=None')
                               .replace(/SameSite=Lax/gi, 'SameSite=None');
        if (!newCookie.toLowerCase().includes('samesite=none')) {
            newCookie += '; SameSite=None; Secure';
        }
        res.append('Set-Cookie', newCookie);
    });

    response.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (['location'].includes(lowerKey)) {
            // Rewrite location redirects
             if (value.startsWith("http")) {
                 res.setHeader(key, `/api/proxy?url=${encodeURIComponent(value)}`);
             } else {
                 const absoluteUrl = new URL(value, targetUrl).href;
                 res.setHeader(key, `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
             }
        }
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      return res.send(Buffer.from(buffer));
    }

    let html = await response.text();
    
    // Replace absolute paths (/something) in HTML to force them into the proxy prefix.
    try {
      const origin = new URL(targetUrl).origin;
      html = html.replace(/(src|href|action|data-src|data-href)="(\/[^"]*)"/gi, `$1="/api/proxy/raw/${origin}$2"`);
      html = html.replace(/(src|href|action|data-src|data-href)='(\/[^']*)'/gi, `$1='/api/proxy/raw/${origin}$2'`);
      
      // Rewrite srcset
      html = html.replace(/srcset="([^"]+)"/gi, (match, val) => {
         const parts = val.split(',').map((p: string) => {
             const [url, size] = p.trim().split(/\s+/);
             if (!url) return '';
             if (url.startsWith('http://') || url.startsWith('https://')) {
                 return `/api/proxy/raw/${url} ${size || ''}`.trim();
             } else if (url.startsWith('/')) {
                 return `/api/proxy/raw/${origin}${url} ${size || ''}`.trim();
             }
             return `${url} ${size || ''}`.trim();
         });
         return `srcset="${parts.join(', ')}"`;
      });
    } catch (e) {
      // Ignored
    }

    // Rewrite absolute HTTP/HTTPS links so they use our proxy
    html = html.replace(/(src|href|action|data-src|data-href)="([^"]*)"/gi, (match, attr, val) => {
      if (val.startsWith("http://") || val.startsWith("https://")) {
        return `${attr}="/api/proxy?url=${encodeURIComponent(val)}"`;
      }
      return match;
    });
    html = html.replace(/(src|href|action|data-src|data-href)='([^']*)'/gi, (match, attr, val) => {
      if (val.startsWith("http://") || val.startsWith("https://")) {
        return `${attr}='/api/proxy?url=${encodeURIComponent(val)}'`;
      }
      return match;
    });

    // Inject click interception script
    const script = `
    <script>
      (function() {
        if (window.__proxyPatched) return;
        window.__proxyPatched = true;

        // Intercept dynamic script/link injections to proxy them
        const originalAppendChild = Element.prototype.appendChild;
        Element.prototype.appendChild = function(child) {
           if (child && child.tagName) {
               if (child.tagName === 'SCRIPT' && child.src && (child.src.startsWith('http://') || child.src.startsWith('https://'))) {
                  const url = new URL(child.src, window.location.href);
                  if (url.origin !== window.location.origin) {
                      child.src = '/api/proxy/raw/' + child.src;
                  }
               }
               if (child.tagName === 'LINK' && child.href && (child.href.startsWith('http://') || child.href.startsWith('https://'))) {
                  const url = new URL(child.href, window.location.href);
                  if (url.origin !== window.location.origin) {
                      child.href = '/api/proxy/raw/' + child.href;
                  }
               }
           }
           return originalAppendChild.call(this, child);
        };

        const originalInsertBefore = Element.prototype.insertBefore;
        Element.prototype.insertBefore = function(child, ref) {
           if (child && child.tagName) {
               if (child.tagName === 'SCRIPT' && child.src && (child.src.startsWith('http://') || child.src.startsWith('https://'))) {
                  const url = new URL(child.src, window.location.href);
                  if (url.origin !== window.location.origin) {
                      child.src = '/api/proxy/raw/' + child.src;
                  }
               }
               if (child.tagName === 'LINK' && child.href && (child.href.startsWith('http://') || child.href.startsWith('https://'))) {
                  const url = new URL(child.href, window.location.href);
                  if (url.origin !== window.location.origin) {
                      child.href = '/api/proxy/raw/' + child.href;
                  }
               }
           }
           return originalInsertBefore.call(this, child, ref);
        };

        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            if (typeof args[0] === 'string') {
                if (args[0].startsWith('http://') || args[0].startsWith('https://')) {
                    const url = new URL(args[0]);
                    if (url.origin !== window.location.origin) {
                        args[0] = '/api/proxy/raw/' + args[0];
                    }
                } else if (args[0].startsWith('/')) {
                    // It's already relative to the proxy base due to <base> tag, 
                    // but some JS ignores <base> for fetch. Let's fix.
                    args[0] = window.document.baseURI ? new URL(args[0], window.document.baseURI).href : args[0];
                }
            } else if (args[0] instanceof Request) {
                 const req = args[0];
                 if (req.url.startsWith('http://') || req.url.startsWith('https://')) {
                     const url = new URL(req.url);
                     if (url.origin !== window.location.origin) {
                         args[0] = new Request('/api/proxy/raw/' + req.url, req);
                     }
                 }
            }
            return originalFetch.apply(this, args);
        };

        const originalXHR = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            if (typeof url === 'string') {
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    const u = new URL(url);
                    if (u.origin !== window.location.origin) {
                        url = '/api/proxy/raw/' + url;
                    }
                } else if (url.startsWith('/')) {
                    url = window.document.baseURI ? new URL(url, window.document.baseURI).href : url;
                }
            }
            return originalXHR.call(this, method, url, ...rest);
        };

        const originalWorker = window.Worker;
        window.Worker = function(url, options) {
            if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
                url = '/api/proxy/raw/' + url;
            }
            return new originalWorker(url, options);
        };

        const originalWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            if (typeof url === 'string') {
                 if (url.startsWith('ws://') || url.startsWith('wss://')) {
                     // Can't proxy WS directly through the same route without upgrade handling
                     // but we could try to rewrite if we had a WS proxy. 
                     // For now just leave it as is or rewrite to a wss proxy endpoint.
                 }
            }
            return protocols ? new originalWebSocket(url, protocols) : new originalWebSocket(url);
        };

        const originalEventSource = window.EventSource;
        window.EventSource = function(url, options) {
             if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
                 url = '/api/proxy/raw/' + url;
             }
             return options ? new originalEventSource(url, options) : new originalEventSource(url);
        };

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

        document.addEventListener('click', function(e) {
          var target = e.target;
          var selector = target.tagName.toLowerCase();
          if (target.id) {
            selector += '#' + target.id;
          } else if (target.className && typeof target.className === 'string') {
            selector += '.' + target.className.split(' ').join('.');
          }
          var isInput = target.tagName.toLowerCase() === 'input' || target.tagName.toLowerCase() === 'textarea' || target.tagName.toLowerCase() === 'select';
          window.parent.postMessage({ type: isInput ? 'recorder_type' : 'recorder_click', selector: selector, tagName: target.tagName.toLowerCase() }, '*');

          var a = target.closest('a');
          if (a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')) {
              e.preventDefault();
              e.stopPropagation();
              const url = a.href.startsWith('http') ? a.href : new URL(a.href, document.baseURI).href;
              window.parent.postMessage({ type: 'recorder_navigate', url: url }, '*');
          }
        }, true);
      })();
    </script>
    <base href="/api/proxy/raw/${targetUrl}">
    `;
    
    if (html.toLowerCase().includes('<head>')) {
      html = html.replace(/<head>/i, '<head>' + script);
    } else {
      html = script + html;
    }
    
    res.send(html);
  } catch (e: any) {
    let isCertError = false;
    const msg = e.message ? e.message.toLowerCase() : "";
    if (msg.includes("certificate") || msg.includes("ssl") || msg.includes("tls") || msg.includes("econnreset")) {
      isCertError = true;
    }
    if (e.cause && typeof e.cause.code === 'string') {
      const code = e.cause.code.toUpperCase();
      if (['ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ECONNRESET'].includes(code)) {
        isCertError = true;
      }
    }

    if (isCertError) {
      res.send(`
        <html>
        <body>
            <div style="padding: 20px; font-family: sans-serif; text-align: center; color: white; background: #1e1e2f; border-radius: 8px;">
                <h2>⚠️ Certificado Digital Solicitado</h2>
                <p>O site destino requer autenticação via Certificado Digital (A1/A3) ou ocorreu um erro de SSL.</p>
                <p>Ação 'Selecionar Certificado' foi registrada na automação.</p>
                <script>
                    window.parent.postMessage({ type: 'recorder_cert_request' }, '*');
                </script>
            </div>
        </body>
        </html>
      `);
    } else {
      res.send(`
        <html>
        <body>
            <div style="padding: 20px; font-family: sans-serif; color: #ff6b6b; background: #2d1b1b; border-radius: 8px;">
                <h2>❌ Erro ao Carregar Site (Proxy)</h2>
                <p>${e.message}</p>
                <p>Alguns sites bloqueiam acessos automatizados (CORS, Cloudflare, etc). Recomendamos usar a extensão do navegador em produção.</p>
            </div>
        </body>
        </html>
      `);
    }
  }
});

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
