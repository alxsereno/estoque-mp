const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');
const path    = require('path');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ── PRODUTOS ──────────────────────────────────────────────
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, codigo, descricao, categoria, unidade, origem
       FROM produtos ORDER BY descricao`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/produtos', async (req, res) => {
  const { codigo, descricao, categoria, unidade } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (codigo, descricao, categoria, unidade, origem)
       VALUES ($1, $2, $3, $4, 'manual') RETURNING *`,
      [codigo, descricao, categoria, unidade]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.put('/api/produtos/:codigo', async (req, res) => {
  const { descricao, categoria, unidade } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE produtos SET descricao=$1, categoria=$2, unidade=$3
       WHERE codigo=$4 RETURNING *`,
      [descricao, categoria, unidade, req.params.codigo]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.delete('/api/produtos/:codigo', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM produtos WHERE codigo=$1 AND origem='manual'`,
      [req.params.codigo]
    );
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── FORNECEDORES ──────────────────────────────────────────
app.get('/api/fornecedores', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fornecedores ORDER BY nome`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/fornecedores', async (req, res) => {
  const { nome, cnpj, telefone, email, contato, obs } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO fornecedores (nome, cnpj, telefone, email, contato, obs, origem)
       VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING *`,
      [nome, cnpj, telefone, email, contato, obs]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.put('/api/fornecedores/:id', async (req, res) => {
  const { nome, cnpj, telefone, email, contato, obs } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE fornecedores SET nome=$1,cnpj=$2,telefone=$3,email=$4,contato=$5,obs=$6
       WHERE id=$7 RETURNING *`,
      [nome, cnpj, telefone, email, contato, obs, req.params.id]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.delete('/api/fornecedores/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM fornecedores WHERE id=$1 AND origem='manual'`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── LOTES / EMBALAGENS ────────────────────────────────────
app.get('/api/lotes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM lotes ORDER BY data_entrada DESC`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/lotes', async (req, res) => {
  const l = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO lotes
        (codigo_lote, produto_id, produto_descricao, categoria, unidade,
         unidade_emb, tipo_emb, qtd_por_emb, data_entrada, data_validade,
         quantidade_total, fornecedor, numero_nf, total_embalagens,
         tipo_fracionamento, preco_unitario, total_nf)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [l.codigo_lote, l.produto_id, l.produto_descricao, l.categoria,
       l.unidade, l.unidade_emb, l.tipo_emb, l.qtd_por_emb,
       l.data_entrada, l.data_validade, l.quantidade_total,
       l.fornecedor, l.numero_nf, l.total_embalagens,
       l.tipo_fracionamento, l.preco_unitario, l.total_nf]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/api/embalagens', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM embalagens ORDER BY id`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/embalagens', async (req, res) => {
  const e = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO embalagens
        (codigo, lote_id, codigo_lote, produto_id, produto_descricao,
         categoria, unidade, tipo, quantidade, quantidade_atual,
         data_validade, impressa, status, is_residuo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [e.codigo, e.lote_id, e.codigo_lote, e.produto_id,
       e.produto_descricao, e.categoria, e.unidade, e.tipo,
       e.quantidade, e.quantidade_atual, e.data_validade,
       e.impressa||false, e.status||'disponivel', e.is_residuo||false]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.patch('/api/embalagens/:id', async (req, res) => {
  const fields = req.body;
  const sets   = Object.keys(fields).map((k,i) => `${k}=$${i+2}`).join(',');
  const vals   = Object.values(fields);
  try {
    const { rows } = await pool.query(
      `UPDATE embalagens SET ${sets} WHERE id=$1 RETURNING *`,
      [req.params.id, ...vals]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── MOVIMENTAÇÕES ─────────────────────────────────────────
app.get('/api/movimentacoes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM movimentacoes ORDER BY id DESC LIMIT 1000`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/movimentacoes', async (req, res) => {
  const m = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO movimentacoes (data, tipo, produto, codigo, lote, quantidade, destino)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [m.data, m.tipo, m.produto, m.codigo, m.lote, m.quantidade, m.destino]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── AJUSTES ───────────────────────────────────────────────
app.get('/api/ajustes', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ajustes ORDER BY id DESC`);
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/ajustes', async (req, res) => {
  const a = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ajustes (data, codigo, produto, lote, antes, depois, diff, motivo, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [a.data, a.codigo, a.produto, a.lote, a.antes, a.depois, a.diff, a.motivo, a.obs]
    );
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── CONFIGURAÇÕES ─────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT chave, valor FROM configuracoes`);
    const cfg = {};
    rows.forEach(r => { try{ cfg[r.chave] = JSON.parse(r.valor); }catch{ cfg[r.chave] = r.valor; } });
    res.json(cfg);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/config', async (req, res) => {
  const { chave, valor } = req.body;
  try {
    await pool.query(
      `INSERT INTO configuracoes (chave, valor)
       VALUES ($1,$2)
       ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor`,
      [chave, JSON.stringify(valor)]
    );
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});



// ── BUSCAR DADOS DO BANCO ───────────────────────────────────
app.get('/api/embalagens', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM embalagens ORDER BY id DESC LIMIT 1000'
    );
    res.json(result.rows);
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/lotes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM lotes ORDER BY id DESC LIMIT 1000'
    );
    res.json(result.rows);
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/movimentacoes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM movimentacoes ORDER BY id DESC LIMIT 1000'
    );
    res.json(result.rows);
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ajustes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ajustes ORDER BY id DESC LIMIT 1000'
    );
    res.json(result.rows);
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// ── IMPORTAR DADOS ───────────────────────────────────
app.post('/api/importar-lotes', async (req, res) => {
  const { lotes } = req.body;
  
  if(!Array.isArray(lotes) || lotes.length === 0){
    return res.status(400).json({ error: 'Nenhum lote para importar' });
  }
  
  try {
    let importados = 0;
    let duplicados = 0;
    let erros = 0;
    
    for(const lote of lotes){
      try {
        // Verificar se já existe
        const existe = await pool.query(
          'SELECT id FROM embalagens WHERE codigo = $1',
          [lote.codigo]
        );
        
        if(existe.rows.length > 0){
          duplicados++;
          continue;
        }
        
        // Inserir novo lote (CAMPOS QUE EXISTEM NA TABELA)
        await pool.query(
          `INSERT INTO embalagens
            (codigo, codigo_lote, produto_descricao, categoria, quantidade,
             quantidade_atual, unidade, data_validade, status, is_residuo, impressa)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            lote.codigo,
            lote.codigo_lote,
            lote.produto_descricao,
            lote.categoria,
            lote.quantidade,
            lote.quantidade,
            lote.unidade,
            lote.data_validade,
            lote.status || 'disponivel',
            lote.is_residuo || false,
            true
          ]
        );
        
        importados++;
      } catch(e){
        console.error('Erro ao importar lote:', e.message);
        erros++;
      }
    }
    
    res.json({
      ok: true,
      importados,
      duplicados,
      erros,
      total: importados + duplicados + erros
    });
    
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// ── FRONTEND (catch-all) ──────────────────────────────────
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Estoque MP rodando na porta ${PORT}`));
