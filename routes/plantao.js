const express = require('express');
const router = express.Router();
const { pool } = require('../database');

// Registrar troca de alojamento
router.post('/troca', async (req, res) => {
  const { adolescente_id, modulo_origem, modulo_destino, motivo, agente, observacao, data } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Registrar histórico
    await client.query(
      `INSERT INTO historico_alojamentos (adolescente_id, modulo_origem, modulo_destino, motivo, agente, observacao, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [adolescente_id, modulo_origem, modulo_destino, motivo, agente||null, observacao||null, data||new Date().toISOString().slice(0,10)]
    );
    // Atualizar módulo do adolescente
    await client.query('UPDATE adolescentes SET modulo_id=$1, atualizado_em=NOW() WHERE id=$2', [req.body.modulo_destino_id, adolescente_id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, erro: err.message });
  } finally { client.release(); }
});

// Listar trocas por data
router.get('/trocas/:data', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT h.*, a.nome as adolescente_nome
      FROM historico_alojamentos h
      JOIN adolescentes a ON h.adolescente_id = a.id
      WHERE h.data = $1 ORDER BY h.criado_em DESC
    `, [req.params.data]);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
