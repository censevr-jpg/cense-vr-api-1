require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cense_vr_secret_2025';

const CONNECTION_STRING = process.env.DATABASE_URL_SUPABASE || process.env.DATABASE_URL;
const USANDO_SUPABASE = !!process.env.DATABASE_URL_SUPABASE;

const pool = new Pool({
  connectionString: CONNECTION_STRING,
  ssl: { rejectUnauthorized: false }
});

// CORS PRIMEIRO - antes do helmet
const corsOptions = {
  origin: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Helmet depois do CORS
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 10000 }));

// ===================================================================
// BLINDAGEM CONTRA QUEDA DO SERVIDOR (2026-08-25)
// A maioria das rotas abaixo faz "await pool.query(...)" sem try/catch.
// Numa rota async do Express, se essa promise rejeitar (erro de SQL,
// violação de constraint, conexão caindo, etc.), o erro NÃO vira uma
// resposta HTTP — ele vira uma "unhandled promise rejection" solta no
// processo Node. A partir do Node 15, isso DERRUBA o processo inteiro na
// hora. O Render reinicia sozinho, mas leva alguns segundos — e nesse
// intervalo toda requisição bate num erro 502 do próprio Render, que não
// tem cabeçalho CORS, e por isso aparece no navegador como "bloqueado por
// política de CORS" mesmo o problema não sendo CORS nenhum. Foi isso que
// causou os erros de login e de importação em massa: uma única linha com
// problema (nome duplicado, dado inesperado, etc.) no meio de várias
// chamadas em sequência derrubava o servidor pra todo mundo.
//
// Em vez de reescrever rota por rota, isso aqui envolve toda rota
// registrada com app.get/post/put/delete/patch: se o handler (mesmo sem
// try/catch) rejeitar, a resposta vira um 500 normal em vez de derrubar o
// servidor. As rotas que já tinham try/catch continuam funcionando igual.
['get','post','put','delete','patch'].forEach(metodo => {
  const original = app[metodo].bind(app);
  app[metodo] = (caminho, ...handlers) => {
    const seguros = handlers.map(h => {
      if (typeof h !== 'function') return h;
      return (req, res, next) => {
        Promise.resolve(h(req, res, next)).catch(e => {
          console.error(`Erro em ${metodo.toUpperCase()} ${caminho}:`, e);
          if (!res.headersSent) res.status(500).json({ ok:false, erro: e.message || 'Erro interno' });
        });
      };
    });
    return original(caminho, ...seguros);
  };
});

// Rede de segurança final: se algo ainda assim escapar (fora de uma rota
// Express), loga em vez de derrubar o processo. Não interfere no
// initDB().catch(...) lá embaixo, que já trata seu próprio erro de
// inicialização.
process.on('unhandledRejection', (motivo) => {
  console.error('Unhandled Rejection (servidor continua no ar):', motivo);
});
process.on('uncaughtException', (erro) => {
  console.error('Uncaught Exception (servidor continua no ar):', erro);
});

