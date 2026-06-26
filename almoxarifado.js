const express = require('express');
const router = express.Router();
const { pool } = require('../database');

router.get('/produtos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM produtos WHERE ativo=true ORDER BY nome');
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/produtos', async (req, res) => {
  const { nome, unidade } = req.body;
  try {
    const r = await pool.query('INSERT INTO produtos (nome, unidade) VALUES ($1,$2) RETURNING *', [nome, unidade||null]);
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.delete('/produtos/:id', async (req, res) => {
  try {
    await pool.query('UPDATE produtos SET ativo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.get('/entregas/:data', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM entregas WHERE data=$1 ORDER BY hora DESC', [req.params.data]);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/entregas', async (req, res) => {
  const { data, destinatarios, produtos, observacao, operador } = req.body;
  try {
    const inseridos = [];
    for (const dest of destinatarios) {
      const r = await pool.query(
        `INSERT INTO entregas (data, destinatario_id, destinatario_nome, destinatario_tipo, modulo, produtos, observacao, operador)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [data, dest.id||null, dest.nome, dest.tipo||'adolescente', dest.modulo||null, produtos, observacao||null, operador||null]
      );
      inseridos.push(r.rows[0]);
    }
    res.json({ ok: true, dados: inseridos });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
