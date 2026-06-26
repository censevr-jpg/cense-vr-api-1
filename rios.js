const express = require('express');
const router = express.Router();
const { pool } = require('../database');

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ri.*, 
        COALESCE(json_agg(json_build_object('id', a.id, 'nome', a.nome)) FILTER (WHERE a.id IS NOT NULL), '[]') as adolescentes
      FROM rios ri
      LEFT JOIN rio_adolescentes ra ON ri.id = ra.rio_id
      LEFT JOIN adolescentes a ON ra.adolescente_id = a.id
      GROUP BY ri.id ORDER BY ri.criado_em DESC
    `);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/', async (req, res) => {
  const { data, plantao, local, comunicante, coord, infracao, descricao, cautelar,
    cautelar_resp, cautelar_inicio, cautelar_fim, com_csint, com_cemse, com_juizo,
    com_mp, com_def, medida, registrado_por, adolescentes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Próximo número a partir de 200
    const numR = await client.query('SELECT COALESCE(MAX(numero),199) + 1 as prox FROM rios');
    const numero = numR.rows[0].prox;
    const r = await client.query(
      `INSERT INTO rios (numero, data, plantao, local, comunicante, coord, infracao, descricao,
        cautelar, cautelar_resp, cautelar_inicio, cautelar_fim, com_csint, com_cemse,
        com_juizo, com_mp, com_def, medida, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [numero, data, plantao, local, comunicante, coord||null, infracao, descricao,
       cautelar||'NÃO', cautelar_resp||null, cautelar_inicio||null, cautelar_fim||null,
       com_csint||false, com_cemse||false, com_juizo||false, com_mp||false, com_def||false,
       medida||null, registrado_por||null]
    );
    const rio_id = r.rows[0].id;
    if (adolescentes && adolescentes.length > 0) {
      for (const aid of adolescentes) {
        await client.query('INSERT INTO rio_adolescentes (rio_id, adolescente_id) VALUES ($1,$2)', [rio_id, aid]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, dados: { ...r.rows[0], numero } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, erro: err.message });
  } finally { client.release(); }
});

router.put('/:id/encaminhar-cad', async (req, res) => {
  try {
    await pool.query(
      'UPDATE rios SET encaminhado_cad=true, encaminhado_cad_em=NOW(), encaminhado_cad_por=$1 WHERE id=$2',
      [req.body.por||null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM rios WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
