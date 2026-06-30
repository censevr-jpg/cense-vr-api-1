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
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

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
      alojamento VARCHAR(20), atualizado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS historico_alojamentos (
      id SERIAL PRIMARY KEY, adolescente_id INTEGER REFERENCES adolescentes(id),
      modulo_origem VARCHAR(100), modulo_destino VARCHAR(100), motivo TEXT,
      agente VARCHAR(200), observacao TEXT, data DATE DEFAULT CURRENT_DATE,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS frequencia (
      id SERIAL PRIMARY KEY, adolescente_id INTEGER REFERENCES adolescentes(id),
      turma_id INTEGER, data DATE NOT NULL, status VARCHAR(20) DEFAULT 'nao_registrado',
      motivo TEXT, registrado_por VARCHAR(200), criado_em TIMESTAMP DEFAULT NOW(),
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
    CREATE TABLE IF NOT EXISTS atendimentos (
      id SERIAL PRIMARY KEY, profissional VARCHAR(200) NOT NULL, area VARCHAR(100),
      adolescente_id INTEGER REFERENCES adolescentes(id),
      adolescente_nome VARCHAR(200), data DATE NOT NULL, hora TIME,
      tipo VARCHAR(200) NOT NULL, saude_mental BOOLEAN DEFAULT false,
      obs TEXT, criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
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

app.get('/health', (req, res) => res.json({ ok: true, status: 'CENSE-VR API', time: new Date(), banco: USANDO_SUPABASE ? 'Supabase' : 'Render' }));

app.get('/migrate', async (req, res) => {
  try {
    await pool.query("ALTER TABLE adolescentes ADD COLUMN IF NOT EXISTS alojamento VARCHAR(20)");
    await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS matricula VARCHAR(50)");
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
  const r = await pool.query('SELECT a.*,m.nome as modulo_nome,t.nome as turma_nome,e.nome as escola_nome FROM adolescentes a LEFT JOIN modulos m ON a.modulo_id=m.id LEFT JOIN turmas t ON a.turma_id=t.id LEFT JOIN escolas e ON t.escola_id=e.id ORDER BY a.nome');
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/adolescentes', auth, async (req,res) => {
  const { nome,prontuario,nascimento,modulo_id,turma_id,cidade,entrada,situacao,tv,alojamento } = req.body;
  const r = await pool.query('INSERT INTO adolescentes (nome,prontuario,nascimento,modulo_id,turma_id,cidade,entrada,situacao,tv,alojamento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[nome,prontuario||null,parseDate(nascimento),modulo_id||null,turma_id||null,cidade||null,parseDate(entrada),situacao||'ativo',tv||false,alojamento||null]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.put('/api/adolescentes/:id', auth, async (req,res) => {
  const { nome,prontuario,nascimento,modulo_id,turma_id,cidade,entrada,situacao,tv,alojamento } = req.body;
  const r = await pool.query('UPDATE adolescentes SET nome=$1,prontuario=$2,nascimento=$3,modulo_id=$4,turma_id=$5,cidade=$6,entrada=$7,situacao=$8,tv=$9,alojamento=$10,atualizado_em=NOW() WHERE id=$11 RETURNING *',[nome,prontuario||null,parseDate(nascimento),modulo_id||null,turma_id||null,cidade||null,parseDate(entrada),situacao||'ativo',tv||false,alojamento||null,req.params.id]);
  res.json({ ok:true, dados:r.rows[0] });
});
app.delete('/api/adolescentes/:id', auth, async (req,res) => {
  await pool.query("UPDATE adolescentes SET situacao='desligado' WHERE id=$1",[req.params.id]);
  res.json({ ok:true });
});
app.get('/api/adolescentes/:id/historico', auth, async (req,res) => {
  const r = await pool.query('SELECT * FROM historico_alojamentos WHERE adolescente_id=$1 ORDER BY criado_em DESC',[req.params.id]);
  res.json({ ok:true, dados:r.rows });
});
app.get('/api/adolescentes/:id/rios', auth, async (req,res) => {
  const r = await pool.query('SELECT r.* FROM rios r JOIN rio_adolescentes ra ON r.id=ra.rio_id WHERE ra.adolescente_id=$1 ORDER BY r.data DESC',[req.params.id]);
  res.json({ ok:true, dados:r.rows });
});

app.get('/api/frequencia/:data', auth, async (req,res) => {
  const r = await pool.query('SELECT f.*,a.nome as adolescente_nome,a.prontuario,t.nome as turma_nome,e.nome as escola_nome,m.nome as modulo_nome FROM frequencia f JOIN adolescentes a ON f.adolescente_id=a.id LEFT JOIN turmas t ON f.turma_id=t.id LEFT JOIN escolas e ON t.escola_id=e.id LEFT JOIN modulos m ON a.modulo_id=m.id WHERE f.data=$1 ORDER BY e.nome,t.nome,a.nome',[req.params.data]);
  res.json({ ok:true, dados:r.rows });
});
app.post('/api/frequencia', auth, async (req,res) => {
  const { adolescente_id,turma_id,data,status,motivo,registrado_por } = req.body;
  const r = await pool.query('INSERT INTO frequencia (adolescente_id,turma_id,data,status,motivo,registrado_por) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (adolescente_id,data) DO UPDATE SET status=$4,motivo=$5,registrado_por=$6 RETURNING *',[adolescente_id,turma_id||null,data,status,motivo||null,registrado_por||null]);
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
    const r = await client.query('INSERT INTO agenda (data,hora,tipo,carater,modalidade,escolta,viatura,observacao,registrado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[data,hora,tipo,carater||'Externa',modalidade||'Presencial',escolta||null,viatura||null,observacao||null,registrado_por||null]);
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
  const { adolescente_id,modulo_destino_id,modulo_origem,modulo_destino,motivo,agente,observacao,data } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO historico_alojamentos (adolescente_id,modulo_origem,modulo_destino,motivo,agente,observacao,data) VALUES ($1,$2,$3,$4,$5,$6,$7)',[adolescente_id,modulo_origem,modulo_destino,motivo,agente||null,observacao||null,data||new Date().toISOString().slice(0,10)]);
    await client.query('UPDATE adolescentes SET modulo_id=$1,atualizado_em=NOW() WHERE id=$2',[modulo_destino_id,adolescente_id]);
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ ok:false, erro:e.message }); }
  finally { client.release(); }
});
app.get('/api/plantao/trocas/:data', auth, async (req,res) => {
  const r = await pool.query('SELECT h.*,a.nome as adolescente_nome FROM historico_alojamentos h JOIN adolescentes a ON h.adolescente_id=a.id WHERE h.data=$1 ORDER BY h.criado_em DESC',[req.params.data]);
  res.json({ ok:true, dados:r.rows });
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
    const { profissional, area, adolescente_id, adolescente_nome, data, hora, tipo, saude_mental, obs } = req.body;
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
