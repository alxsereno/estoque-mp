const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// IMPORTANTE: defina a variável de ambiente JWT_SECRET no Railway (Variables)
// com um valor aleatório longo. Sem isso, um valor padrão é usado — funciona,
// mas não é seguro para produção.
const JWT_SECRET = process.env.JWT_SECRET || 'estoque-mp-dev-secret-troque-isso';
const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ═══════════════════════════════════════════════════════════
// AUTENTICAÇÃO (login por PIN de 4 dígitos)
// ═══════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { pin } = req.body;
  if(!pin || !/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN deve ter 4 dígitos' });
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, role FROM usuarios WHERE pin_hash = $1 AND ativo = TRUE`,
      [hashPin(pin)]
    );
    if(rows.length === 0) return res.status(401).json({ error: 'PIN incorreto' });
    const usuario = rows[0];
    const token = jwt.sign({ id: usuario.id, nome: usuario.nome, role: usuario.role }, JWT_SECRET, { expiresIn: '16h' });
    res.json({ ok: true, token, usuario });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ ok: true, usuario: { id: payload.id, nome: payload.nome, role: payload.role } });
  } catch(e){ res.status(401).json({ error: 'Sessão expirada, faça login novamente' }); }
});

// Middleware: exige login válido em toda rota /api/*, exceto login/health.
// Ordem importa: precisa vir depois das rotas públicas acima e antes das protegidas abaixo.
app.use('/api', (req, res, next) => {
  if(req.path === '/auth/login' || req.path === '/health') return next();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e){ res.status(401).json({ error: 'Sessão expirada, faça login novamente' }); }
});

function requireAdmin(req, res, next){
  if(!req.usuario || req.usuario.role !== 'admin'){
    return res.status(403).json({ error: 'Apenas administradores podem fazer isso' });
  }
  next();
}
// Admin ou Planejador: gerenciam cadastros de apoio (categorias, unidades,
// parâmetros, pedidos de compra) — Planejador tem acesso total, só não
// gerencia usuários (isso continua exclusivo do requireAdmin acima).
function requireGestor(req, res, next){
  if(!req.usuario || !['admin','planejador'].includes(req.usuario.role)){
    return res.status(403).json({ error: 'Apenas admin ou planejador podem fazer isso' });
  }
  next();
}
const ROLES_VALIDAS = ['admin','planejador','operador'];

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════
// CATEGORIAS
// ═══════════════════════════════════════════════════════════
app.get('/api/categorias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, COUNT(p.id) AS total_produtos
       FROM categorias c LEFT JOIN produtos p ON p.categoria_id = c.id AND p.ativo = TRUE
       GROUP BY c.id ORDER BY c.nome`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/categorias', requireGestor, async (req, res) => {
  const { nome, cor } = req.body;
  if(!nome) return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO categorias (nome, cor) VALUES ($1,$2) RETURNING *`,
      [nome.trim(), cor || null]
    );
    res.json({ ok: true, categoria: rows[0] });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Essa categoria já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/categorias/:id', requireGestor, async (req, res) => {
  const { nome, cor } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE categorias SET nome=$1, cor=$2 WHERE id=$3 RETURNING *`,
      [nome, cor || null, req.params.id]
    );
    res.json({ ok: true, categoria: rows[0] });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Essa categoria já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/categorias/:id', requireGestor, async (req, res) => {
  try {
    // produtos ligados a essa categoria ficam sem categoria (ON DELETE SET NULL)
    await pool.query(`DELETE FROM categorias WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// PRODUTOS
// ═══════════════════════════════════════════════════════════
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.nome AS categoria
       FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.ativo = TRUE ORDER BY p.descricao`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/produtos', async (req, res) => {
  const { codigo, descricao, categoria_id, unidade, estoque_minimo, estoque_maximo } = req.body;
  if(!codigo || !descricao){
    return res.status(400).json({ error: 'Código e descrição são obrigatórios' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (codigo, descricao, categoria_id, unidade, estoque_minimo, estoque_maximo, origem)
       VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING *`,
      [codigo, descricao, categoria_id || null, unidade || 'kg', estoque_minimo || null, estoque_maximo || null]
    );
    res.json({ ok: true, produto: rows[0] });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Código de produto já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/produtos/:id', async (req, res) => {
  const { descricao, categoria_id, unidade, estoque_minimo, estoque_maximo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE produtos SET descricao=$1, categoria_id=$2, unidade=$3, estoque_minimo=$4, estoque_maximo=$5
       WHERE id=$6 RETURNING *`,
      [descricao, categoria_id || null, unidade, estoque_minimo || null, estoque_maximo || null, req.params.id]
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

// Importação em lote de produtos (planilha/CSV já parseado no frontend).
// Cria categorias que ainda não existem, pula produtos com código já cadastrado.
app.post('/api/produtos/importar', requireGestor, async (req, res) => {
  const { produtos: lista } = req.body;
  if(!Array.isArray(lista) || lista.length === 0){
    return res.status(400).json({ error: 'Nenhum produto para importar' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let importados = 0, duplicados = 0, erros = 0;
    const categoriaCache = {};

    for(const item of lista){
      try {
        const codigo = (item.codigo || '').trim();
        const descricao = (item.descricao || '').trim();
        if(!codigo || !descricao){ erros++; continue; }

        const existe = await client.query(`SELECT id FROM produtos WHERE codigo=$1`, [codigo]);
        if(existe.rows.length > 0){ duplicados++; continue; }

        let categoriaId = null;
        const nomeCategoria = (item.categoria || '').trim();
        if(nomeCategoria){
          if(categoriaCache[nomeCategoria.toLowerCase()]){
            categoriaId = categoriaCache[nomeCategoria.toLowerCase()];
          } else {
            const catRes = await client.query(
              `INSERT INTO categorias (nome) VALUES ($1)
               ON CONFLICT (nome) DO UPDATE SET nome=EXCLUDED.nome RETURNING id`,
              [nomeCategoria]
            );
            categoriaId = catRes.rows[0].id;
            categoriaCache[nomeCategoria.toLowerCase()] = categoriaId;
          }
        }

        await client.query(
          `INSERT INTO produtos (codigo, descricao, categoria_id, unidade, estoque_minimo, origem)
           VALUES ($1,$2,$3,$4,$5,'importado')`,
          [codigo, descricao, categoriaId, (item.unidade || 'kg').trim(), item.estoque_minimo || null]
        );
        importados++;
      } catch(e){
        console.error('Erro ao importar produto:', e.message);
        erros++;
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, importados, duplicados, erros, total: lista.length });
  } catch(e){
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════
// FORNECEDORES
// ═══════════════════════════════════════════════════════════
app.get('/api/fornecedores', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM fornecedores WHERE COALESCE(ativo,TRUE) = TRUE ORDER BY nome`);
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

app.put('/api/fornecedores/:id', async (req, res) => {
  const { nome, razao, cnpj, telefone, email, contato, obs } = req.body;
  if(!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      `UPDATE fornecedores SET nome=$1, razao=$2, cnpj=$3, telefone=$4, email=$5, contato=$6, obs=$7
       WHERE id=$8 RETURNING *`,
      [nome, razao||'', cnpj||'', telefone||'', email||'', contato||'', obs||'', req.params.id]
    );
    res.json({ ok: true, fornecedor: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.delete('/api/fornecedores/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE fornecedores SET ativo = FALSE WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
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
              c.nome AS categoria, p.unidade AS produto_unidade
       FROM produto_codigos pc
       JOIN produtos p ON p.id = pc.produto_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
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

app.delete('/api/codigos/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM produto_codigos WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
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
                    c.nome AS categoria, f.nome AS fornecedor_nome
             FROM lotes l
             JOIN produtos p ON p.id = l.produto_id
             LEFT JOIN categorias c ON c.id = p.categoria_id
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
      `SELECT l.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, c.nome AS categoria
       FROM lotes l JOIN produtos p ON p.id = l.produto_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
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
  const { codigo, categoria_id, data_de, data_ate, tipo } = req.query;
  try {
    let q = `SELECT m.*, p.codigo AS produto_codigo, c.nome AS categoria
             FROM movimentacoes m
             LEFT JOIN produtos p ON p.id = m.produto_id
             LEFT JOIN categorias c ON c.id = p.categoria_id
             WHERE 1=1`;
    const vals = [];
    if(codigo){ vals.push('%'+codigo+'%'); q += ` AND (p.codigo ILIKE $${vals.length} OR m.produto ILIKE $${vals.length})`; }
    if(categoria_id){ vals.push(categoria_id); q += ` AND p.categoria_id = $${vals.length}`; }
    if(tipo){ vals.push(tipo); q += ` AND m.tipo = $${vals.length}`; }
    if(data_de){ vals.push(data_de); q += ` AND m.data >= $${vals.length}`; }
    if(data_ate){ vals.push(data_ate); q += ` AND m.data <= $${vals.length}`; }
    q += ` ORDER BY m.id DESC LIMIT 1000`;
    const { rows } = await pool.query(q, vals);
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
      `SELECT COALESCE(c.nome,'Sem categoria') AS categoria,
              SUM(l.quantidade_atual * COALESCE(l.preco_unitario,0)) AS valor,
              SUM(l.quantidade_atual) AS quantidade
       FROM lotes l JOIN produtos p ON p.id=l.produto_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE l.quantidade_atual > 0
       GROUP BY c.nome ORDER BY valor DESC`
    );

    const vencendo = await pool.query(
      `SELECT l.*, p.descricao AS produto_descricao, c.nome AS categoria,
              (l.data_validade - CURRENT_DATE) AS dias_restantes
       FROM lotes l JOIN produtos p ON p.id=l.produto_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE l.quantidade_atual > 0 AND l.data_validade IS NOT NULL
         AND l.data_validade <= CURRENT_DATE + ($1 || ' days')::interval
       ORDER BY l.data_validade ASC`,
      [atencao]
    );

    const baixasHoje = await pool.query(
      `SELECT COALESCE(SUM(valor_total),0) AS valor_total, COALESCE(SUM(quantidade),0) AS quantidade_total, COUNT(*) AS total_movimentacoes
       FROM movimentacoes WHERE tipo='saida' AND data = CURRENT_DATE`
    );

    const entradasHoje = await pool.query(
      `SELECT COALESCE(SUM(valor_total),0) AS valor_total, COALESCE(SUM(quantidade),0) AS quantidade_total, COUNT(*) AS total_movimentacoes
       FROM movimentacoes WHERE tipo='entrada' AND data = CURRENT_DATE`
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
      entradas_hoje: entradasHoje.rows[0],
      limites: { critico, atencao }
    });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// UNIDADES DE MEDIDA
// ═══════════════════════════════════════════════════════════
app.get('/api/unidades', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM unidades ORDER BY nome`);
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/unidades', requireGestor, async (req, res) => {
  const { sigla, nome } = req.body;
  if(!sigla || !nome) return res.status(400).json({ error: 'Sigla e nome são obrigatórios' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO unidades (sigla, nome) VALUES ($1,$2) RETURNING *`,
      [sigla.trim().toLowerCase(), nome.trim()]
    );
    res.json({ ok: true, unidade: rows[0] });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Essa sigla já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/unidades/:id', requireGestor, async (req, res) => {
  try {
    await pool.query(`DELETE FROM unidades WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
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

app.post('/api/config', requireGestor, async (req, res) => {
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
// ═══════════════════════════════════════════════════════════
// USUÁRIOS (login por PIN) — todas as rotas exigem admin
// ═══════════════════════════════════════════════════════════
app.get('/api/usuarios', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, role, ativo, created_at FROM usuarios ORDER BY nome`
    );
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/usuarios', requireAdmin, async (req, res) => {
  const { nome, pin, role } = req.body;
  if(!nome || !pin || !role) return res.status(400).json({ error: 'Nome, PIN e permissão são obrigatórios' });
  if(!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN deve ter exatamente 4 dígitos' });
  if(!ROLES_VALIDAS.includes(role)) return res.status(400).json({ error: 'Permissão inválida' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, pin_hash, role) VALUES ($1,$2,$3) RETURNING id, nome, role, ativo, created_at`,
      [nome.trim(), hashPin(pin), role]
    );
    res.json({ ok: true, usuario: rows[0] });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Esse PIN já está em uso por outro usuário' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/usuarios/:id', requireAdmin, async (req, res) => {
  const { nome, role } = req.body;
  if(!nome || !role) return res.status(400).json({ error: 'Nome e permissão são obrigatórios' });
  if(!ROLES_VALIDAS.includes(role)) return res.status(400).json({ error: 'Permissão inválida' });
  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET nome=$1, role=$2 WHERE id=$3 RETURNING id, nome, role, ativo, created_at`,
      [nome.trim(), role, req.params.id]
    );
    res.json({ ok: true, usuario: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/usuarios/:id/pin', requireAdmin, async (req, res) => {
  const { pin } = req.body;
  if(!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN deve ter exatamente 4 dígitos' });
  try {
    await pool.query(`UPDATE usuarios SET pin_hash=$1 WHERE id=$2`, [hashPin(pin), req.params.id]);
    res.json({ ok: true });
  } catch(e){
    if(e.code === '23505') return res.status(400).json({ error: 'Esse PIN já está em uso por outro usuário' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/usuarios/:id', requireAdmin, async (req, res) => {
  if(String(req.usuario.id) === String(req.params.id)){
    return res.status(400).json({ error: 'Você não pode inativar seu próprio usuário' });
  }
  try {
    const admins = await pool.query(`SELECT COUNT(*) FROM usuarios WHERE role='admin' AND ativo=TRUE`);
    const alvo = await pool.query(`SELECT role FROM usuarios WHERE id=$1`, [req.params.id]);
    if(alvo.rows[0]?.role === 'admin' && parseInt(admins.rows[0].count) <= 1){
      return res.status(400).json({ error: 'Não é possível inativar o último administrador' });
    }
    await pool.query(`UPDATE usuarios SET ativo = FALSE WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// PEDIDOS DE COMPRA
// ═══════════════════════════════════════════════════════════

// Lista pedidos. Por padrão esconde os já fechados (concluido/cancelado),
// a não ser que ?todos=1 seja passado.
app.get('/api/pedidos', async (req, res) => {
  try {
    let q = `SELECT pc.*, f.nome AS fornecedor_nome,
                    (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.pedido_id = pc.id) AS total_itens
             FROM pedidos_compra pc
             LEFT JOIN fornecedores f ON f.id = pc.fornecedor_id`;
    const vals = [];
    if(req.query.todos !== '1'){
      q += ` WHERE pc.status NOT IN ('concluido','cancelado')`;
    }
    q += ` ORDER BY pc.data_entrega_prevista ASC NULLS LAST, pc.id DESC`;
    const { rows } = await pool.query(q, vals);
    res.json(rows);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/api/pedidos/:id', async (req, res) => {
  try {
    const pedRes = await pool.query(
      `SELECT pc.*, f.nome AS fornecedor_nome, f.telefone AS fornecedor_telefone
       FROM pedidos_compra pc LEFT JOIN fornecedores f ON f.id = pc.fornecedor_id
       WHERE pc.id = $1`, [req.params.id]
    );
    if(pedRes.rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    const itensRes = await pool.query(
      `SELECT pi.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao
       FROM pedido_itens pi JOIN produtos p ON p.id = pi.produto_id
       WHERE pi.pedido_id = $1 ORDER BY pi.id`, [req.params.id]
    );
    res.json({ ...pedRes.rows[0], itens: itensRes.rows });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/pedidos', requireGestor, async (req, res) => {
  const { fornecedor_id, data_entrega_prevista, obs, itens } = req.body;
  if(!fornecedor_id || !Array.isArray(itens) || itens.length === 0){
    return res.status(400).json({ error: 'Fornecedor e ao menos um item são obrigatórios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let valorTotal = 0;
    itens.forEach(it => { valorTotal += (parseFloat(it.quantidade_pedida)||0) * (parseFloat(it.preco_unitario)||0); });

    const pedRes = await client.query(
      `INSERT INTO pedidos_compra (fornecedor_id, data_entrega_prevista, obs, valor_total, criado_por, status)
       VALUES ($1,$2,$3,$4,$5,'aberto') RETURNING *`,
      [fornecedor_id, data_entrega_prevista || null, obs || null, valorTotal, req.usuario.id]
    );
    const pedido = pedRes.rows[0];

    for(const it of itens){
      if(!it.produto_id || !it.quantidade_pedida) continue;
      const prodRes = await client.query(`SELECT unidade FROM produtos WHERE id=$1`, [it.produto_id]);
      const unidade = prodRes.rows[0] ? prodRes.rows[0].unidade : (it.unidade || 'kg');
      await client.query(
        `INSERT INTO pedido_itens (pedido_id, produto_id, quantidade_pedida, unidade, preco_unitario)
         VALUES ($1,$2,$3,$4,$5)`,
        [pedido.id, it.produto_id, it.quantidade_pedida, unidade, it.preco_unitario || null]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, pedido });
  } catch(e){
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.put('/api/pedidos/:id', requireGestor, async (req, res) => {
  const { fornecedor_id, data_entrega_prevista, obs } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pedidos_compra SET fornecedor_id=$1, data_entrega_prevista=$2, obs=$3 WHERE id=$4 RETURNING *`,
      [fornecedor_id, data_entrega_prevista || null, obs || null, req.params.id]
    );
    res.json({ ok: true, pedido: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// Fechar/reabrir/cancelar pedido — só admin ou planejador (mesmo depois do
// operador ter recebido os itens e o pedido estar "parcial").
app.patch('/api/pedidos/:id/status', requireGestor, async (req, res) => {
  const { status } = req.body;
  if(!['aberto','parcial','concluido','cancelado'].includes(status)){
    return res.status(400).json({ error: 'Status inválido' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE pedidos_compra SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    res.json({ ok: true, pedido: rows[0] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// Recebimento de um pedido: qualquer usuário logado (inclusive Operador).
// Cada item OBRIGATORIAMENTE precisa de um código de barras lido na hora,
// pra garantir que a conferência física foi feita — mesmo que o produto já
// tenha código conhecido. Gera lote + movimentação de entrada por item, e
// grava/atualiza a associação código→produto. O pedido sempre vira
// "parcial" após qualquer recebimento (só admin/planejador fecham de vez).
app.post('/api/pedidos/:id/receber', async (req, res) => {
  const { itens } = req.body; // [{ item_id, codigo_barras, quantidade_recebida, data_validade }]
  if(!Array.isArray(itens) || itens.length === 0){
    return res.status(400).json({ error: 'Nenhum item para receber' });
  }
  for(const it of itens){
    if(!it.codigo_barras || !String(it.codigo_barras).trim()){
      return res.status(400).json({ error: 'Todo item recebido precisa de um código de barras lido para conferência' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pedRes = await client.query(`SELECT * FROM pedidos_compra WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if(pedRes.rows.length === 0) throw new Error('Pedido não encontrado');
    const pedido = pedRes.rows[0];
    if(['concluido','cancelado'].includes(pedido.status)) throw new Error('Este pedido já foi fechado');

    for(const it of itens){
      const qtd = parseFloat(it.quantidade_recebida);
      if(!qtd || qtd <= 0) continue;

      const itemRes = await client.query(
        `SELECT pi.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, p.unidade AS produto_unidade
         FROM pedido_itens pi JOIN produtos p ON p.id=pi.produto_id
         WHERE pi.id=$1 AND pi.pedido_id=$2`,
        [it.item_id, req.params.id]
      );
      if(itemRes.rows.length === 0) continue;
      const item = itemRes.rows[0];
      const codigo = String(it.codigo_barras).trim();

      // garante/atualiza a associação código de barras → produto (fator 1,
      // já que o pedido é feito na unidade base do produto)
      let produtoCodigoId = null;
      const codExistente = await client.query(`SELECT * FROM produto_codigos WHERE codigo_barras=$1`, [codigo]);
      if(codExistente.rows.length > 0){
        produtoCodigoId = codExistente.rows[0].id;
      } else {
        const novoCod = await client.query(
          `INSERT INTO produto_codigos (codigo_barras, produto_id, fornecedor_id, unidade_compra, fator_conversao)
           VALUES ($1,$2,$3,$4,1) RETURNING id`,
          [codigo, item.produto_id, pedido.fornecedor_id, item.produto_unidade]
        );
        produtoCodigoId = novoCod.rows[0].id;
      }

      const codigoLote = `LOT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${item.produto_codigo}-${Math.floor(Math.random()*900+100)}`;
      const loteRes = await client.query(
        `INSERT INTO lotes
          (codigo_lote, produto_id, produto_codigo_id, fornecedor_id,
           quantidade_comprada, unidade_compra, fator_conversao,
           quantidade_total, quantidade_atual, unidade,
           data_validade, preco_unitario, possui_codigo_barras, status, origem)
         VALUES ($1,$2,$3,$4,$5,$6,1,$5,$5,$6,$7,$8,TRUE,'disponivel','pedido')
         RETURNING *`,
        [codigoLote, item.produto_id, produtoCodigoId, pedido.fornecedor_id,
         qtd, item.produto_unidade, it.data_validade || null, item.preco_unitario]
      );
      const lote = loteRes.rows[0];

      await client.query(
        `INSERT INTO movimentacoes (data, tipo, lote_id, codigo_lote, produto_id, produto, quantidade, unidade, preco_unitario, valor_total, obs)
         VALUES (CURRENT_DATE,'entrada',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [lote.id, lote.codigo_lote, item.produto_id, item.produto_descricao, qtd, item.produto_unidade,
         item.preco_unitario, item.preco_unitario ? item.preco_unitario*qtd : null, `Pedido #${pedido.id}`]
      );

      await client.query(
        `UPDATE pedido_itens SET quantidade_recebida = COALESCE(quantidade_recebida,0) + $1,
           lote_id=$2, codigo_barras_conferido=$3, data_validade=$4, conferido_por=$5, conferido_em=NOW()
         WHERE id=$6`,
        [qtd, lote.id, codigo, it.data_validade || null, req.usuario.id, item.id]
      );
    }

    await client.query(`UPDATE pedidos_compra SET status='parcial' WHERE id=$1 AND status != 'concluido'`, [req.params.id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch(e){
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date() }));

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Estoque MP v2 rodando na porta ${PORT}`));
