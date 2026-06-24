const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const proxyCode = `
app.all("/api/proxy", async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith("http")) {
      return res.status(400).json({error: "Invalid URL"});
    }
    
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
    
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);
    
    if (contentType.includes("text/html")) {
       let html = Buffer.from(buffer).toString("utf-8");
       
       // Rewrite resources to go through proxy
       html = html.replace(/(src|href)=["']([^"']+)["']/g, (match, p1, p2) => {
          if (p2.startsWith('http')) {
             return \`\${p1}="/api/proxy/raw/\${p2}"\`;
          }
          if (p2.startsWith('/')) {
             const baseUrl = new URL(targetUrl);
             return \`\${p1}="/api/proxy/raw/\${baseUrl.origin}\${p2}"\`;
          }
          return match;
       });
       
       const baseUrl = new URL(targetUrl);
       if (!html.includes('<base ')) {
           html = html.replace('<head>', \`<head><base href="\${baseUrl.origin}">\`);
       }
       return res.send(html);
    }
    
    return res.send(Buffer.from(buffer));
  } catch (e: any) {
    res.status(500).send(e.message);
  }
});
`;

code = code.replace(/app\.all\("\/api\/proxy\/raw\/\*", async \(req, res\) => \{/, proxyCode + '\napp.all("/api/proxy/raw/*", async (req, res) => {');
fs.writeFileSync('server.ts', code);
