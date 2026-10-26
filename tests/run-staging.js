// Ejecutor del test de staging: carga tests/.staging.env (local, gitignored)
// y lanza tests/student-charges-staging.js con esas variables. NO imprime secretos.
require('dotenv').config({ path: require('path').join(__dirname, '.staging.env') });
if (!process.env.STAGING_BASE_URL) process.env.STAGING_BASE_URL = 'http://localhost:8010';
require('./student-charges-staging.js');
