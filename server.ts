import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { db } from "./server/db";
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
app.get("/api/companies", (req, res) => {
  res.json(db.getCompanies());
});

app.post("/api/companies", (req, res) => {
  const company = { ...req.body, id: uuidv4() };
  db.addCompany(company);
  res.json(company);
});

app.put("/api/companies/:id", (req, res) => {
  db.updateCompany(req.params.id, req.body);
  res.json({ success: true });
});

app.delete("/api/companies/:id", (req, res) => {
  db.deleteCompany(req.params.id);
  res.json({ success: true });
});

// Macros
app.get("/api/macros", (req, res) => {
  res.json(db.getMacros());
});

app.post("/api/macros", (req, res) => {
  const macro = { ...req.body, id: uuidv4() };
  if (!macro.steps) macro.steps = [];
  db.addMacro(macro);
  res.json(macro);
});

app.put("/api/macros/:id", (req, res) => {
  db.updateMacro(req.params.id, req.body);
  res.json({ success: true });
});

app.delete("/api/macros/:id", (req, res) => {
  db.deleteMacro(req.params.id);
  res.json({ success: true });
});

// Certificates
app.get("/api/certificates", (req, res) => {
  res.json(db.getCertificates());
});

app.post("/api/certificates/upload", upload.single("pfx"), (req, res) => {
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

    db.addCertificate(certificate);

    res.json(certificate);

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: "Invalid certificate or wrong password. " + error.message });
  }
});

app.delete("/api/certificates/:id", (req, res) => {
  db.deleteCertificate(req.params.id);
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

app.post("/api/execute/:macroId", (req, res) => {
  const macroId = req.params.macroId;
  const macro = db.getMacro(macroId);
  if (!macro) return res.status(404).json({ error: "Macro not found" });

  activeExecution = {
      macroId,
      status: 'running',
      currentStepIndex: 0,
      logs: [`Started macro ${macro.name}`]
  };

  // Here we would actually spawn Puppeteer and run the macro steps.
  // We'll mock the progression for the prototype format.
  simulateExecution(macro);

  res.json({ success: true, execution: activeExecution });
});

app.get("/api/execution", (req, res) => {
  res.json(activeExecution);
});

app.post("/api/execution/resolve-captcha", (req, res) => {
  if (activeExecution && activeExecution.status === 'paused') {
    activeExecution.logs.push(`Captcha resolved with: ${req.body.text}`);
    activeExecution.status = 'running';
    // Resume simulation
    activeExecution.currentStepIndex++;
    const macro = db.getMacro(activeExecution.macroId);
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


// --- FRONTEND ROUTES ---
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
