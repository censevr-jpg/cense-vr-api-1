const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { exigirPerfil } = require('../auth');

// MÓDULOS
router.get('/modulos', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT m.*, COUNT(a.id) FILTER (WHERE a.situacao='ativo') as total_ativos
      FROM modulos m LEFT JOIN adolescentes a ON a.modulo_id = m.id
      WHERE m.ativo=true GROUP BY m.id ORDER BY m.nome
    `);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/modulos', exigirPerfil('gestor','secretaria'), async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO modulos (nome) VALUES ($1) RETURNING *', [req.body.nome]);
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.delete('/modulos/:id', exigirPerfil('gestor'), async (req, res) => {
  try {
    await pool.query('UPDATE modulos SET ativo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// ESCOLAS
router.get('/escolas', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM escolas WHERE ativo=true ORDER BY nome');
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/escolas', exigirPerfil('gestor','secretaria'), async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO escolas (nome) VALUES ($1) RETURNING *', [req.body.nome]);
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.delete('/escolas/:id', exigirPerfil('gestor'), async (req, res) => {
  try {
    await pool.query('UPDATE escolas SET ativo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// TURMAS
router.get('/turmas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.*, e.nome as escola_nome FROM turmas t
      JOIN escolas e ON t.escola_id = e.id
      WHERE t.ativo=true ORDER BY e.nome, t.nome
    `);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/turmas', exigirPerfil('gestor','secretaria'), async (req, res) => {
  try {
    const r = await pool.query('INSERT INTO turmas (escola_id, nome) VALUES ($1,$2) RETURNING *', [req.body.escola_id, req.body.nome]);
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.delete('/turmas/:id', exigirPerfil('gestor'), async (req, res) => {
  try {
    await pool.query('UPDATE turmas SET ativo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
