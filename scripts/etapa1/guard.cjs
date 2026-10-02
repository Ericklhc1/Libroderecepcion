const { URL } = require('node:url');
for(const key of ['TEST_DATABASE_URL','DATABASE_URL','DIRECT_DATABASE_URL']) {
 const url=new URL(process.env[key]||'');
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='5432'||url.pathname!=='/libro_test'||url.username!=='libro'||process.env.CI!=='true')throw new Error('Synthetic loopback CI database required: '+key);
}
