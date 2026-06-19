const fs = require('fs');
let lines = fs.readFileSync('server.ts', 'utf8').split('\\n');
lines = lines.slice(0, 514); // Keep up to line 514
fs.writeFileSync('server.ts', lines.join('\\n'));
