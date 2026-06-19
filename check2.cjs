const fs = require('fs');
console.log('/app contents:', fs.readdirSync('/app'));
if (fs.existsSync('/app/.gemini')) {
   console.log('gemini found in /app:', fs.readdirSync('/app/.gemini'));
}
