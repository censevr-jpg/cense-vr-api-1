const express = require('express');
const router = express.Router();
const { pool } = require('../database');

// Buscar frequência por data
router.get('/:data', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT f.*, a.nome as adolescente_nome, a.prontuario,
             t.nome as turma_nome, e.nome as escola_nome, m.nome as modulo_nome
      FROM frequencia f
      JOIN adolescentes a ON f.adolescente_id = a.id
      LEFT JOIN turmas t ON f.turma_id = t.id
      LEFT JOIN escolas e ON t.escola_id = e.id
      LEFT JOIN modulos m ON a.modulo_id = m.id
      WHERE f.data = $1
      ORDER BY e.nome, t.nome, a.nome
    `, [req.params.data]);
    res.json({ ok: true, dados: r.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// Registrar frequência
router.post('/', async (req, res) => {
  const { adolescente_id, turma_id, data, status, motivo, registrado_por } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO frequencia (adolescente_id, turma_id, data, status, motivo, registrado_por)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (adolescente_id, data)
      DO UPDATE SET status=$4, motivo=$5, registrado_por=$6, criado_em=NOW()
      RETURNING *
    `, [adolescente_id, turma_id||null, data, status, motivo||null, registrado_por||null]);
    res.json({ ok: true, dados: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// Cancelar turma (marcar todos como ausente)
router.post('/cancelar-turma', async (req, res) => {
  const { turma_id, data, motivo, registrado_por } = req.body;
  try {
    // Registrar cancelamento
    await pool.query(`
      INSERT INTO cancelamento_turma (turma_id, data, cancelada, motivo)
      VALUES ($1,$2,true,$3)
      ON CONFLICT (turma_id, data) DO UPDATE SET cancelada=true, motivo=$3
    `, [turma_id, data, motivo||null]);

    // Marcar todos alunos da turma como ausente
    const alunos = await pool.query(
      'SELECT id FROM adolescentes WHERE turma_id=$1 AND (situacao=$2 OR situacao IS NULL)',
      [turma_id, 'ativo']
    );
    for (const aluno of alunos.rows) {
      await pool.query(`
        INSERT INTO frequencia (adolescente_id, turma_id, data, status, motivo, auto_cancelamento, registrado_por)
        VALUES ($1,$2,$3,'ausente',$4,true,$5)
        ON CONFLICT (adolescente_id, data) DO UPDATE SET status='ausente', motivo=$4, auto_cancelamento=true
      `, [aluno.id, turma_id, data, motivo||'Cancelamento de turma', registrado_por||null]);
    }
    res.json({ ok: true, total: alunos.rows.length });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// Controle de aula por escola
router.post('/controle-aula', async (req, res) => {
  const { escola_id, data, haula, motivo_sem_aula } = req.body;
  try {
    await pool.query(`
      INSERT INTO controle_aula (escola_id, data, haula, motivo_sem_aula)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (escola_id, data) DO UPDATE SET haula=$3, motivo_sem_aula=$4
    `, [escola_id, data, haula, motivo_sem_aula||null]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

// Buscar controles de aula por data
router.get('/controle/:data', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM controle_aula WHERE data = $1', [req.params.data]);
    const c = await pool.query('SELECT * FROM cancelamento_turma WHERE data = $1', [req.params.data]);
    res.json({ ok: true, controles: r.rows, cancelamentos: c.rows });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

module.exports = router;
