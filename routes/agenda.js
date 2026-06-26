const express = require('express');
const router = express.Router();
const { pool } = require('../database');

router.get('/:data', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.*, 
        COALESCE(json_agg(json_build_object('id', ad.id, 'nome', ad.nome)) FILTER (WHERE ad.id IS NOT NULL), '[]') as adolescentes
      FROM agenda a
      LEFT JOIN agenda_adolescentes aa ON a.id = aa.agenda_id
      LEFT JOIN adolescentes ad ON aa.adolescente_id = ad.id
      WHERE a.data = $1
      GROUP BY a.id ORDER BY a.hora
    `, [req.params.data]);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

router.post('/', async (req, res) => {
  const { data, hora, tipo, carater, modalidade, escolta, viatura, observacao, registrado_por, adolescentes } = req.body;
  if (!hora || !tipo) return res.status(400).json({ ok: false, erro: 'Hora e tipo obrigatórios' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO agenda (data, hora, tipo, carater, modalidade, escolta, viatura, observacao, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [data, hora, tipo, carater||'Externa', modalidade||'Presencial', escolta||null, viatura||null, observacao||null, registrado_por||null]
    );
    const agenda_id = r.rows[0].id;
    if (adolescentes && adolescentes.length > 0) {
      for (const aid of adolescentes) {
        await client.query('INSERT INTO agenda_adolescentes (agenda_id, adolescente_id) VALUES ($1,$2)', [agenda_id, aid]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, erro: err.message });
  } finally { client.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM agenda WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
