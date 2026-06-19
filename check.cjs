const fs = require('fs');
const glob = require('fs'); 
const p = process.cwd();
console.log('CWD:', p);
console.log('Dir contents:', fs.readdirSync(p));
if (fs.existsSync(p + '/.gemini')) {
   console.log('Contains gemini dir', fs.readdirSync(p + '/.gemini'));
}
