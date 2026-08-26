-- ═══════════════════════════════════════════════════════════
--  ESTOQUE MP v2 — Schema PostgreSQL
--  Rode este arquivo no banco do Railway para criar/atualizar as tabelas
--
--  Mudança de lógica em relação à v1:
--  - Não existe mais "embalagens" (1 etiqueta por unidade recebida).
--  - Cada entrada de matéria-prima gera 1 LOTE, que já é a unidade de
--    controle de estoque (quantidade_atual vai sendo abatida nas saídas).
--  - Um PRODUTO pode ter vários códigos de barras de fornecedor
--    associados (produto_codigos), cada um com seu próprio fator de
--    conversão (ex: pacote 5kg vs saco 25kg do mesmo fornecedor).
--  - Etiqueta interna (com código do lote) só é gerada quando o
--    produto/entrada não tem código de barras de fábrica.
-- ═══════════════════════════════════════════════════════════

-- Categorias cadastradas pelo usuário (tela de Configurações)
CREATE TABLE IF NOT EXISTS categorias (
  id         SERIAL PRIMARY KEY,
  nome       VARCHAR(100) UNIQUE NOT NULL,
  cor        VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS produtos (
  id         SERIAL PRIMARY KEY,
  codigo     VARCHAR(50)  UNIQUE NOT NULL,   -- código interno (ex: 001)
  descricao  VARCHAR(300) NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  unidade    VARCHAR(10)  NOT NULL DEFAULT 'kg', -- unidade BASE de controle de estoque
  estoque_minimo NUMERIC(12,4),
  origem     VARCHAR(20) DEFAULT 'manual',
  ativo      BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
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
  origem    VARCHAR(20) DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Mapeamento código de barras (de fábrica/fornecedor) → produto interno.
-- Um mesmo produto pode ter N códigos (embalagens/fornecedores diferentes),
-- cada um com seu próprio fator de conversão para a unidade base do produto.
CREATE TABLE IF NOT EXISTS produto_codigos (
  id                  SERIAL PRIMARY KEY,
  produto_id          INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  codigo_barras       VARCHAR(80) UNIQUE NOT NULL,
  fornecedor_id       INTEGER REFERENCES fornecedores(id),
  descricao_embalagem VARCHAR(200),          -- ex: "Pacote 5kg", "Saco 25kg"
  unidade_compra      VARCHAR(20) NOT NULL DEFAULT 'un', -- ex: pacote, saco, caixa, kg
  fator_conversao     NUMERIC(12,4) NOT NULL DEFAULT 1,  -- 1 unidade_compra = X unidade base do produto
  created_at          TIMESTAMP DEFAULT NOW()
);

-- Cada entrada de matéria-prima = 1 lote. É a unidade de controle de
-- estoque (substitui as "embalagens" individuais da v1).
CREATE TABLE IF NOT EXISTS lotes (
  id                   SERIAL PRIMARY KEY,
  codigo_lote          VARCHAR(50) UNIQUE NOT NULL,
  produto_id           INTEGER NOT NULL REFERENCES produtos(id),
  produto_codigo_id    INTEGER REFERENCES produto_codigos(id), -- código de barras usado nesta entrada (se houver)
  fornecedor_id        INTEGER REFERENCES fornecedores(id),
  quantidade_comprada  NUMERIC(12,4),          -- na unidade de compra (ex: 10 pacotes)
  unidade_compra       VARCHAR(20),
  fator_conversao      NUMERIC(12,4) DEFAULT 1,
  quantidade_total     NUMERIC(12,4) NOT NULL, -- já convertida p/ unidade base (ex: 50 kg)
  quantidade_atual     NUMERIC(12,4) NOT NULL, -- vai sendo abatida nas saídas
  unidade               VARCHAR(10),
  data_entrada         DATE DEFAULT CURRENT_DATE,
  data_validade        DATE,
  preco_unitario       NUMERIC(12,4),          -- preço por unidade BASE (para custo/valor de estoque)
  numero_nf            VARCHAR(50),
  total_nf              NUMERIC(12,2),
  possui_codigo_barras BOOLEAN DEFAULT TRUE,   -- FALSE = precisa etiqueta interna p/ ser lido na saída
  etiqueta_impressa    BOOLEAN DEFAULT FALSE,
  status               VARCHAR(20) DEFAULT 'disponivel', -- disponivel, esgotado
  origem                VARCHAR(20) DEFAULT 'manual',
  created_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id             SERIAL PRIMARY KEY,
  data           DATE DEFAULT CURRENT_DATE,
  tipo           VARCHAR(20) NOT NULL,   -- entrada, saida, devolucao
  lote_id        INTEGER REFERENCES lotes(id),
  codigo_lote    VARCHAR(50),
  produto_id     INTEGER REFERENCES produtos(id),
  produto        VARCHAR(300),
  quantidade     NUMERIC(12,4),
  unidade        VARCHAR(10),
  preco_unitario NUMERIC(12,4),
  valor_total    NUMERIC(12,2),
  destino        VARCHAR(200),
  obs            TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ajustes (
  id         SERIAL PRIMARY KEY,
  data       VARCHAR(30),
  lote_id    INTEGER REFERENCES lotes(id),
  codigo_lote VARCHAR(50),
  produto    VARCHAR(300),
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
CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_lotes_produto    ON lotes(produto_id);
CREATE INDEX IF NOT EXISTS idx_lotes_status      ON lotes(status);
CREATE INDEX IF NOT EXISTS idx_lotes_validade    ON lotes(data_validade);
CREATE INDEX IF NOT EXISTS idx_codigos_produto   ON produto_codigos(produto_id);
CREATE INDEX IF NOT EXISTS idx_mov_tipo          ON movimentacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_mov_data          ON movimentacoes(data);
CREATE INDEX IF NOT EXISTS idx_mov_lote          ON movimentacoes(lote_id);

-- Configurações padrão
INSERT INTO configuracoes (chave, valor) VALUES
  ('validade',  '{"critico":7,"atencao":30}'),
  ('etiqueta',  '{"larguraMm":100,"alturaMm":60,"dpi":203}')
ON CONFLICT (chave) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- MIGRAÇÃO: se você já rodou uma versão anterior deste schema.sql
-- (v2 inicial, com produtos.categoria como texto livre), este bloco
-- converte automaticamente para a nova estrutura com categoria_id,
-- sem perder os dados já cadastrados. É seguro rodar mesmo em banco
-- novo (não faz nada se as colunas já estiverem certas).
-- ═══════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='produtos' AND column_name='categoria'
  ) THEN
    -- garante que categoria_id existe
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='produtos' AND column_name='categoria_id'
    ) THEN
      ALTER TABLE produtos ADD COLUMN categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL;
    END IF;

    -- cria uma categoria para cada valor de texto distinto já usado
    INSERT INTO categorias (nome)
    SELECT DISTINCT categoria FROM produtos
    WHERE categoria IS NOT NULL AND btrim(categoria) <> ''
    ON CONFLICT (nome) DO NOTHING;

    -- associa cada produto à categoria correspondente
    UPDATE produtos p SET categoria_id = c.id
    FROM categorias c
    WHERE c.nome = p.categoria AND p.categoria_id IS NULL;

    -- remove a coluna antiga de texto livre (dado já preservado em categoria_id)
    ALTER TABLE produtos DROP COLUMN categoria;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- MIGRAÇÃO A PARTIR DA v1 (opcional)
-- Se você já tem dados na v1 (produtos, fornecedores, lotes, embalagens)
-- e quer aproveitar produtos/fornecedores, rode isto DEPOIS de criar
-- as tabelas acima e ANTES de derrubar as tabelas antigas:
--
--   ALTER TABLE lotes RENAME TO lotes_v1_bkp;   -- se for recriar do zero
--   (produtos e fornecedores já usam a mesma estrutura, não precisa migrar)
--
-- Não fazemos isso automaticamente aqui para evitar apagar dados por
-- engano — rode manualmente com calma, olhando os dados antes.
-- ═══════════════════════════════════════════════════════════
