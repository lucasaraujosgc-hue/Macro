const fs = require('fs');

const remainder = `      \`🏢 Tratando empresa: \${currentCompany.razaoSocial} (\${currentCompany.cnpj || ''})\`
    );
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
    activeExecution.logs.push(\`🌐 Navegando para \${step.value}\`);
    activeExecution.currentUrl = step.value;
  } else if (step.type === "click") {
    activeExecution.logs.push(\`🖱️ Clicando em \${step.selector}\`);
  } else if (step.type === "type") {
    activeExecution.logs.push(\`⌨️ Digitando em \${step.selector}: \${value}\`);
  } else if (step.type === "captcha_wait") {
    activeExecution.logs.push(\`⏳ Aguardando solução de Captcha manual...\`);
    activeExecution.status = "paused";
    activeExecution._resumeState = { macro, targetCompanies, companyIndex, nextStepIndex: startIndex + 1 };
    releaseLock();
    return;
  } else if (step.type === "download_wait") {
    activeExecution.logs.push(\`⏳ Aguardando download...\`);
  } else {
    activeExecution.logs.push(\`⏳ Executando \${step.type}\`);
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
    
    const sessionId = (req.query.session) || RECORDING_SESSION;
    const jar = getJar(sessionId);
    
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (!['host', 'referer', 'cookie'].includes(k.toLowerCase()) && typeof v === 'string') {
        headers.set(k, v);
      }
    }
    const cookieHeader = await cookiesToHeader(jar, targetUrl);
    if (cookieHeader) headers.set("Cookie", cookieHeader);
    
    const fetchOptions = {
      method: req.method,
      headers,
    };
    
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      if (req.headers["content-type"]?.includes("application/json")) {
         fetchOptions.body = JSON.stringify(req.body);
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
      const fnMatch = contentDisposition.match(/filename[^;=\\n]*=(['\\"]?)([^;\\n]*)\\1/i);
      if (fnMatch?.[2]) filename = decodeURIComponent(fnMatch[2].replace(/['\\"]/g, "").trim());
      
      const captured = {
        id: uuidv4(),
        filename,
        mimeType: contentTypeCheck || "application/pdf",
        data,
        capturedAt: new Date().toISOString(),
        sessionId,
      };
      capturedFiles.set(captured.id, captured);
      
      res.setHeader("Content-Type", "text/html");
      return res.send(\`<script>window.parent.postMessage({ type: 'PROXY_DOWNLOAD', id: '\${captured.id}', filename: '\${filename}' }, '*');</script>\`);
    }
    
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);
    
    if (contentType.includes("text/html")) {
       let html = Buffer.from(buffer).toString("utf-8");
       const baseUrl = new URL(targetUrl);
       if (!html.includes('<base ')) {
           html = html.replace('<head>', \`<head><base href="\${baseUrl.origin}">\`);
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
    console.log(\`Server running on port \${PORT}\`);
  });
}

startServer();
`;

fs.appendFileSync('server.ts', '\\n' + remainder);