function parseDate(d){
  if(!d||d===''||d==='null'||d==='undefined') return null;
  if(typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if(typeof d==='string'&&/^\d{2}\/\d{2}\/\d{2,4}$/.test(d)){
    const p=d.split('/');
    const ano=p[2].length===2?'20'+p[2]:p[2];
    return ano+'-'+p[1]+'-'+p[0];
  }
  return null;
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY, nome VARCHAR(200) NOT NULL,
      senha_hash VARCHAR(200) NOT NULL, perfil VARCHAR(50) DEFAULT 'agente',
      matricula VARCHAR(50),
      ativo BOOLEAN DEFAULT true, criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS modulos (
      id SERIAL PRIMARY KEY, nome VARCHAR(100) UNIQUE NOT NULL, ativo BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS escolas (
      id SERIAL PRIMARY KEY, nome VARCHAR(200) NOT NULL, ativo BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS turmas (
      id SERIAL PRIMARY KEY, escola_id INTEGER REFERENCES escolas(id),
      nome VARCHAR(200) NOT NULL, ativo BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS adolescentes (
      id SERIAL PRIMARY KEY, nome VARCHAR(200) NOT NULL, prontuario VARCHAR(50),
      nascimento DATE, modulo_id INTEGER REFERENCES modulos(id),
      turma_id INTEGER REFERENCES turmas(id), cidade VARCHAR(100),
      entrada DATE, situacao VARCHAR(30) DEFAULT 'ativo', tv BOOLEAN DEFAULT false,
      alojamento VARCHAR(20), tipo_desligamento VARCHAR(30),
      rg VARCHAR(40), cpf VARCHAR(30), mae_nome VARCHAR(200),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS historico_alojamentos (
      id SERIAL PRIMARY KEY, adolescente_id INTEGER REFERENCES adolescentes(id),
      modulo_origem VARCHAR(100), modulo_destino VARCHAR(100), motivo TEXT,
      agente VARCHAR(200), observacao TEXT, data DATE DEFAULT CURRENT_DATE,
      alojamento_origem VARCHAR(20), alojamento_destino VARCHAR(20),
      hora VARCHAR(10),
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS frequencia (
      id SERIAL PRIMARY KEY, adolescente_id INTEGER REFERENCES adolescentes(id),
      turma_id INTEGER, data DATE NOT NULL, status VARCHAR(20) DEFAULT 'nao_registrado',
      motivo TEXT, registrado_por VARCHAR(200), codigo VARCHAR(5),
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(adolescente_id, data)
    );
    CREATE TABLE IF NOT EXISTS controle_aula (
      id SERIAL PRIMARY KEY, escola_id INTEGER REFERENCES escolas(id),
      data DATE NOT NULL, haula BOOLEAN DEFAULT true, motivo_sem_aula VARCHAR(200),
      UNIQUE(escola_id, data)
    );
    CREATE TABLE IF NOT EXISTS cancelamento_turma (
      id SERIAL PRIMARY KEY, turma_id INTEGER REFERENCES turmas(id),
      data DATE NOT NULL, cancelada BOOLEAN DEFAULT false, motivo VARCHAR(200),
      UNIQUE(turma_id, data)
    );
    CREATE TABLE IF NOT EXISTS agenda (
      id SERIAL PRIMARY KEY, data DATE NOT NULL, hora TIME NOT NULL,
      tipo VARCHAR(100) NOT NULL, carater VARCHAR(20) DEFAULT 'Externa',
      modalidade VARCHAR(20) DEFAULT 'Presencial', escolta VARCHAR(200),
      viatura VARCHAR(50), observacao TEXT, registrado_por VARCHAR(200),
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agenda_adolescentes (
      agenda_id INTEGER REFERENCES agenda(id) ON DELETE CASCADE,
      adolescente_id INTEGER REFERENCES adolescentes(id),
      PRIMARY KEY (agenda_id, adolescente_id)
    );
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY, nome VARCHAR(200) NOT NULL,
      unidade VARCHAR(50), ativo BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS entregas (
      id SERIAL PRIMARY KEY, data DATE NOT NULL, hora TIME DEFAULT CURRENT_TIME,
      destinatario_id INTEGER, destinatario_nome VARCHAR(200),
      modulo VARCHAR(100), produtos TEXT, observacao TEXT, operador VARCHAR(200),
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS rios (
      id SERIAL PRIMARY KEY, numero INTEGER UNIQUE NOT NULL, data DATE NOT NULL,
      plantao VARCHAR(5), local VARCHAR(200), comunicante VARCHAR(200),
      coord VARCHAR(200), infracao VARCHAR(20), descricao TEXT,
      cautelar VARCHAR(5) DEFAULT 'NAO', medida TEXT,
      encaminhado_cad BOOLEAN DEFAULT false, encaminhado_cad_em TIMESTAMP,
      encaminhado_cad_por VARCHAR(200), registrado_por VARCHAR(200),
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS rio_adolescentes (
      rio_id INTEGER REFERENCES rios(id) ON DELETE CASCADE,
      adolescente_id INTEGER REFERENCES adolescentes(id),
      PRIMARY KEY (rio_id, adolescente_id)
    );
    CREATE TABLE IF NOT EXISTS log_acesso (
      id SERIAL PRIMARY KEY, usuario VARCHAR(200), acao VARCHAR(100),
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS configuracoes (
      chave VARCHAR(100) PRIMARY KEY, valor JSONB NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW(), atualizado_por VARCHAR(200)
    );
    CREATE TABLE IF NOT EXISTS cursos (
      id SERIAL PRIMARY KEY, nome VARCHAR(200) NOT NULL,
      horario VARCHAR(100), dias VARCHAR(100), turno VARCHAR(20),
      parceiro VARCHAR(200), ativo BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS adolescente_cursos (
      adolescente_id INTEGER REFERENCES adolescentes(id) ON DELETE CASCADE,
      curso_id INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
      PRIMARY KEY (adolescente_id, curso_id)
    );
    CREATE TABLE IF NOT EXISTS almox_produtos (
      id SERIAL PRIMARY KEY, nome VARCHAR(200) NOT NULL,
      unidade VARCHAR(40) DEFAULT 'un', ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS almox_movimentacoes (
      id SERIAL PRIMARY KEY,
      produto_id INTEGER REFERENCES almox_produtos(id) ON DELETE CASCADE,
      tipo VARCHAR(10) NOT NULL, quantidade INTEGER NOT NULL,
      data DATE NOT NULL, responsavel VARCHAR(200), notas TEXT,
      adolescente_id INTEGER, criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS frequencia_curso (
      curso_id INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
      adolescente_id INTEGER REFERENCES adolescentes(id) ON DELETE CASCADE,
      data DATE NOT NULL, status VARCHAR(20) NOT NULL,
      motivo TEXT, codigo VARCHAR(5), registrado_por VARCHAR(200),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (curso_id, adolescente_id, data)
    );
    CREATE TABLE IF NOT EXISTS atendimentos (
      id SERIAL PRIMARY KEY, profissional VARCHAR(200) NOT NULL, area VARCHAR(100),
      adolescente_id INTEGER REFERENCES adolescentes(id),
      adolescente_nome VARCHAR(200), data DATE NOT NULL, hora TIME,
      tipo VARCHAR(200) NOT NULL, saude_mental BOOLEAN DEFAULT false,
      obs TEXT, criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  // As colunas abaixo nasceram depois das tabelas. Ate agora so o
  // /migrate as criava — e o /migrate e MANUAL. Num banco novo, ou num
  // banco recriado, o login quebrava na hora ("column matricula does not
  // exist"), porque a consulta de login usa matricula e a tabela nao
  // tinha. Rodando as mesmas ALTERs aqui, o servidor sobe completo
  // sozinho e ninguem depende de lembrar de chamar /migrate.
  await _alinharColunas();

  const existe = await pool.query("SELECT id FROM usuarios WHERE nome='Gestor'");
  if (!existe.rows.length) {
    const hash = await bcrypt.hash('degase2025', 10);
    await pool.query("INSERT INTO usuarios (nome,senha_hash,perfil) VALUES ($1,$2,$3)", ['Gestor', hash, 'gestor']);
    console.log('Usuario Gestor criado');
  }
  console.log('Banco inicializado!');
}

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ ok: false, erro: 'Nao autenticado' });
  try { req.usuario = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ ok: false, erro: 'Token invalido' }); }
}

// A 'versao' serve para conferir, sem adivinhacao, se o server.js que
// esta no ar e o mais recente. Se este endereco nao mostrar a versao, o
// servidor publicado e antigo — e rotas novas como
// /api/frequencia/periodo nao existem la, o que derruba o processo.
app.get('/health', (req, res) => res.json({ ok: true, status: 'CENSE-VR API', versao: '12.29', time: new Date(), banco: USANDO_SUPABASE ? 'Supabase' : 'Render' }));

// ===================================================================
// RECONCILIACAO DE COLUNAS
//
// O problema, que ja mordeu tres vezes: CREATE TABLE IF NOT EXISTS NAO
// acrescenta coluna em tabela que ja existe. Quando o codigo ganha um
// campo novo, o banco de producao continua sem ele, e a rota quebra com
// "column X does not exist" — mas so na hora em que alguem usa. Foi
// assim com `matricula`, com `criado_em` e com `adolescente_nome`.
//
// Remendar coluna por coluna, do jeito que eu vinha fazendo, so adia o
// proximo susto. Aqui a lista abaixo e a VERDADE do que o codigo espera,
// e no arranque o servidor acrescenta o que estiver faltando em qualquer
// tabela. Nenhuma coluna e removida nem alterada: so acrescentada.
//
// REGRA PARA O FUTURO: campo novo entra NESTA lista, alem do CREATE TABLE.
// ===================================================================
const COLUNAS_ESPERADAS = {
  usuarios: {
    nome:"VARCHAR(200)", senha_hash:"VARCHAR(200)", perfil:"VARCHAR(50) DEFAULT 'agente'",
    matricula:"VARCHAR(50)", ativo:"BOOLEAN DEFAULT true", criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  modulos: { nome:"VARCHAR(100)", ativo:"BOOLEAN DEFAULT true" },
  escolas: { nome:"VARCHAR(200)", ativo:"BOOLEAN DEFAULT true" },
  turmas:  { escola_id:"INTEGER", nome:"VARCHAR(200)", ativo:"BOOLEAN DEFAULT true" },
  adolescentes: {
    nome:"VARCHAR(200)", prontuario:"VARCHAR(50)", nascimento:"DATE", modulo_id:"INTEGER",
    turma_id:"INTEGER", cidade:"VARCHAR(100)", entrada:"DATE",
    situacao:"VARCHAR(30) DEFAULT 'ativo'", tv:"BOOLEAN DEFAULT false",
    alojamento:"VARCHAR(20)", tipo_desligamento:"VARCHAR(30)",
    rg:"VARCHAR(40)", cpf:"VARCHAR(30)", mae_nome:"VARCHAR(200)",
    atualizado_em:"TIMESTAMP DEFAULT NOW()"
  },
  historico_alojamentos: {
    adolescente_id:"INTEGER", modulo_origem:"VARCHAR(100)", modulo_destino:"VARCHAR(100)",
    motivo:"TEXT", agente:"VARCHAR(200)", observacao:"TEXT", data:"DATE DEFAULT CURRENT_DATE",
    alojamento_origem:"VARCHAR(20)", alojamento_destino:"VARCHAR(20)", hora:"VARCHAR(10)",
    criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  frequencia: {
    adolescente_id:"INTEGER", turma_id:"INTEGER", data:"DATE",
    status:"VARCHAR(20) DEFAULT 'nao_registrado'", motivo:"TEXT",
    registrado_por:"VARCHAR(200)", codigo:"VARCHAR(5)", criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  frequencia_curso: {
    curso_id:"INTEGER", adolescente_id:"INTEGER", data:"DATE", status:"VARCHAR(20)",
    motivo:"TEXT", codigo:"VARCHAR(5)", registrado_por:"VARCHAR(200)",
    atualizado_em:"TIMESTAMP DEFAULT NOW()"
  },
  controle_aula: { escola_id:"INTEGER", data:"DATE", haula:"BOOLEAN DEFAULT true", motivo_sem_aula:"VARCHAR(200)" },
  cancelamento_turma: { turma_id:"INTEGER", data:"DATE", cancelada:"BOOLEAN DEFAULT false", motivo:"VARCHAR(200)" },
  agenda: {
    data:"DATE", hora:"TIME", tipo:"VARCHAR(100)", carater:"VARCHAR(20) DEFAULT 'Externa'",
    modalidade:"VARCHAR(20) DEFAULT 'Presencial'", escolta:"VARCHAR(200)", viatura:"VARCHAR(50)",
    observacao:"TEXT", registrado_por:"VARCHAR(200)", criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  produtos: { nome:"VARCHAR(200)", unidade:"VARCHAR(50)", ativo:"BOOLEAN DEFAULT true" },
  entregas: {
    data:"DATE", hora:"TIME DEFAULT CURRENT_TIME", destinatario_id:"INTEGER",
    destinatario_nome:"VARCHAR(200)", modulo:"VARCHAR(100)", produtos:"TEXT",
    observacao:"TEXT", operador:"VARCHAR(200)", criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  rios: {
    numero:"INTEGER", data:"DATE", plantao:"VARCHAR(5)", local:"VARCHAR(200)",
    comunicante:"VARCHAR(200)", coord:"VARCHAR(200)", infracao:"VARCHAR(20)", descricao:"TEXT",
    cautelar:"VARCHAR(5) DEFAULT 'NAO'", medida:"TEXT",
    encaminhado_cad:"BOOLEAN DEFAULT false", encaminhado_cad_em:"TIMESTAMP",
    encaminhado_cad_por:"VARCHAR(200)", registrado_por:"VARCHAR(200)",
    criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  cursos: {
    nome:"VARCHAR(200)", horario:"VARCHAR(100)", dias:"VARCHAR(100)",
    turno:"VARCHAR(20)", parceiro:"VARCHAR(200)", ativo:"BOOLEAN DEFAULT true"
  },
  almox_produtos: {
    nome:"VARCHAR(200)", unidade:"VARCHAR(40) DEFAULT 'un'",
    ativo:"BOOLEAN DEFAULT true", criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  almox_movimentacoes: {
    produto_id:"INTEGER", tipo:"VARCHAR(10)", quantidade:"INTEGER", data:"DATE",
    responsavel:"VARCHAR(200)", notas:"TEXT", adolescente_id:"INTEGER",
    criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  atendimentos: {
    profissional:"VARCHAR(200)", area:"VARCHAR(100)", adolescente_id:"INTEGER",
    adolescente_nome:"VARCHAR(200)", data:"DATE", hora:"TIME", tipo:"VARCHAR(200)",
    saude_mental:"BOOLEAN DEFAULT false", obs:"TEXT", criado_em:"TIMESTAMP DEFAULT NOW()"
  },
  log_acesso: { usuario:"VARCHAR(200)", acao:"VARCHAR(100)", criado_em:"TIMESTAMP DEFAULT NOW()" },
  configuracoes: { valor:"JSONB", atualizado_em:"TIMESTAMP DEFAULT NOW()", atualizado_por:"VARCHAR(200)" }
};

// Acrescenta o que faltar. Devolve a lista do que foi criado, para o log
// e para o endereco /verificar-colunas.
async function _alinharColunas(){
  const criadas = [];
  for (const tabela of Object.keys(COLUNAS_ESPERADAS)) {
    let existe;
    try {
      existe = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',
        [tabela]
      );
    } catch(e) { continue; }
    if (!existe.rows.length) continue;               // tabela ainda nao existe: o CREATE cuida
    const tem = new Set(existe.rows.map(r => r.column_name));
    for (const [coluna, tipo] of Object.entries(COLUNAS_ESPERADAS[tabela])) {
      if (tem.has(coluna)) continue;
      try {
        await pool.query(`ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS ${coluna} ${tipo}`);
        criadas.push(tabela + '.' + coluna);
      } catch(e) {
        console.error('Nao consegui criar ' + tabela + '.' + coluna + ':', e.message);
      }
    }
  }
  if (criadas.length) console.log('Colunas acrescentadas: ' + criadas.join(', '));
  else console.log('Colunas: nada faltando.');
  return criadas;
}

// Diagnostico: mostra o que esta faltando SEM alterar nada.
app.get('/verificar-colunas', async (req, res) => {
  try {
    const faltando = {};
    for (const tabela of Object.keys(COLUNAS_ESPERADAS)) {
      const r = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',
        [tabela]
      );
      if (!r.rows.length) { faltando[tabela] = 'TABELA NAO EXISTE'; continue; }
      const tem = new Set(r.rows.map(x => x.column_name));
      const f = Object.keys(COLUNAS_ESPERADAS[tabela]).filter(c => !tem.has(c));
      if (f.length) faltando[tabela] = f;
    }
    res.json({ ok:true, tudoCerto: Object.keys(faltando).length === 0, faltando });
  } catch(e) { res.json({ ok:false, erro:e.message }); }
});

app.get('/migrate', async (req, res) => {
  try {
    await pool.query("ALTER TABLE adolescentes ADD COLUMN IF NOT EXISTS alojamento VARCHAR(20)");
    await pool.query("ALTER TABLE adolescentes ADD COLUMN IF NOT EXISTS tipo_desligamento VARCHAR(30)");
    await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS matricula VARCHAR(50)");
    // RG, CPF e nome da mãe: existiam no formulário e eram digitados, mas
    // NUNCA eram enviados ao servidor — e como o app reconstrói a lista de
    // adolescentes a partir do banco a cada sincronização, sumiam do
    // navegador junto. Nenhum dos 80 cadastros tinha nome da mãe guardado.
    await pool.query("ALTER TABLE adolescentes ADD COLUMN IF NOT EXISTS rg VARCHAR(40)");
    await pool.query("ALTER TABLE adolescentes ADD COLUMN IF NOT EXISTS cpf VARCHAR(30)");
    await pool.query("ALTER TABLE adolescentes ADD COLUMN IF NOT EXISTS mae_nome VARCHAR(200)");
    // Troca de plantao: o alojamento (12.3, 5.1...) e a hora eram
    // mostrados na tela mas nao existiam no banco — so o modulo era
    // guardado. Sem eles, a troca lida de volta viria incompleta.
    await pool.query("ALTER TABLE historico_alojamentos ADD COLUMN IF NOT EXISTS alojamento_origem VARCHAR(20)");
    await pool.query("ALTER TABLE historico_alojamentos ADD COLUMN IF NOT EXISTS alojamento_destino VARCHAR(20)");
    await pool.query("ALTER TABLE historico_alojamentos ADD COLUMN IF NOT EXISTS hora VARCHAR(10)");
    // codigo CD/CE da frequencia: CD = cancelado por baixo efetivo
    // (responsabilidade da unidade), CE = cancelado/suspenso pela escola.
    // A "efetividade do plantao" e calculada em cima justamente dessa
    // distincao, mas o codigo nunca era gravado — entao depois de um sync
    // todo cancelamento virava CE e a conta ficava sempre 100%.
    await pool.query("ALTER TABLE frequencia ADD COLUMN IF NOT EXISTS codigo VARCHAR(5)");
    await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes (
      chave VARCHAR(100) PRIMARY KEY, valor JSONB NOT NULL,
      atualizado_em TIMESTAMP DEFAULT NOW(), atualizado_por VARCHAR(200)
    )`);
    // Cursos e a matricula do adolescente em cursos — antes existiam
    // SOMENTE no navegador de quem cadastrava, nunca no banco.
    await pool.query(`CREATE TABLE IF NOT EXISTS cursos (
      id SERIAL PRIMARY KEY, nome VARCHAR(200) NOT NULL,
      horario VARCHAR(100), dias VARCHAR(100), turno VARCHAR(20),
      parceiro VARCHAR(200), ativo BOOLEAN DEFAULT true
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS adolescente_cursos (
      adolescente_id INTEGER REFERENCES adolescentes(id) ON DELETE CASCADE,
      curso_id INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
      PRIMARY KEY (adolescente_id, curso_id)
    )`);
    // Frequencia dos CURSOS. Ate agora a chamada do curso so existia no
    // navegador de quem lancou: gravarDiarioCurso() salvava em
    // localStorage e nunca falava com o servidor. Mesmo padrao que ja
    // aconteceu com a frequencia escolar.
    await pool.query(`CREATE TABLE IF NOT EXISTS frequencia_curso (
      curso_id INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
      adolescente_id INTEGER REFERENCES adolescentes(id) ON DELETE CASCADE,
      data DATE NOT NULL, status VARCHAR(20) NOT NULL,
      motivo TEXT, codigo VARCHAR(5), registrado_por VARCHAR(200),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (curso_id, adolescente_id, data)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS atendimentos (
      id SERIAL PRIMARY KEY, profissional VARCHAR(200) NOT NULL, area VARCHAR(100),
      adolescente_id INTEGER, adolescente_nome VARCHAR(200), data DATE NOT NULL,
      hora TIME, tipo VARCHAR(200) NOT NULL, saude_mental BOOLEAN DEFAULT false,
      obs TEXT, criado_em TIMESTAMP DEFAULT NOW()
    )`);
    res.json({ ok: true, msg: 'Migracao concluida!' });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

app.get('/migrate-data-render-to-supabase', async (req, res) => {
  if (!process.env.DATABASE_URL_SUPABASE) return res.json({ ok: false, erro: 'DATABASE_URL_SUPABASE nao configurada' });
  if (!process.env.DATABASE_URL_OLD_RENDER) return res.json({ ok: false, erro: 'DATABASE_URL_OLD_RENDER nao configurada.' });
  const poolOrigem = new Pool({ connectionString: process.env.DATABASE_URL_OLD_RENDER, ssl: { rejectUnauthorized: false } });
  const poolDestino = new Pool({ connectionString: process.env.DATABASE_URL_SUPABASE, ssl: { rejectUnauthorized: false } });
  const resultado = {};
  const tabelas = ['usuarios','modulos','escolas','turmas','adolescentes','historico_alojamentos','frequencia','controle_aula','cancelamento_turma','agenda','agenda_adolescentes','produtos','entregas','rios','rio_adolescentes','log_acesso','atendimentos'];
  try {
    for (const tabela of tabelas) {
      try {
        const origem = await poolOrigem.query(`SELECT * FROM ${tabela}`);
        if (origem.rows.length === 0) { resultado[tabela] = 'vazio (0 linhas)'; continue; }
        await poolDestino.query(`DELETE FROM ${tabela}`);
        const colunas = Object.keys(origem.rows[0]);
        let inseridos = 0;
        for (const row of origem.rows) {
          const valores = colunas.map(c => row[c]);
          const placeholders = colunas.map((_,i) => `$${i+1}`).join(',');
          try { await poolDestino.query(`INSERT INTO ${tabela} (${colunas.join(',')}) VALUES (${placeholders})`, valores); inseridos++; } catch(e) {}
        }
        resultado[tabela] = `${inseridos}/${origem.rows.length} copiados`;
        try { await poolDestino.query(`SELECT setval(pg_get_serial_sequence('${tabela}','id'),COALESCE((SELECT MAX(id) FROM ${tabela}),1))`); } catch(e) {}
      } catch(e) { resultado[tabela] = 'ERRO: '+e.message; }
    }
    res.json({ ok: true, resultado });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
  finally { await poolOrigem.end(); await poolDestino.end(); }
});

app.post('/api/login', async (req, res) => {
  const { nome, senha, matricula } = req.body;
  const login = matricula || nome;
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE (matricula=$1 OR LOWER(nome)=LOWER($1)) AND ativo=true', [login]);
    if (!r.rows.length) return res.status(401).json({ ok: false, erro: 'Usuario ou senha incorretos' });
    const u = r.rows[0];
    if (!await bcrypt.compare(senha, u.senha_hash)) return res.status(401).json({ ok: false, erro: 'Usuario ou senha incorretos' });
    await pool.query('INSERT INTO log_acesso (usuario,acao) VALUES ($1,$2)', [u.nome, 'Login']);
    const token = jwt.sign({ id: u.id, nome: u.nome, perfil: u.perfil }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ ok: true, token, usuario: { id: u.id, nome: u.nome, perfil: u.perfil, matricula: u.matricula } });
  } catch(e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.put('/api/usuarios/trocar-senha', auth, async (req, res) => {
  const { senhaAtual, senhaNova } = req.body;
  if (!senhaAtual || !senhaNova) return res.status(400).json({ ok: false, erro: 'Preencha a senha atual e a nova senha.' });
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE id=$1', [req.usuario.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, erro: 'Usuario nao encontrado.' });
    const u = r.rows[0];
    if (!await bcrypt.compare(senhaAtual, u.senha_hash)) return res.status(401).json({ ok: false, erro: 'Senha atual incorreta.' });
    const novoHash = await bcrypt.hash(senhaNova, 10);
    await pool.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2', [novoHash, req.usuario.id]);
    res.json({ ok: true, msg: 'Senha alterada com sucesso!' });
  } catch(e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.get('/api/usuarios', auth, async (req,res) => {
  const r = await pool.query('SELECT id,nome,perfil,matricula,ativo FROM usuarios ORDER BY nome');
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/usuarios', auth, async (req,res) => {
  const { nome, senha, perfil, matricula } = req.body;
  const hash = await bcrypt.hash(senha, 10);
  const r = await pool.query('INSERT INTO usuarios (nome,senha_hash,perfil,matricula) VALUES ($1,$2,$3,$4) RETURNING id,nome,perfil,matricula',[nome,hash,perfil,matricula||null]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.put('/api/usuarios/:id', auth, async (req,res) => {
  const { nome, senha, perfil, ativo, matricula } = req.body;
  if (senha) {
    const hash = await bcrypt.hash(senha,10);
    await pool.query('UPDATE usuarios SET nome=$1,senha_hash=$2,perfil=$3,ativo=$4,matricula=$5 WHERE id=$6',[nome,hash,perfil,ativo!==false,matricula||null,req.params.id]);
  } else {
    await pool.query('UPDATE usuarios SET nome=$1,perfil=$2,ativo=$3,matricula=$4 WHERE id=$5',[nome,perfil,ativo!==false,matricula||null,req.params.id]);
  }
  res.json({ ok:true });
});
app.delete('/api/usuarios/:id', auth, async (req,res) => {
  await pool.query('UPDATE usuarios SET ativo=false WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});

app.get('/api/config/modulos', auth, async (req,res) => {
  const r = await pool.query("SELECT m.*,COUNT(a.id) FILTER(WHERE a.situacao='ativo') as total FROM modulos m LEFT JOIN adolescentes a ON a.modulo_id=m.id WHERE m.ativo=true GROUP BY m.id ORDER BY m.nome");
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/config/modulos', auth, async (req,res) => {
  const r = await pool.query('INSERT INTO modulos (nome) VALUES ($1) RETURNING *',[req.body.nome]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/config/modulos/:id', auth, async (req,res) => {
  await pool.query('UPDATE modulos SET ativo=false WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});
app.get('/api/config/escolas', auth, async (req,res) => {
  const r = await pool.query('SELECT * FROM escolas WHERE ativo=true ORDER BY nome');
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/config/escolas', auth, async (req,res) => {
  const r = await pool.query('INSERT INTO escolas (nome) VALUES ($1) RETURNING *',[req.body.nome]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/config/escolas/:id', auth, async (req,res) => {
  await pool.query('UPDATE escolas SET ativo=false WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});
app.get('/api/config/turmas', auth, async (req,res) => {
  const r = await pool.query('SELECT t.*,e.nome as escola_nome FROM turmas t JOIN escolas e ON t.escola_id=e.id WHERE t.ativo=true ORDER BY e.nome,t.nome');
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/config/turmas', auth, async (req,res) => {
  const r = await pool.query('INSERT INTO turmas (escola_id,nome) VALUES ($1,$2) RETURNING *',[req.body.escola_id,req.body.nome]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/config/turmas/:id', auth, async (req,res) => {
  await pool.query('UPDATE turmas SET ativo=false WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});
// ===================================================================
// CONFIGURAÇÕES GERAIS — guarda no banco os ajustes que antes viviam só
// no navegador (escala de banho de sol, escala da quadra, e o que mais
// vier). Cada ajuste é uma chave com um valor em JSON, então dá para
// acrescentar novos sem mexer no banco de novo.
// ===================================================================
app.get('/api/config/gerais', auth, async (req,res) => {
  const r = await pool.query('SELECT chave, valor FROM configuracoes');
  const dados = {};
  r.rows.forEach(l => { dados[l.chave] = l.valor; });
  res.json({ ok:true, dados });
});
app.put('/api/config/gerais/:chave', auth, async (req,res) => {
  const valor = req.body && req.body.valor !== undefined ? req.body.valor : null;
  if (valor === null) return res.status(400).json({ ok:false, erro:'Informe "valor".' });
  await pool.query(
    `INSERT INTO configuracoes (chave,valor,atualizado_em,atualizado_por) VALUES ($1,$2,NOW(),$3)
     ON CONFLICT (chave) DO UPDATE SET valor=$2, atualizado_em=NOW(), atualizado_por=$3`,
    [req.params.chave, JSON.stringify(valor), (req.usuario && req.usuario.nome) || null]
  );
  res.json({ ok:true });
});

// ===================================================================
// CURSOS — antes viviam SÓ no localStorage do navegador de quem
// cadastrava. Quem lançasse um curso no computador do serviço não via
// nada em casa, porque nunca chegava ao banco. Mesmo padrão que já
// aconteceu com escolas, turmas, adolescentes e frequência.
// 'dias' é guardado como texto separado por vírgula (ex.: "seg,qua").
// ===================================================================
app.get('/api/config/cursos', auth, async (req,res) => {
  const r = await pool.query('SELECT * FROM cursos WHERE ativo=true ORDER BY nome');
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/config/cursos', auth, async (req,res) => {
  const { nome, horario, dias, turno, parceiro } = req.body;
  const diasTexto = Array.isArray(dias) ? dias.join(',') : (dias || null);
  const r = await pool.query(
    'INSERT INTO cursos (nome,horario,dias,turno,parceiro) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [nome, horario||null, diasTexto, turno||null, parceiro||null]
  );
  res.json({ ok:true, dados:r.rows[0] });
});
app.put('/api/config/cursos/:id', auth, async (req,res) => {
  const { nome, horario, dias, turno, parceiro } = req.body;
  const diasTexto = Array.isArray(dias) ? dias.join(',') : (dias || null);
  const r = await pool.query(
    'UPDATE cursos SET nome=$1,horario=$2,dias=$3,turno=$4,parceiro=$5 WHERE id=$6 RETURNING *',
    [nome, horario||null, diasTexto, turno||null, parceiro||null, req.params.id]
  );
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/config/cursos/:id', auth, async (req,res) => {
  // Desativa o curso e desfaz as matrículas — o mesmo que a tela já fazia
  // localmente ("Adolescentes matriculados perderão a vinculação").
  await pool.query('DELETE FROM adolescente_cursos WHERE curso_id=$1',[req.params.id]);
  await pool.query('UPDATE cursos SET ativo=false WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});

// Matrícula do adolescente em cursos — substitui a lista inteira dele.
app.put('/api/adolescentes/:id/cursos', auth, async (req,res) => {
  const ids = Array.isArray(req.body.cursos) ? req.body.cursos.filter(x=>x) : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM adolescente_cursos WHERE adolescente_id=$1',[req.params.id]);
    for (const cid of ids) {
      await client.query(
        'INSERT INTO adolescente_cursos (adolescente_id,curso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.params.id, cid]
      );
    }
    await client.query('COMMIT');
    res.json({ ok:true, total:ids.length });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok:false, erro:e.message });
  } finally { client.release(); }
});

app.get('/api/config/produtos', auth, async (req,res) => {
  const r = await pool.query('SELECT * FROM produtos WHERE ativo=true ORDER BY nome');
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/config/produtos', auth, async (req,res) => {
  const r = await pool.query('INSERT INTO produtos (nome,unidade) VALUES ($1,$2) RETURNING *',[req.body.nome,req.body.unidade||null]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/config/produtos/:id', auth, async (req,res) => {
  await pool.query('UPDATE produtos SET ativo=false WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});

app.get('/api/adolescentes', auth, async (req,res) => {
  // cursos_ids vem agregado aqui para que o app monte a lista de cursos de
  // cada adolescente sem precisar de uma chamada por pessoa.
  const r = await pool.query(`
    SELECT a.*, m.nome as modulo_nome, t.nome as turma_nome, e.nome as escola_nome,
      COALESCE(
        (SELECT array_agg(ac.curso_id) FROM adolescente_cursos ac WHERE ac.adolescente_id = a.id),
        '{}'
      ) AS cursos_ids
    FROM adolescentes a
    LEFT JOIN modulos m ON a.modulo_id=m.id
    LEFT JOIN turmas t ON a.turma_id=t.id
    LEFT JOIN escolas e ON t.escola_id=e.id
    ORDER BY a.nome`);
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/adolescentes', auth, async (req,res) => {
  const { nome,prontuario,nascimento,modulo_id,turma_id,cidade,entrada,situacao,tv,alojamento,tipo_desligamento,rg,cpf,mae_nome } = req.body;
  const r = await pool.query('INSERT INTO adolescentes (nome,prontuario,nascimento,modulo_id,turma_id,cidade,entrada,situacao,tv,alojamento,tipo_desligamento,rg,cpf,mae_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[nome,prontuario||null,parseDate(nascimento),modulo_id||null,turma_id||null,cidade||null,parseDate(entrada),situacao||'ativo',tv||false,alojamento||null,tipo_desligamento||null,rg||null,cpf||null,mae_nome||null]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.put('/api/adolescentes/:id', auth, async (req,res) => {
  const { nome,prontuario,nascimento,modulo_id,turma_id,cidade,entrada,situacao,tv,alojamento,tipo_desligamento,rg,cpf,mae_nome } = req.body;
  // COALESCE nos três campos novos: se a chamada não trouxer rg/cpf/mãe
  // (por exemplo uma tela antiga, ou uma planilha que só mexe em turma),
  // o que já está gravado é mantido em vez de ser apagado. Sem isso,
  // qualquer atualização parcial zeraria esses dados.
  const r = await pool.query(
    `UPDATE adolescentes SET nome=$1,prontuario=$2,nascimento=$3,modulo_id=$4,turma_id=$5,
       cidade=$6,entrada=$7,situacao=$8,tv=$9,alojamento=$10,tipo_desligamento=$11,
       rg=COALESCE($12,rg), cpf=COALESCE($13,cpf), mae_nome=COALESCE($14,mae_nome),
       atualizado_em=NOW()
     WHERE id=$15 RETURNING *`,
    [nome,prontuario||null,parseDate(nascimento),modulo_id||null,turma_id||null,cidade||null,parseDate(entrada),situacao||'ativo',tv||false,alojamento||null,tipo_desligamento||null,rg||null,cpf||null,mae_nome||null,req.params.id]
  );
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/adolescentes/:id', auth, async (req,res) => {
  await pool.query("UPDATE adolescentes SET situacao='desligado' WHERE id=$1",[req.params.id]);
  res.json({ ok:true });
});
// Exclusão DEFINITIVA — apaga o cadastro de verdade (nome, frequência,
// histórico de alojamento, vínculos com agenda/RIO). Diferente do DELETE
// acima, que só marca como desligado. Serve só para corrigir cadastro
// duplicado ou lançado por engano — e não para desligamento normal.
// Restrito a gestor, e roda em transação porque adolescente tem várias
// tabelas dependentes sem ON DELETE CASCADE (frequencia, historico_
// alojamentos, agenda_adolescentes, rio_adolescentes) — sem apagar essas
// linhas primeiro, o DELETE final quebraria por violação de FK.
app.delete('/api/adolescentes/:id/definitivo', auth, async (req,res) => {
  if (req.usuario.perfil !== 'gestor') {
    return res.status(403).json({ ok:false, erro:'Somente o gestor pode excluir definitivamente.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = req.params.id;
    await client.query('DELETE FROM historico_alojamentos WHERE adolescente_id=$1',[id]);
    await client.query('DELETE FROM frequencia WHERE adolescente_id=$1',[id]);
    await client.query('DELETE FROM agenda_adolescentes WHERE adolescente_id=$1',[id]);
    await client.query('DELETE FROM rio_adolescentes WHERE adolescente_id=$1',[id]);
    // Atendimentos (prontuário técnico/saúde) não é apagado — só desvincula
    // o adolescente_id, porque o registro do atendimento em si deve
    // continuar existindo mesmo se o cadastro for excluído.
    await client.query('UPDATE atendimentos SET adolescente_id=NULL WHERE adolescente_id=$1',[id]);
    const r = await client.query('DELETE FROM adolescentes WHERE id=$1 RETURNING nome',[id]);
    await client.query('COMMIT');
    if (!r.rows.length) return res.status(404).json({ ok:false, erro:'Adolescente nao encontrado.' });
    res.json({ ok:true, nome:r.rows[0].nome });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok:false, erro:e.message });
  } finally {
    client.release();
  }
});
app.get('/api/adolescentes/:id/historico', auth, async (req,res) => {
  const r = await pool.query('SELECT * FROM historico_alojamentos WHERE adolescente_id=$1 ORDER BY criado_em DESC',[req.params.id]);
  res.json({ ok:true, dados:r.rows });
});
app.get('/api/adolescentes/:id/rios', auth, async (req,res) => {
  const r = await pool.query('SELECT r.* FROM rios r JOIN rio_adolescentes ra ON r.id=ra.rio_id WHERE ra.adolescente_id=$1 ORDER BY r.data DESC',[req.params.id]);
  res.json({ ok:true, dados:r.rows });
});

// ===================================================================
// FREQUENCIA POR PERIODO (leitura) — precisa vir ANTES de
// '/api/frequencia/:data', senao o Express casa "periodo" como se fosse
// uma data e essa rota nunca e alcancada.
//
// Ate agora a frequencia era GRAVADA no servidor mas NUNCA LIDA de volta:
// carregarDadosAPI() nao buscava frequencia nenhuma, entao a chamada so
// existia no localStorage do navegador onde foi marcada. Quem abrisse o
// sistema em outro computador (ou depois de limpar o cache) via tudo em
// branco, como se nada tivesse sido lancado. Esta rota devolve, de uma vez
// so, tudo que o periodo tem: frequencia, controle de aula por escola e
// cancelamento de turma.
// ===================================================================
app.get('/api/frequencia/periodo', auth, async (req,res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ ok:false, erro:'Informe inicio e fim (AAAA-MM-DD).' });
  const f = await pool.query(
    'SELECT adolescente_id, turma_id, data, status, motivo, codigo, registrado_por FROM frequencia WHERE data >= $1 AND data <= $2 ORDER BY data',
    [inicio, fim]
  );
  const c = await pool.query(
    'SELECT escola_id, data, haula, motivo_sem_aula FROM controle_aula WHERE data >= $1 AND data <= $2',
    [inicio, fim]
  );
  const ct = await pool.query(
    'SELECT turma_id, data, cancelada, motivo FROM cancelamento_turma WHERE data >= $1 AND data <= $2',
    [inicio, fim]
  );
  res.json({ ok:true, frequencia:f.rows, controles:c.rows, cancelamentos:ct.rows });
});

// Gravacao EM LOTE — usada pela restauracao de backup. Mandar 600+
// requisicoes uma a uma demora minutos e qualquer queda no meio deixa a
// restauracao pela metade sem ninguem saber onde parou; aqui tudo entra
// numa transacao so: ou grava tudo, ou nao grava nada.
app.post('/api/frequencia/lote', auth, async (req,res) => {
  const { frequencia = [], controles = [], cancelamentos = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let nFreq = 0, nCtrl = 0, nCanc = 0;
    for (const f of frequencia) {
      if (!f || !f.adolescente_id || !f.data || !f.status) continue;
      await client.query(
        `INSERT INTO frequencia (adolescente_id,turma_id,data,status,motivo,codigo,registrado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (adolescente_id,data)
         DO UPDATE SET status=$4, motivo=$5, codigo=$6, registrado_por=$7, turma_id=$2`,
        [f.adolescente_id, f.turma_id || null, f.data, f.status, f.motivo || null, f.codigo || null, f.registrado_por || null]
      );
      nFreq++;
    }
    for (const c of controles) {
      if (!c || !c.escola_id || !c.data) continue;
      await client.query(
        `INSERT INTO controle_aula (escola_id,data,haula,motivo_sem_aula) VALUES ($1,$2,$3,$4)
         ON CONFLICT (escola_id,data) DO UPDATE SET haula=$3, motivo_sem_aula=$4`,
        [c.escola_id, c.data, c.haula !== false, c.motivo_sem_aula || null]
      );
      nCtrl++;
    }
    for (const c of cancelamentos) {
      if (!c || !c.turma_id || !c.data) continue;
      await client.query(
        `INSERT INTO cancelamento_turma (turma_id,data,cancelada,motivo) VALUES ($1,$2,$3,$4)
         ON CONFLICT (turma_id,data) DO UPDATE SET cancelada=$3, motivo=$4`,
        [c.turma_id, c.data, c.cancelada !== false, c.motivo || null]
      );
      nCanc++;
    }
    await client.query('COMMIT');
    res.json({ ok:true, frequencia:nFreq, controles:nCtrl, cancelamentos:nCanc });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok:false, erro:e.message });
  } finally {
    client.release();
  }
});

app.get('/api/frequencia/:data', auth, async (req,res) => {
  const r = await pool.query('SELECT f.*,a.nome as adolescente_nome,a.prontuario,t.nome as turma_nome,e.nome as escola_nome,m.nome as modulo_nome FROM frequencia f JOIN adolescentes a ON f.adolescente_id=a.id LEFT JOIN turmas t ON f.turma_id=t.id LEFT JOIN escolas e ON t.escola_id=e.id LEFT JOIN modulos m ON a.modulo_id=m.id WHERE f.data=$1 ORDER BY e.nome,t.nome,a.nome',[req.params.data]);
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/frequencia', auth, async (req,res) => {
  const { adolescente_id,turma_id,data,status,motivo,codigo,registrado_por } = req.body;
  const r = await pool.query('INSERT INTO frequencia (adolescente_id,turma_id,data,status,motivo,codigo,registrado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (adolescente_id,data) DO UPDATE SET status=$4,motivo=$5,codigo=$6,registrado_por=$7 RETURNING *',[adolescente_id,turma_id||null,data,status,motivo||null,codigo||null,registrado_por||null]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.post('/api/frequencia/controle-aula', auth, async (req,res) => {
  const { escola_id,data,haula,motivo_sem_aula } = req.body;
  await pool.query('INSERT INTO controle_aula (escola_id,data,haula,motivo_sem_aula) VALUES ($1,$2,$3,$4) ON CONFLICT (escola_id,data) DO UPDATE SET haula=$3,motivo_sem_aula=$4',[escola_id,data,haula,motivo_sem_aula||null]);
  res.json({ ok:true });
});
app.get('/api/frequencia/controle/:data', auth, async (req,res) => {
  const r = await pool.query('SELECT * FROM controle_aula WHERE data=$1',[req.params.data]);
  const c = await pool.query('SELECT * FROM cancelamento_turma WHERE data=$1',[req.params.data]);
  res.json({ ok:true, controles:r.rows, cancelamentos:c.rows });
});
app.post('/api/frequencia/cancelar-turma', auth, async (req,res) => {
  const { turma_id,data,motivo,registrado_por } = req.body;
  await pool.query('INSERT INTO cancelamento_turma (turma_id,data,cancelada,motivo) VALUES ($1,$2,true,$3) ON CONFLICT (turma_id,data) DO UPDATE SET cancelada=true,motivo=$3',[turma_id,data,motivo||null]);
  const alunos = await pool.query("SELECT id FROM adolescentes WHERE turma_id=$1 AND situacao='ativo'",[turma_id]);
  for (const a of alunos.rows) {
    await pool.query("INSERT INTO frequencia (adolescente_id,turma_id,data,status,motivo,registrado_por) VALUES ($1,$2,$3,'ausente',$4,$5) ON CONFLICT (adolescente_id,data) DO UPDATE SET status='ausente',motivo=$4",[a.id,turma_id,data,motivo||'Cancelamento de turma',registrado_por||null]);
  }
  res.json({ ok:true, total:alunos.rows.length });
});

app.get('/api/agenda/:data', auth, async (req,res) => {
  const r = await pool.query("SELECT a.*,COALESCE(json_agg(json_build_object('id',ad.id,'nome',ad.nome)) FILTER(WHERE ad.id IS NOT NULL),'[]') as adolescentes FROM agenda a LEFT JOIN agenda_adolescentes aa ON a.id=aa.agenda_id LEFT JOIN adolescentes ad ON aa.adolescente_id=ad.id WHERE a.data=$1 GROUP BY a.id ORDER BY a.hora",[req.params.data]);
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/agenda', auth, async (req,res) => {
  const { data,hora,tipo,carater,modalidade,escolta,viatura,observacao,registrado_por,adolescentes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Usar nome do usuário autenticado se não vier registrado_por
    const nomeRegistrador = registrado_por || req.usuario?.nome || 'Sistema';
    const r = await client.query('INSERT INTO agenda (data,hora,tipo,carater,modalidade,escolta,viatura,observacao,registrado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[data,hora,tipo,carater||'Externa',modalidade||'Presencial',escolta||null,viatura||null,observacao||null,nomeRegistrador]);
    if (adolescentes && adolescentes.length) {
      for (const aid of adolescentes) await client.query('INSERT INTO agenda_adolescentes (agenda_id,adolescente_id) VALUES ($1,$2)',[r.rows[0].id,aid]);
    }
    await client.query('COMMIT');
    res.json({ ok:true, dados:r.rows[0] });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ ok:false, erro:e.message }); }
  finally { client.release(); }
});
app.delete('/api/agenda/:id', auth, async (req,res) => {
  await pool.query('DELETE FROM agenda WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});

app.get('/api/almoxarifado/entregas/:data', auth, async (req,res) => {
  const r = await pool.query('SELECT * FROM entregas WHERE data=$1 ORDER BY hora DESC',[req.params.data]);
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/almoxarifado/entregas', auth, async (req,res) => {
  const { data,destinatarios,produtos,observacao,operador } = req.body;
  const inseridos = [];
  for (const d of destinatarios) {
    const r = await pool.query('INSERT INTO entregas (data,destinatario_id,destinatario_nome,modulo,produtos,observacao,operador) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[data,d.id||null,d.nome,d.modulo||null,produtos,observacao||null,operador||null]);
    inseridos.push(r.rows[0]);
  }
  res.json({ ok:true, dados:inseridos });
});

app.get('/api/rios', auth, async (req,res) => {
  const r = await pool.query("SELECT ri.*,COALESCE(json_agg(json_build_object('id',a.id,'nome',a.nome)) FILTER(WHERE a.id IS NOT NULL),'[]') as adolescentes FROM rios ri LEFT JOIN rio_adolescentes ra ON ri.id=ra.rio_id LEFT JOIN adolescentes a ON ra.adolescente_id=a.id GROUP BY ri.id ORDER BY ri.criado_em DESC");
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/rios', auth, async (req,res) => {
  const { data,plantao,local,comunicante,coord,infracao,descricao,cautelar,medida,registrado_por,adolescentes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numR = await client.query('SELECT COALESCE(MAX(numero),199)+1 as prox FROM rios');
    const numero = numR.rows[0].prox;
    const r = await client.query('INSERT INTO rios (numero,data,plantao,local,comunicante,coord,infracao,descricao,cautelar,medida,registrado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[numero,data,plantao,local,comunicante,coord||null,infracao,descricao,cautelar||'NAO',medida||null,registrado_por||null]);
    if (adolescentes && adolescentes.length) {
      for (const aid of adolescentes) await client.query('INSERT INTO rio_adolescentes (rio_id,adolescente_id) VALUES ($1,$2)',[r.rows[0].id,aid]);
    }
    await client.query('COMMIT');
    res.json({ ok:true, dados:{ ...r.rows[0], numero } });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ ok:false, erro:e.message }); }
  finally { client.release(); }
});
app.put('/api/rios/:id/encaminhar-cad', auth, async (req,res) => {
  await pool.query('UPDATE rios SET encaminhado_cad=true,encaminhado_cad_em=NOW(),encaminhado_cad_por=$1 WHERE id=$2',[req.body.por||null,req.params.id]);
  res.json({ ok:true });
});
app.delete('/api/rios/:id', auth, async (req,res) => {
  await pool.query('DELETE FROM rios WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});

app.post('/api/plantao/troca', auth, async (req,res) => {
  const { adolescente_id,modulo_destino_id,modulo_origem,modulo_destino,motivo,agente,observacao,data,alojamento_origem,alojamento_destino,hora } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO historico_alojamentos
        (adolescente_id,modulo_origem,modulo_destino,motivo,agente,observacao,data,alojamento_origem,alojamento_destino,hora)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [adolescente_id,modulo_origem,modulo_destino,motivo,agente||null,observacao||null,
       data||new Date().toISOString().slice(0,10),alojamento_origem||null,alojamento_destino||null,hora||null]);
    await client.query('UPDATE adolescentes SET modulo_id=$1,atualizado_em=NOW() WHERE id=$2',[modulo_destino_id,adolescente_id]);
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ ok:false, erro:e.message }); }
  finally { client.release(); }
});
// Trocas de um PERÍODO — precisa vir antes de '/api/plantao/trocas/:data',
// senão o Express casa "periodo" como se fosse uma data.
// Até agora as trocas eram gravadas no servidor mas NUNCA lidas de volta:
// quem abrisse o sistema em outro computador não via troca nenhuma.
app.get('/api/plantao/trocas/periodo', auth, async (req,res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ ok:false, erro:'Informe inicio e fim (AAAA-MM-DD).' });
  const r = await pool.query(
    `SELECT h.*, a.nome as adolescente_nome
       FROM historico_alojamentos h
       JOIN adolescentes a ON h.adolescente_id=a.id
      WHERE h.data >= $1 AND h.data <= $2
      ORDER BY h.data, h.criado_em`, [inicio, fim]);
  res.json({ ok:true, dados:r.rows });
});

app.get('/api/plantao/trocas/:data', auth, async (req,res) => {
  const r = await pool.query('SELECT h.*,a.nome as adolescente_nome FROM historico_alojamentos h JOIN adolescentes a ON h.adolescente_id=a.id WHERE h.data=$1 ORDER BY h.criado_em DESC',[req.params.data]);
  res.json({ ok:true, dados:r.rows });
});

// ===================================================================
// ALMOXARIFADO
//
// Ate agora o almoxarifado vivia SO no navegador: `D.almox_produtos` e
// `D.almox_estoque` nunca falavam com o servidor, e a rota antiga
// /api/almoxarifado/entregas jamais foi chamada. Quem lancasse uma
// entrada num computador nao via nada em outro.
//
// DECISAO IMPORTANTE: o saldo NAO e guardado. Ele e SEMPRE calculado a
// partir das movimentacoes (entradas menos saidas). Guardar o saldo e
// somar/subtrair em cada maquina faria os numeros divergirem em silencio
// assim que duas pessoas mexessem ao mesmo tempo — e num almoxarifado
// isso vira falta de material sem ninguem entender por que.
// ===================================================================
app.get('/api/almox/produtos', auth, async (req,res) => {
  const r = await pool.query(`
    SELECT p.id, p.nome, p.unidade, p.ativo,
           COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.quantidade
                             WHEN m.tipo='saida'   THEN -m.quantidade
                             ELSE 0 END), 0)::int AS saldo
      FROM almox_produtos p
      LEFT JOIN almox_movimentacoes m ON m.produto_id = p.id
     GROUP BY p.id, p.nome, p.unidade, p.ativo
     ORDER BY p.nome`);
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/almox/produtos', auth, async (req,res) => {
  const { nome, unidade } = req.body;
  if (!nome) return res.status(400).json({ ok:false, erro:'Informe o nome do material.' });
  // Nao duplica material com o mesmo nome: devolve o que ja existe.
  const ja = await pool.query('SELECT * FROM almox_produtos WHERE LOWER(TRIM(nome))=LOWER(TRIM($1))', [nome]);
  if (ja.rows.length) return res.json({ ok:true, dados:ja.rows[0], jaExistia:true });
  const r = await pool.query(
    'INSERT INTO almox_produtos (nome,unidade) VALUES ($1,$2) RETURNING *',
    [nome, unidade || 'un']
  );
  res.json({ ok:true, dados:r.rows[0] });
});
app.put('/api/almox/produtos/:id', auth, async (req,res) => {
  const { nome, unidade, ativo } = req.body;
  const r = await pool.query(
    'UPDATE almox_produtos SET nome=COALESCE($1,nome), unidade=COALESCE($2,unidade), ativo=COALESCE($3,ativo) WHERE id=$4 RETURNING *',
    [nome||null, unidade||null, (ativo===undefined?null:ativo), req.params.id]
  );
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/almox/produtos/:id', auth, async (req,res) => {
  await pool.query('DELETE FROM almox_produtos WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});

// /periodo ANTES de qualquer /:param
app.get('/api/almox/movimentacoes/periodo', auth, async (req,res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ ok:false, erro:'Informe inicio e fim (AAAA-MM-DD).' });
  const r = await pool.query(
    'SELECT id, produto_id, tipo, quantidade, data, responsavel, notas, adolescente_id FROM almox_movimentacoes WHERE data >= $1 AND data <= $2 ORDER BY data, id',
    [inicio, fim]
  );
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/almox/movimentacoes', auth, async (req,res) => {
  const { produto_id, tipo, quantidade, data, responsavel, notas, adolescente_id } = req.body;
  if (!produto_id || !tipo || !quantidade || !data)
    return res.status(400).json({ ok:false, erro:'Informe produto_id, tipo, quantidade e data.' });
  if (tipo !== 'entrada' && tipo !== 'saida')
    return res.status(400).json({ ok:false, erro:'tipo deve ser "entrada" ou "saida".' });
  const r = await pool.query(
    'INSERT INTO almox_movimentacoes (produto_id,tipo,quantidade,data,responsavel,notas,adolescente_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [produto_id, tipo, Math.abs(parseInt(quantidade,10)), data, responsavel||null, notas||null, adolescente_id||null]
  );
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/almox/movimentacoes/:id', auth, async (req,res) => {
  await pool.query('DELETE FROM almox_movimentacoes WHERE id=$1',[req.params.id]);
  res.json({ ok:true });
});
// Lote, para a carga inicial dos pedidos do almoxarifado virtual.
app.post('/api/almox/movimentacoes/lote', auth, async (req,res) => {
  const { movimentacoes = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const m of movimentacoes) {
      if (!m || !m.produto_id || !m.tipo || !m.quantidade || !m.data) continue;
      await client.query(
        'INSERT INTO almox_movimentacoes (produto_id,tipo,quantidade,data,responsavel,notas,adolescente_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [m.produto_id, m.tipo, Math.abs(parseInt(m.quantidade,10)), m.data, m.responsavel||null, m.notas||null, m.adolescente_id||null]
      );
      n++;
    }
    await client.query('COMMIT');
    res.json({ ok:true, gravadas:n });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok:false, erro:e.message });
  } finally { client.release(); }
});

// ===================================================================
// FREQUENCIA DOS CURSOS
// A chamada do curso nunca saia do navegador: gravarDiarioCurso() so
// chamava S(). Quem lancasse no computador do servico nao via nada em
// casa, e um cache limpo levava tudo embora.
// ATENCAO: /periodo tem de vir ANTES de /:curso, senao o Express casa
// "periodo" como se fosse um id de curso.
// ===================================================================
app.get('/api/frequencia-curso/periodo', auth, async (req,res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ ok:false, erro:'Informe inicio e fim (AAAA-MM-DD).' });
  const r = await pool.query(
    'SELECT curso_id, adolescente_id, data, status, motivo, codigo, registrado_por FROM frequencia_curso WHERE data >= $1 AND data <= $2 ORDER BY data',
    [inicio, fim]
  );
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/frequencia-curso/lote', auth, async (req,res) => {
  const { frequencia = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const f of frequencia) {
      if (!f || !f.curso_id || !f.adolescente_id || !f.data || !f.status) continue;
      await client.query(
        `INSERT INTO frequencia_curso (curso_id,adolescente_id,data,status,motivo,codigo,registrado_por,atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (curso_id,adolescente_id,data)
         DO UPDATE SET status=$4, motivo=$5, codigo=$6, registrado_por=$7, atualizado_em=NOW()`,
        [f.curso_id, f.adolescente_id, f.data, f.status, f.motivo || null, f.codigo || null, f.registrado_por || null]
      );
      n++;
    }
    await client.query('COMMIT');
    res.json({ ok:true, gravados:n });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok:false, erro:e.message });
  } finally { client.release(); }
});

app.get('/api/atendimentos', auth, async (req,res) => {
  try {
    const { data, profissional } = req.query;
    let q = 'SELECT * FROM atendimentos WHERE 1=1';
    const params = [];
    if(data){ params.push(data); q += ` AND data=$${params.length}`; }
    if(profissional){ params.push(profissional); q += ` AND profissional=$${params.length}`; }
    q += ' ORDER BY data DESC, hora DESC';
    const r = await pool.query(q, params);
    res.json({ ok:true, dados:r.rows });
  } catch(e){ res.status(500).json({ ok:false, erro:e.message }); }
});
app.post('/api/atendimentos', auth, async (req,res) => {
  try {
    const { profissional, area, adolescente_id, adolescente_nome, data, hora, tipo, saude_mental, obs, permitir_duplicata } = req.body;
    // TRAVA CONTRA DUPLICATA. Dois cliques no botao mandam dois POST
    // iguais; o navegador ja tem a sua propria trava, mas ela nao cobre
    // dois computadores ao mesmo tempo nem um clique que escapa antes da
    // tela travar. Se um atendimento identico entrou nos ultimos 2
    // minutos, devolvemos o que JA existe em vez de criar outro — assim o
    // app recebe um id valido e nao fica achando que falhou.
    // A consulta da trava NUNCA pode impedir a gravação: se ela falhar
    // por qualquer motivo, seguimos e gravamos. Antes não era assim, e um
    // erro aqui (coluna faltando) barrava todo lançamento de atendimento.
    let dup = { rows: [] };
    try {
      dup = await pool.query(
        `SELECT * FROM atendimentos
          WHERE profissional=$1 AND data=$2 AND tipo=$3
            AND COALESCE(adolescente_id,-1)=COALESCE($4,-1)
            AND criado_em > NOW() - INTERVAL '2 minutes'
          ORDER BY id DESC LIMIT 1`,
        [profissional, data, tipo, adolescente_id||null]
      );
    } catch(eDup){
      console.error('Trava anti-duplicata indisponivel, gravando assim mesmo:', eDup.message);
    }
    // permitir_duplicata: o app manda isto quando a PESSOA ja viu o aviso
    // "ja existe um lancamento igual" e respondeu que houve mesmo um
    // segundo atendimento. Sem isto, a trava do servidor impediria um
    // registro legitimo e a pessoa nao teria como lancar.
    if (dup.rows.length && !permitir_duplicata) {
      return res.json({ ok:true, dados:dup.rows[0], duplicado:true });
    }
    const r = await pool.query(
      'INSERT INTO atendimentos (profissional,area,adolescente_id,adolescente_nome,data,hora,tipo,saude_mental,obs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [profissional,area||null,adolescente_id||null,adolescente_nome||null,data,hora||null,tipo,saude_mental||false,obs||null]
    );
    res.json({ ok:true, dados:r.rows[0] });
  } catch(e){ res.status(500).json({ ok:false, erro:e.message }); }
});
app.delete('/api/atendimentos/:id', auth, async (req,res) => {
  try {
    await pool.query('DELETE FROM atendimentos WHERE id=$1',[req.params.id]);
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ ok:false, erro:e.message }); }
});
app.get('/api/atendimentos/periodo', auth, async (req,res) => {
  try {
    const { inicio, fim } = req.query;
    const r = await pool.query('SELECT * FROM atendimentos WHERE data >= $1 AND data <= $2 ORDER BY profissional,data DESC',[inicio,fim]);
    res.json({ ok:true, dados:r.rows });
  } catch(e){ res.status(500).json({ ok:false, erro:e.message }); }
});

initDB().then(() => {
  app.listen(PORT, () => console.log('CENSE-VR API porta ' + PORT));
}).catch(err => { console.error(err); process.exit(1); });
