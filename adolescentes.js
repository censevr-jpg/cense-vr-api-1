const express = require('express');
const router = express.Router();
const { pool } = require('../database');

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.*, m.nome as modulo_nome, t.nome as turma_nome, e.nome as escola_nome
      FROM adolescentes a
      LEFT JOIN modulos m ON a.modulo_id = m.id
      LEFT JOIN turmas t ON a.turma_id = t.id
      LEFT JOIN escolas e ON t.escola_id = e.id
      ORDER BY a.nome
    `);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/', async (req, res) => {
  const { nome, prontuario, nascimento, modulo_id, turma_id, cidade, entrada, situacao, tv } = req.body;
  if (!nome) return res.status(400).json({ ok: false, erro: 'Nome obrigatório' });
  try {
    const r = await pool.query(
      `INSERT INTO adolescentes (nome, prontuario, nascimento, modulo_id, turma_id, cidade, entrada, situacao, tv)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [nome, prontuario||null, nascimento||null, modulo_id||null, turma_id||null, cidade||null, entrada||null, situacao||'ativo', tv||false]
    );
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.put('/:id', async (req, res) => {
  const { nome, prontuario, nascimento, modulo_id, turma_id, cidade, entrada, situacao, tv } = req.body;
  try {
    const r = await pool.query(
      `UPDATE adolescentes SET nome=$1, prontuario=$2, nascimento=$3, modulo_id=$4, turma_id=$5,
       cidade=$6, entrada=$7, situacao=$8, tv=$9, atualizado_em=NOW() WHERE id=$10 RETURNING *`,
      [nome, prontuario||null, nascimento||null, modulo_id||null, turma_id||null, cidade||null, entrada||null, situacao||'ativo', tv||false, req.params.id]
    );
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE adolescentes SET situacao = $1 WHERE id = $2', ['desligado', req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.get('/:id/historico', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM historico_alojamentos WHERE adolescente_id = $1 ORDER BY criado_em DESC', [req.params.id]);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.get('/:id/rios', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT r.* FROM rios r
      JOIN rio_adolescentes ra ON r.id = ra.rio_id
      WHERE ra.adolescente_id = $1 ORDER BY r.data DESC
    `, [req.params.id]);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
