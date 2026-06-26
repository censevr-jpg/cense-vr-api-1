const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { pool } = require('../database');
const { exigirPerfil } = require('../auth');

router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, nome, perfil, ativo, ultimo_acesso FROM usuarios ORDER BY nome');
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/', exigirPerfil('gestor'), async (req, res) => {
  const { nome, senha, perfil } = req.body;
  if (!nome || !senha || !perfil) return res.status(400).json({ ok: false, erro: 'Campos obrigatórios' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    const r = await pool.query(
      'INSERT INTO usuarios (nome, senha_hash, perfil) VALUES ($1, $2, $3) RETURNING id, nome, perfil',
      [nome, hash, perfil]
    );
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.put('/:id', exigirPerfil('gestor'), async (req, res) => {
  const { nome, senha, perfil, ativo } = req.body;
  try {
    if (senha) {
      const hash = await bcrypt.hash(senha, 10);
      await pool.query('UPDATE usuarios SET nome=$1, senha_hash=$2, perfil=$3, ativo=$4 WHERE id=$5',
        [nome, hash, perfil, ativo !== false, req.params.id]);
    } else {
      await pool.query('UPDATE usuarios SET nome=$1, perfil=$2, ativo=$3 WHERE id=$4',
        [nome, perfil, ativo !== false, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.delete('/:id', exigirPerfil('gestor'), async (req, res) => {
  try {
    await pool.query('UPDATE usuarios SET ativo = false WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
