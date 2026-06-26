const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function inicializarBanco() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- USUÁRIOS
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        senha_hash VARCHAR(200) NOT NULL,
        perfil VARCHAR(50) NOT NULL DEFAULT 'agente',
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW(),
        ultimo_acesso TIMESTAMP
      );

      -- MÓDULOS
      CREATE TABLE IF NOT EXISTS modulos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL UNIQUE,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- ESCOLAS
      CREATE TABLE IF NOT EXISTS escolas (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- TURMAS
      CREATE TABLE IF NOT EXISTS turmas (
        id SERIAL PRIMARY KEY,
        escola_id INTEGER REFERENCES escolas(id),
        nome VARCHAR(200) NOT NULL,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- ADOLESCENTES
      CREATE TABLE IF NOT EXISTS adolescentes (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        prontuario VARCHAR(50),
        nascimento DATE,
        modulo_id INTEGER REFERENCES modulos(id),
        turma_id INTEGER REFERENCES turmas(id),
        cidade VARCHAR(100),
        entrada DATE,
        situacao VARCHAR(30) DEFAULT 'ativo',
        tv BOOLEAN DEFAULT false,
        criado_em TIMESTAMP DEFAULT NOW(),
        atualizado_em TIMESTAMP DEFAULT NOW()
      );

      -- HISTÓRICO DE ALOJAMENTOS
      CREATE TABLE IF NOT EXISTS historico_alojamentos (
        id SERIAL PRIMARY KEY,
        adolescente_id INTEGER REFERENCES adolescentes(id),
        modulo_origem VARCHAR(100),
        modulo_destino VARCHAR(100),
        motivo TEXT,
        agente VARCHAR(200),
        observacao TEXT,
        data DATE DEFAULT CURRENT_DATE,
        hora TIME DEFAULT CURRENT_TIME,
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- FREQUÊNCIA
      CREATE TABLE IF NOT EXISTS frequencia (
        id SERIAL PRIMARY KEY,
        adolescente_id INTEGER REFERENCES adolescentes(id),
        turma_id INTEGER REFERENCES turmas(id),
        data DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'nao_registrado',
        motivo TEXT,
        auto_cancelamento BOOLEAN DEFAULT false,
        registrado_por VARCHAR(200),
        criado_em TIMESTAMP DEFAULT NOW(),
        UNIQUE(adolescente_id, data)
      );

      -- CONTROLE DE AULA POR ESCOLA/DIA
      CREATE TABLE IF NOT EXISTS controle_aula (
        id SERIAL PRIMARY KEY,
        escola_id INTEGER REFERENCES escolas(id),
        data DATE NOT NULL,
        haula BOOLEAN DEFAULT true,
        motivo_sem_aula VARCHAR(200),
        criado_em TIMESTAMP DEFAULT NOW(),
        UNIQUE(escola_id, data)
      );

      -- CANCELAMENTO DE TURMA
      CREATE TABLE IF NOT EXISTS cancelamento_turma (
        id SERIAL PRIMARY KEY,
        turma_id INTEGER REFERENCES turmas(id),
        data DATE NOT NULL,
        cancelada BOOLEAN DEFAULT false,
        motivo VARCHAR(200),
        criado_em TIMESTAMP DEFAULT NOW(),
        UNIQUE(turma_id, data)
      );

      -- AGENDA
      CREATE TABLE IF NOT EXISTS agenda (
        id SERIAL PRIMARY KEY,
        data DATE NOT NULL,
        hora TIME NOT NULL,
        tipo VARCHAR(100) NOT NULL,
        carater VARCHAR(20) DEFAULT 'Externa',
        modalidade VARCHAR(20) DEFAULT 'Presencial',
        escolta VARCHAR(200),
        viatura VARCHAR(50),
        observacao TEXT,
        registrado_por VARCHAR(200),
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- AGENDA x ADOLESCENTES
      CREATE TABLE IF NOT EXISTS agenda_adolescentes (
        agenda_id INTEGER REFERENCES agenda(id) ON DELETE CASCADE,
        adolescente_id INTEGER REFERENCES adolescentes(id),
        PRIMARY KEY (agenda_id, adolescente_id)
      );

      -- PRODUTOS ALMOXARIFADO
      CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        unidade VARCHAR(50),
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- ENTREGAS ALMOXARIFADO
      CREATE TABLE IF NOT EXISTS entregas (
        id SERIAL PRIMARY KEY,
        data DATE NOT NULL,
        hora TIME DEFAULT CURRENT_TIME,
        destinatario_id INTEGER,
        destinatario_nome VARCHAR(200),
        destinatario_tipo VARCHAR(20) DEFAULT 'adolescente',
        modulo VARCHAR(100),
        produtos TEXT,
        observacao TEXT,
        operador VARCHAR(200),
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- RIOs
      CREATE TABLE IF NOT EXISTS rios (
        id SERIAL PRIMARY KEY,
        numero INTEGER NOT NULL UNIQUE,
        data DATE NOT NULL,
        plantao VARCHAR(5),
        local VARCHAR(200),
        comunicante VARCHAR(200),
        coord VARCHAR(200),
        infracao VARCHAR(20),
        descricao TEXT,
        cautelar VARCHAR(5) DEFAULT 'NÃO',
        cautelar_resp VARCHAR(100),
        cautelar_inicio DATE,
        cautelar_fim DATE,
        com_csint BOOLEAN DEFAULT false,
        com_cemse BOOLEAN DEFAULT false,
        com_juizo BOOLEAN DEFAULT false,
        com_mp BOOLEAN DEFAULT false,
        com_def BOOLEAN DEFAULT false,
        medida TEXT,
        encaminhado_cad BOOLEAN DEFAULT false,
        encaminhado_cad_em TIMESTAMP,
        encaminhado_cad_por VARCHAR(200),
        registrado_por VARCHAR(200),
        criado_em TIMESTAMP DEFAULT NOW()
      );

      -- RIO x ADOLESCENTES
      CREATE TABLE IF NOT EXISTS rio_adolescentes (
        rio_id INTEGER REFERENCES rios(id) ON DELETE CASCADE,
        adolescente_id INTEGER REFERENCES adolescentes(id),
        PRIMARY KEY (rio_id, adolescente_id)
      );

      -- LOG DE ACESSO
      CREATE TABLE IF NOT EXISTS log_acesso (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(200),
        acao VARCHAR(100),
        ip VARCHAR(50),
        criado_em TIMESTAMP DEFAULT NOW()
      );
    `);

    // Criar usuário gestor padrão se não existir
    const bcrypt = require('bcryptjs');
    const existe = await client.query("SELECT id FROM usuarios WHERE nome = 'Gestor'");
    if (existe.rows.length === 0) {
      const hash = await bcrypt.hash('degase2025', 10);
      await client.query(
        "INSERT INTO usuarios (nome, senha_hash, perfil) VALUES ($1, $2, $3)",
        ['Gestor', hash, 'gestor']
      );
      console.log('✅ Usuário Gestor criado (senha: degase2025)');
    }

    console.log('✅ Banco de dados inicializado com sucesso!');
  } finally {
    client.release();
  }
}

module.exports = { pool, inicializarBanco };
