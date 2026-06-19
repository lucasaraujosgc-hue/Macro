const fs = require('fs');
if (fs.existsSync('/.gemini')) {
   console.log('gemini found in /', fs.readdirSync('/.gemini'));
} else {
   console.log('not found in /');
}
