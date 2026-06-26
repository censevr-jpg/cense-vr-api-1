require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { inicializarBanco } = require('./database');
const { login, autenticar } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Segurança
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'] }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use(limiter);

// Health check
app.get('/health', (req, res) => res.json({ ok: true, status: 'CENSE-VR API rodando', timestamp: new Date().toISOString() }));

// Login (público)
app.post('/api/login', login);

// Rotas protegidas
const authMiddleware = autenticar;
app.use('/api/usuarios',      authMiddleware, require('./routes/usuarios'));
app.use('/api/adolescentes',  authMiddleware, require('./routes/adolescentes'));
app.use('/api/frequencia',    authMiddleware, require('./routes/frequencia'));
app.use('/api/agenda',        authMiddleware, require('./routes/agenda'));
app.use('/api/almoxarifado',  authMiddleware, require('./routes/almoxarifado'));
app.use('/api/rios',          authMiddleware, require('./routes/rios'));
app.use('/api/plantao',       authMiddleware, require('./routes/plantao'));
app.use('/api/config',        authMiddleware, require('./routes/config'));

// Iniciar
async function iniciar() {
  try {
    await inicializarBanco();
    app.listen(PORT, () => {
      console.log(`✅ CENSE-VR API rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Erro ao iniciar:', err);
    process.exit(1);
  }
}

iniciar();
