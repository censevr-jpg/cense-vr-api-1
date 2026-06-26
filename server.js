require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { inicializarBanco } = require('./database');
const { login, autenticar } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'] }));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use(limiter);

app.get('/health', (req, res) => res.json({ ok: true, status: 'CENSE-VR API rodando', timestamp: new Date().toISOString() }));

app.post('/api/login', login);

const auth = autenticar;
app.use('/api/usuarios',      auth, require('./usuarios'));
app.use('/api/adolescentes',  auth, require('./adolescentes'));
app.use('/api/frequencia',    auth, require('./frequencia'));
app.use('/api/agenda',        auth, require('./agenda'));
app.use('/api/almoxarifado',  auth, require('./almoxarifado'));
app.use('/api/rios',          auth, require('./rios'));
app.use('/api/plantao',       auth, require('./plantao'));
app.use('/api/config',        auth, require('./config'));

async function iniciar() {
  try {
    await inicializarBanco();
    app.listen(PORT, () => {
      console.log('CENSE-VR API rodando na porta ' + PORT);
    });
  } catch (err) {
    console.error('Erro ao iniciar:', err);
    process.exit(1);
  }
}

iniciar();
