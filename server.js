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
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════
// PRODUTOS
// ═══════════════════════════════════════════════════════════
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM produtos WHERE ativo = TRUE ORDER BY descricao`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/produtos', async (req, res) => {
  const { codigo, descricao, categoria, unidade, estoque_minimo } = req.body;
  if(!codigo || !descricao){
    return res.status(400).json({ error: 'Código e descrição são obrigatórios' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (codigo, descricao, categoria, unidade, estoque_minimo, origem)
       VALUES ($1,$2,$3,$4,$5,'manual') RETURNING *`,
      [codigo, descricao, categoria || null, unidade || 'kg', estoque_minimo || null]
    );
    res.json({ ok: true, produto: rows[0] });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Código de produto já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/produtos/:id', async (req, res) => {
  const { descricao, categoria, unidade, estoque_minimo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE produtos SET descricao=$1, categoria=$2, unidade=$3, estoque_minimo=$4
       WHERE id=$5 RETURNING *`,
      [descricao, categoria, unidade, estoque_minimo, req.params.id]
    );
    res.json({ ok: true, produto: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.delete('/api/produtos/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE produtos SET ativo = FALSE WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// FORNECEDORES
// ═══════════════════════════════════════════════════════════
app.get('/api/fornecedores', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM fornecedores ORDER BY nome`);
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/fornecedores', async (req, res) => {
  const { nome, razao, cnpj, telefone, email, contato, obs } = req.body;
  if(!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO fornecedores (nome, razao, cnpj, telefone, email, contato, obs, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING *`,
      [nome, razao||'', cnpj||'', telefone||'', email||'', contato||'', obs||'']
    );
    res.json({ ok: true, fornecedor: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// CÓDIGOS DE BARRAS (mapeamento código externo → produto interno)
// ═══════════════════════════════════════════════════════════

// Buscar produto por código de barras escaneado (recebimento ou saída)
app.get('/api/codigos/:codigo', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pc.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao,
              p.categoria, p.unidade AS produto_unidade
       FROM produto_codigos pc
       JOIN produtos p ON p.id = pc.produto_id
       WHERE pc.codigo_barras = $1`,
      [req.params.codigo]
    );
    if(rows.length === 0){
      return res.status(404).json({ ok: false, encontrado: false });
    }
    res.json({ ok: true, encontrado: true, ...rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// Listar todos os códigos associados a um produto
app.get('/api/produtos/:id/codigos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pc.*, f.nome AS fornecedor_nome
       FROM produto_codigos pc
       LEFT JOIN fornecedores f ON f.id = pc.fornecedor_id
       WHERE pc.produto_id = $1 ORDER BY pc.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// Associar um novo código de barras a um produto (1º recebimento daquela embalagem)
app.post('/api/codigos', async (req, res) => {
  const { codigo_barras, produto_id, fornecedor_id, descricao_embalagem, unidade_compra, fator_conversao } = req.body;
  if(!produto_id || !unidade_compra || !fator_conversao){
    return res.status(400).json({ error: 'produto_id, unidade_compra e fator_conversao são obrigatórios' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO produto_codigos
        (codigo_barras, produto_id, fornecedor_id, descricao_embalagem, unidade_compra, fator_conversao)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [codigo_barras || null, produto_id, fornecedor_id || null,
       descricao_embalagem || null, unidade_compra, fator_conversao]
    );
    res.json({ ok: true, codigo: rows[0] });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Este código de barras já está associado a um produto' });
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// LOTES (entrada de matéria-prima = 1 lote)
// ═══════════════════════════════════════════════════════════

function gerarCodigoLote(produtoCodigo){
  const d = new Date();
  const ymd = d.toISOString().slice(0,10).replace(/-/g,'');
  const rand = Math.floor(Math.random()*900+100);
  return `LOT-${ymd}-${produtoCodigo}-${rand}`;
}

app.get('/api/lotes', async (req, res) => {
  const { produto_id, status, disponivel } = req.query;
  try {
    let q = `SELECT l.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao,
                    p.categoria, f.nome AS fornecedor_nome
             FROM lotes l
             JOIN produtos p ON p.id = l.produto_id
             LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
             WHERE 1=1`;
    const vals = [];
    if(produto_id){ vals.push(produto_id); q += ` AND l.produto_id = $${vals.length}`; }
    if(status){ vals.push(status); q += ` AND l.status = $${vals.length}`; }
    if(disponivel === '1'){ q += ` AND l.quantidade_atual > 0`; }
    // FIFO: lote que entrou primeiro é sugerido primeiro
    q += ` ORDER BY l.data_entrada ASC, l.id ASC`;
    const { rows } = await pool.query(q, vals);
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// Buscar lote específico pelo código impresso na etiqueta interna
app.get('/api/lotes/by-codigo/:codigo_lote', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, p.categoria
       FROM lotes l JOIN produtos p ON p.id = l.produto_id
       WHERE l.codigo_lote = $1`,
      [req.params.codigo_lote]
    );
    if(rows.length === 0) return res.status(404).json({ ok:false, error: 'Lote não encontrado' });
    res.json({ ok: true, lote: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// Registrar ENTRADA (cria lote + movimentação, faz a conversão de unidade)
app.post('/api/lotes', async (req, res) => {
  const {
    produto_id, produto_codigo_id, fornecedor_id,
    quantidade_comprada, unidade_compra, fator_conversao,
    data_validade, preco_unitario, numero_nf, total_nf,
    possui_codigo_barras
  } = req.body;

  if(!produto_id || !quantidade_comprada || !fator_conversao){
    return res.status(400).json({ error: 'produto_id, quantidade_comprada e fator_conversao são obrigatórios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prodRes = await client.query(`SELECT * FROM produtos WHERE id=$1`, [produto_id]);
    if(prodRes.rows.length === 0) throw new Error('Produto não encontrado');
    const produto = prodRes.rows[0];

    const quantidadeTotal = parseFloat(quantidade_comprada) * parseFloat(fator_conversao);
    const codigoLote = gerarCodigoLote(produto.codigo);

    const loteRes = await client.query(
      `INSERT INTO lotes
        (codigo_lote, produto_id, produto_codigo_id, fornecedor_id,
         quantidade_comprada, unidade_compra, fator_conversao,
         quantidade_total, quantidade_atual, unidade,
         data_validade, preco_unitario, numero_nf, total_nf,
         possui_codigo_barras, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,'disponivel')
       RETURNING *`,
      [codigoLote, produto_id, produto_codigo_id || null, fornecedor_id || null,
       quantidade_comprada, unidade_compra || produto.unidade, fator_conversao,
       quantidadeTotal, produto.unidade,
       data_validade || null, preco_unitario || null, numero_nf || null, total_nf || null,
       possui_codigo_barras !== false]
    );
    const lote = loteRes.rows[0];

    await client.query(
      `INSERT INTO movimentacoes (data, tipo, lote_id, codigo_lote, produto_id, produto, quantidade, unidade, preco_unitario, valor_total, obs)
       VALUES (CURRENT_DATE,'entrada',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [lote.id, lote.codigo_lote, produto_id, produto.descricao, quantidadeTotal, produto.unidade,
       preco_unitario || null, preco_unitario ? (preco_unitario*quantidadeTotal) : null,
       numero_nf ? `NF ${numero_nf}` : null]
    );

    await client.query('COMMIT');
    res.json({ ok: true, lote, precisa_etiqueta: possui_codigo_barras === false });
  } catch(e){
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.patch('/api/lotes/:id/etiqueta-impressa', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE lotes SET etiqueta_impressa = TRUE WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    res.json({ ok: true, lote: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// MOVIMENTAÇÕES (saída / devolução — abate quantidade_atual do lote)
// ═══════════════════════════════════════════════════════════
app.get('/api/movimentacoes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM movimentacoes ORDER BY id DESC LIMIT 1000`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/movimentacoes', async (req, res) => {
  const { tipo, lote_id, quantidade, destino, obs } = req.body;
  if(!tipo || !lote_id || !quantidade){
    return res.status(400).json({ error: 'tipo, lote_id e quantidade são obrigatórios' });
  }
  if(!['saida','devolucao'].includes(tipo)){
    return res.status(400).json({ error: "tipo deve ser 'saida' ou 'devolucao'" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const loteRes = await client.query(
      `SELECT l.*, p.descricao AS produto_descricao FROM lotes l
       JOIN produtos p ON p.id = l.produto_id WHERE l.id=$1 FOR UPDATE`,
      [lote_id]
    );
    if(loteRes.rows.length === 0) throw new Error('Lote não encontrado');
    const lote = loteRes.rows[0];

    const qtd = parseFloat(quantidade);
    if(tipo === 'saida' && qtd > parseFloat(lote.quantidade_atual)){
      throw new Error(`Quantidade insuficiente no lote (disponível: ${lote.quantidade_atual} ${lote.unidade})`);
    }

    const novaQtd = tipo === 'saida'
      ? parseFloat(lote.quantidade_atual) - qtd
      : parseFloat(lote.quantidade_atual) + qtd;

    await client.query(
      `UPDATE lotes SET quantidade_atual=$1, status=$2 WHERE id=$3`,
      [novaQtd, novaQtd <= 0 ? 'esgotado' : 'disponivel', lote_id]
    );

    const valorTotal = lote.preco_unitario ? (lote.preco_unitario * qtd) : null;

    const movRes = await client.query(
      `INSERT INTO movimentacoes (data, tipo, lote_id, codigo_lote, produto_id, produto, quantidade, unidade, preco_unitario, valor_total, destino, obs)
       VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tipo, lote_id, lote.codigo_lote, lote.produto_id, lote.produto_descricao, qtd, lote.unidade,
       lote.preco_unitario, valorTotal, destino || null, obs || null]
    );

    await client.query('COMMIT');
    res.json({ ok: true, movimentacao: movRes.rows[0], quantidade_atual: novaQtd });
  } catch(e){
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════
// AJUSTES
// ═══════════════════════════════════════════════════════════
app.get('/api/ajustes', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ajustes ORDER BY id DESC LIMIT 1000`);
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/ajustes', async (req, res) => {
  const { lote_id, antes, depois, motivo, obs } = req.body;
  if(!lote_id || antes === undefined || depois === undefined){
    return res.status(400).json({ error: 'lote_id, antes e depois são obrigatórios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const loteRes = await client.query(
      `SELECT l.*, p.descricao AS produto_descricao FROM lotes l
       JOIN produtos p ON p.id=l.produto_id WHERE l.id=$1 FOR UPDATE`, [lote_id]
    );
    if(loteRes.rows.length === 0) throw new Error('Lote não encontrado');
    const lote = loteRes.rows[0];
    const diff = parseFloat(depois) - parseFloat(antes);

    await client.query(
      `UPDATE lotes SET quantidade_atual=$1, status=$2 WHERE id=$3`,
      [depois, parseFloat(depois) <= 0 ? 'esgotado' : 'disponivel', lote_id]
    );

    const ajRes = await client.query(
      `INSERT INTO ajustes (data, lote_id, codigo_lote, produto, antes, depois, diff, motivo, obs)
       VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [lote_id, lote.codigo_lote, lote.produto_descricao, antes, depois, diff, motivo||null, obs||null]
    );

    await client.query('COMMIT');
    res.json({ ok: true, ajuste: ajRes.rows[0] });
  } catch(e){
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const cfgRes = await pool.query(`SELECT valor FROM configuracoes WHERE chave='validade'`);
    let critico = 7, atencao = 30;
    if(cfgRes.rows.length){
      try { const v = JSON.parse(cfgRes.rows[0].valor); critico = v.critico; atencao = v.atencao; } catch{}
    }

    const valorPorCategoria = await pool.query(
      `SELECT COALESCE(p.categoria,'Sem categoria') AS categoria,
              SUM(l.quantidade_atual * COALESCE(l.preco_unitario,0)) AS valor,
              SUM(l.quantidade_atual) AS quantidade
       FROM lotes l JOIN produtos p ON p.id=l.produto_id
       WHERE l.quantidade_atual > 0
       GROUP BY p.categoria ORDER BY valor DESC`
    );

    const vencendo = await pool.query(
      `SELECT l.*, p.descricao AS produto_descricao, p.categoria,
              (l.data_validade - CURRENT_DATE) AS dias_restantes
       FROM lotes l JOIN produtos p ON p.id=l.produto_id
       WHERE l.quantidade_atual > 0 AND l.data_validade IS NOT NULL
         AND l.data_validade <= CURRENT_DATE + ($1 || ' days')::interval
       ORDER BY l.data_validade ASC`,
      [atencao]
    );

    const baixasHoje = await pool.query(
      `SELECT COALESCE(SUM(valor_total),0) AS valor_total, COALESCE(SUM(quantidade),0) AS quantidade_total, COUNT(*) AS total_movimentacoes
       FROM movimentacoes WHERE tipo='saida' AND data = CURRENT_DATE`
    );

    const valorTotalEstoque = await pool.query(
      `SELECT COALESCE(SUM(quantidade_atual * COALESCE(preco_unitario,0)),0) AS total FROM lotes WHERE quantidade_atual > 0`
    );

    res.json({
      valor_total_estoque: parseFloat(valorTotalEstoque.rows[0].total),
      valor_por_categoria: valorPorCategoria.rows,
      lotes_vencendo: vencendo.rows.map(r => ({
        ...r,
        criticidade: r.dias_restantes <= critico ? 'critico' : (r.dias_restantes <= atencao ? 'atencao' : 'ok')
      })),
      baixas_hoje: baixasHoje.rows[0],
      limites: { critico, atencao }
    });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════
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
      `INSERT INTO configuracoes (chave, valor) VALUES ($1,$2)
       ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor`,
      [chave, JSON.stringify(valor)]
    );
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date() }));

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Estoque MP v2 rodando na porta ${PORT}`));
