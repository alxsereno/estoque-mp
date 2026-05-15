-- ═══════════════════════════════════════════════════════════
--  ESTOQUE MP — Schema PostgreSQL
--  Rode este arquivo no banco do Railway para criar as tabelas
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS produtos (
  id        SERIAL PRIMARY KEY,
  codigo    VARCHAR(50)  UNIQUE NOT NULL,
  descricao VARCHAR(300) NOT NULL,
  categoria VARCHAR(100),
  unidade   VARCHAR(10),
  origem    VARCHAR(20) DEFAULT 'importado'
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id        SERIAL PRIMARY KEY,
  nome      VARCHAR(200) NOT NULL,
  razao     VARCHAR(200),
  cnpj      VARCHAR(20),
  telefone  VARCHAR(30),
  email     VARCHAR(100),
  contato   VARCHAR(100),
  obs       TEXT,
  origem    VARCHAR(20) DEFAULT 'importado'
);

CREATE TABLE IF NOT EXISTS lotes (
  id                 SERIAL PRIMARY KEY,
  codigo_lote        VARCHAR(50) UNIQUE NOT NULL,
  produto_id         VARCHAR(50),
  produto_descricao  VARCHAR(300),
  categoria          VARCHAR(100),
  unidade            VARCHAR(10),
  unidade_emb        VARCHAR(10),
  tipo_emb           VARCHAR(50),
  qtd_por_emb        NUMERIC(12,4),
  data_entrada       VARCHAR(20),
  data_validade      VARCHAR(20),
  quantidade_total   NUMERIC(12,4),
  fornecedor         VARCHAR(200),
  numero_nf          VARCHAR(50),
  total_embalagens   INTEGER,
  tipo_fracionamento VARCHAR(20),
  preco_unitario     NUMERIC(12,4),
  total_nf           NUMERIC(12,2),
  created_at         TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embalagens (
  id                 SERIAL PRIMARY KEY,
  codigo             VARCHAR(80) UNIQUE NOT NULL,
  lote_id            INTEGER REFERENCES lotes(id),
  codigo_lote        VARCHAR(50),
  produto_id         VARCHAR(50),
  produto_descricao  VARCHAR(300),
  categoria          VARCHAR(100),
  unidade            VARCHAR(10),
  tipo               VARCHAR(50),
  quantidade         NUMERIC(12,4),
  quantidade_atual   NUMERIC(12,4),
  data_validade      VARCHAR(20),
  impressa           BOOLEAN DEFAULT FALSE,
  status             VARCHAR(20) DEFAULT 'disponivel',
  is_residuo         BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id         SERIAL PRIMARY KEY,
  data       VARCHAR(30),
  tipo       VARCHAR(30),
  produto    VARCHAR(300),
  codigo     VARCHAR(80),
  lote       VARCHAR(50),
  quantidade VARCHAR(50),
  destino    VARCHAR(200),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ajustes (
  id         SERIAL PRIMARY KEY,
  data       VARCHAR(30),
  codigo     VARCHAR(80),
  produto    VARCHAR(300),
  lote       VARCHAR(50),
  antes      NUMERIC(12,4),
  depois     NUMERIC(12,4),
  diff       NUMERIC(12,4),
  motivo     VARCHAR(200),
  obs        VARCHAR(200),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave  VARCHAR(50) PRIMARY KEY,
  valor  TEXT
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_emb_status    ON embalagens(status);
CREATE INDEX IF NOT EXISTS idx_emb_produto   ON embalagens(produto_id);
CREATE INDEX IF NOT EXISTS idx_emb_lote      ON embalagens(codigo_lote);
CREATE INDEX IF NOT EXISTS idx_mov_tipo      ON movimentacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_lotes_produto ON lotes(produto_id);

-- Configurações padrão
INSERT INTO configuracoes (chave, valor) VALUES
  ('validade',  '{"critico":7,"atencao":30}'),
  ('etiqueta',  '{"larguraMm":100,"alturaMm":60,"dpi":203}')
ON CONFLICT (chave) DO NOTHING;
