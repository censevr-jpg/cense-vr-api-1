const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'cense_vr_secret_2025';

async function login(req, res) {
  const { nome, senha } = req.body;
  if (!nome || !senha) return res.status(400).json({ ok: false, erro: 'Nome e senha obrigatórios' });

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(nome) = LOWER($1) AND ativo = true', [nome]);
    if (result.rows.length === 0) return res.status(401).json({ ok: false, erro: 'Usuário ou senha incorretos' });

    const usuario = result.rows[0];
    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaOk) return res.status(401).json({ ok: false, erro: 'Usuário ou senha incorretos' });

    // Atualizar último acesso
    await pool.query('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = $1', [usuario.id]);

    // Log
    await pool.query('INSERT INTO log_acesso (usuario, acao, ip) VALUES ($1, $2, $3)',
      [usuario.nome, 'Login', req.ip]);

    const token = jwt.sign(
      { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      ok: true,
      token,
      usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, erro: 'Erro interno' });
  }
}

function autenticar(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ ok: false, erro: 'Não autenticado' });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch {
    res.status(401).json({ ok: false, erro: 'Token inválido ou expirado' });
  }
}

function exigirPerfil(...perfis) {
  return (req, res, next) => {
    if (!perfis.includes(req.usuario.perfil)) {
      return res.status(403).json({ ok: false, erro: 'Sem permissão' });
    }
    next();
  };
}

module.exports = { login, autenticar, exigirPerfil };
