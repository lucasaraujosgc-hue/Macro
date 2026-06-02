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
    logs: string[]
} | null = null;

app.post("/api/execute/:macroId", async (req, res) => {
  const macroId = req.params.macroId;
  const macro = await db.getMacro(macroId);
  if (!macro) return res.status(404).json({ error: "Macro not found" });

  activeExecution = {
      macroId,
      status: 'running',
      currentStepIndex: 0,
      logs: [`Started macro ${macro.name}`]
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

        if (step.type === 'captcha_wait') {
            activeExecution.status = 'paused';
            activeExecution.logs.push("Paused. Waiting for manual captcha resolution.");
            // We would set a screenshot here for real.
            activeExecution.screenshot = "https://via.placeholder.com/600x200?text=Simulated+Captcha+Screenshot";
            return; // Wait for user to call resolve-captcha
        }

        let waitTimeMs = 1000;
        if (step.type === 'wait' && step.waitTime) waitTimeMs = step.waitTime * 1000;

        i++;
        setTimeout(next, waitTimeMs);
    }

    next();
}


// --- PROXY ROUTE FOR RECORDING SIMULATOR ---
app.get("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send("No URL");
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      return res.send(Buffer.from(buffer));
    }

    let html = await response.text();
    
    // Inject click interception script
    const script = `
    <script>
      document.addEventListener('click', function(e) {
        var target = e.target;
        var selector = target.tagName.toLowerCase();
        if (target.id) {
          selector += '#' + target.id;
        } else if (target.className && typeof target.className === 'string') {
          selector += '.' + target.className.split(' ').join('.');
        }
        window.parent.postMessage({ type: 'recorder_click', selector: selector }, '*');

        var a = target.closest('a');
        if (a && a.href && !a.href.startsWith('javascript:')) {
            e.preventDefault();
            e.stopPropagation();
            window.parent.postMessage({ type: 'recorder_navigate', url: a.href }, '*');
        }
      }, true);

      document.addEventListener('submit', function(e) {
         e.preventDefault();
         const action = e.target.action || window.location.href;
         window.parent.postMessage({ type: 'recorder_navigate', url: action }, '*');
      }, true);
    </script>
    <base href="${targetUrl}">
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
