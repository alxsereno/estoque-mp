-- ═══════════════════════════════════════════════════════════
--  ESTOQUE MP v2 — Schema PostgreSQL
--  Rode este arquivo no banco do Railway para criar/atualizar as tabelas
--
--  Este script é seguro de rodar MAIS DE UMA VEZ, mesmo que uma
--  execução anterior tenha parado no meio do caminho: toda tabela usa
--  CREATE TABLE IF NOT EXISTS e, em seguida, ADD COLUMN IF NOT EXISTS
--  para cada coluna — então mesmo uma tabela "incompleta" de uma
--  tentativa anterior é corrigida para o formato certo antes de
--  criarmos qualquer índice ou dado.
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
CREATE TABLE IF NOT EXISTS categorias (id SERIAL PRIMARY KEY);
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS nome VARCHAR(100);
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS cor VARCHAR(20);
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categorias_nome_key') THEN
    ALTER TABLE categorias ADD CONSTRAINT categorias_nome_key UNIQUE (nome);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS produtos (id SERIAL PRIMARY KEY);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codigo VARCHAR(50);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao VARCHAR(300);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unidade VARCHAR(10) DEFAULT 'kg';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC(12,4);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_maximo NUMERIC(12,4);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS origem VARCHAR(20) DEFAULT 'manual';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_codigo_key') THEN
    ALTER TABLE produtos ADD CONSTRAINT produtos_codigo_key UNIQUE (codigo);
  END IF;
END $$;
-- se ainda existir a coluna antiga de texto livre "categoria", migra os dados e remove
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='produtos' AND column_name='categoria') THEN
    INSERT INTO categorias (nome)
    SELECT DISTINCT categoria FROM produtos
    WHERE categoria IS NOT NULL AND btrim(categoria) <> ''
    ON CONFLICT (nome) DO NOTHING;

    UPDATE produtos p SET categoria_id = c.id
    FROM categorias c
    WHERE c.nome = p.categoria AND p.categoria_id IS NULL;

    ALTER TABLE produtos DROP COLUMN categoria;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fornecedores (id SERIAL PRIMARY KEY);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS nome VARCHAR(200);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS razao VARCHAR(200);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cnpj VARCHAR(20);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS telefone VARCHAR(30);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS email VARCHAR(100);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS contato VARCHAR(100);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS obs TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS origem VARCHAR(20) DEFAULT 'manual';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- Mapeamento código de barras (de fábrica/fornecedor) → produto interno.
CREATE TABLE IF NOT EXISTS produto_codigos (id SERIAL PRIMARY KEY);
ALTER TABLE produto_codigos ADD COLUMN IF NOT EXISTS produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE;
ALTER TABLE produto_codigos ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(80);
ALTER TABLE produto_codigos ADD COLUMN IF NOT EXISTS fornecedor_id INTEGER REFERENCES fornecedores(id);
ALTER TABLE produto_codigos ADD COLUMN IF NOT EXISTS descricao_embalagem VARCHAR(200);
ALTER TABLE produto_codigos ADD COLUMN IF NOT EXISTS unidade_compra VARCHAR(20) DEFAULT 'un';
ALTER TABLE produto_codigos ADD COLUMN IF NOT EXISTS fator_conversao NUMERIC(12,4) DEFAULT 1;
ALTER TABLE produto_codigos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produto_codigos_codigo_barras_key') THEN
    ALTER TABLE produto_codigos ADD CONSTRAINT produto_codigos_codigo_barras_key UNIQUE (codigo_barras);
  END IF;
END $$;

-- Cada entrada de matéria-prima = 1 lote. É a unidade de controle de estoque.
CREATE TABLE IF NOT EXISTS lotes (id SERIAL PRIMARY KEY);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS codigo_lote VARCHAR(50);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS produto_id INTEGER REFERENCES produtos(id);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS produto_codigo_id INTEGER REFERENCES produto_codigos(id);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS fornecedor_id INTEGER REFERENCES fornecedores(id);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS quantidade_comprada NUMERIC(12,4);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS unidade_compra VARCHAR(20);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS fator_conversao NUMERIC(12,4) DEFAULT 1;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS quantidade_total NUMERIC(12,4);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS quantidade_atual NUMERIC(12,4);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS unidade VARCHAR(10);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS data_entrada DATE DEFAULT CURRENT_DATE;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS data_validade DATE;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS preco_unitario NUMERIC(12,4);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS numero_nf VARCHAR(50);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS total_nf NUMERIC(12,2);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS possui_codigo_barras BOOLEAN DEFAULT TRUE;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS etiqueta_impressa BOOLEAN DEFAULT FALSE;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'disponivel';
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS origem VARCHAR(20) DEFAULT 'manual';
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lotes_codigo_lote_key') THEN
    ALTER TABLE lotes ADD CONSTRAINT lotes_codigo_lote_key UNIQUE (codigo_lote);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS movimentacoes (id SERIAL PRIMARY KEY);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS data DATE DEFAULT CURRENT_DATE;
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS tipo VARCHAR(20);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS lote_id INTEGER REFERENCES lotes(id);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS codigo_lote VARCHAR(50);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS produto_id INTEGER REFERENCES produtos(id);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS produto VARCHAR(300);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS quantidade NUMERIC(12,4);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS unidade VARCHAR(10);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS preco_unitario NUMERIC(12,4);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS valor_total NUMERIC(12,2);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS destino VARCHAR(200);
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS obs TEXT;
ALTER TABLE movimentacoes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS ajustes (id SERIAL PRIMARY KEY);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS data VARCHAR(30);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS lote_id INTEGER REFERENCES lotes(id);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS codigo_lote VARCHAR(50);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS produto VARCHAR(300);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS antes NUMERIC(12,4);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS depois NUMERIC(12,4);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS diff NUMERIC(12,4);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS motivo VARCHAR(200);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS obs VARCHAR(200);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS configuracoes (chave VARCHAR(50) PRIMARY KEY, valor TEXT);

-- Usuários do sistema (login por PIN de 4 dígitos)
CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome VARCHAR(120);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(64);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'operador';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_pin_hash_key') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_pin_hash_key UNIQUE (pin_hash);
  END IF;
END $$;
-- usuário admin padrão, PIN inicial 0000 — troque assim que possível em Usuários
INSERT INTO usuarios (nome, pin_hash, role) VALUES
  ('Admin', '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0', 'admin')
ON CONFLICT (pin_hash) DO NOTHING;

-- Unidades de medida cadastráveis (usadas nos selects de unidade de compra)
CREATE TABLE IF NOT EXISTS unidades (id SERIAL PRIMARY KEY);
ALTER TABLE unidades ADD COLUMN IF NOT EXISTS sigla VARCHAR(10);
ALTER TABLE unidades ADD COLUMN IF NOT EXISTS nome VARCHAR(50);
ALTER TABLE unidades ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unidades_sigla_key') THEN
    ALTER TABLE unidades ADD CONSTRAINT unidades_sigla_key UNIQUE (sigla);
  END IF;
END $$;
INSERT INTO unidades (sigla, nome) VALUES
  ('kg','Quilograma'), ('g','Grama'), ('l','Litro'), ('ml','Mililitro'),
  ('un','Unidade'), ('pct','Pacote'), ('cx','Caixa'), ('sc','Saco'), ('dz','Dúzia')
ON CONFLICT (sigla) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- CORREÇÃO DE TIPOS HERDADOS DA v1: nas tabelas lotes/movimentacoes,
-- algumas colunas já existiam (criadas pela v1) com tipo TEXTO em vez
-- do tipo correto da v2 (INTEGER/DATE/NUMERIC) — isso quebra os JOINs
-- e cálculos ("operator does not exist: integer = character varying").
-- Este bloco corrige o tipo apenas se ainda estiver errado; se a coluna
-- já estiver certa, não faz nada. Valores que não conseguem ser
-- convertidos viram NULL (mais seguro que travar a migração).
-- ═══════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lotes' AND column_name='produto_id' AND data_type <> 'integer') THEN
    ALTER TABLE lotes ALTER COLUMN produto_id TYPE INTEGER USING (
      CASE WHEN produto_id::text ~ '^[0-9]+$' THEN produto_id::text::INTEGER ELSE NULL END
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lotes' AND column_name='data_entrada' AND data_type <> 'date') THEN
    ALTER TABLE lotes ALTER COLUMN data_entrada TYPE DATE USING (
      CASE WHEN data_entrada::text ~ '^\d{4}-\d{2}-\d{2}$' THEN data_entrada::text::DATE ELSE CURRENT_DATE END
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lotes' AND column_name='data_validade' AND data_type <> 'date') THEN
    ALTER TABLE lotes ALTER COLUMN data_validade TYPE DATE USING (
      CASE WHEN data_validade::text ~ '^\d{4}-\d{2}-\d{2}$' THEN data_validade::text::DATE ELSE NULL END
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='movimentacoes' AND column_name='data' AND data_type <> 'date') THEN
    ALTER TABLE movimentacoes ALTER COLUMN data TYPE DATE USING (
      CASE WHEN data::text ~ '^\d{4}-\d{2}-\d{2}$' THEN data::text::DATE ELSE CURRENT_DATE END
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='movimentacoes' AND column_name='quantidade' AND data_type NOT IN ('numeric','double precision','integer')) THEN
    ALTER TABLE movimentacoes ALTER COLUMN quantidade TYPE NUMERIC(12,4) USING (
      CASE WHEN quantidade::text ~ '^[0-9]+(\.[0-9]+)?$' THEN quantidade::text::NUMERIC ELSE NULL END
    );
  END IF;
END $$;

-- Índices para performance (agora seguro: todas as colunas acima já existem)
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
-- PEDIDOS DE COMPRA (planejador cria, operador recebe vinculando
-- código de barras a cada item para garantir a conferência)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pedidos_compra (id SERIAL PRIMARY KEY);
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS fornecedor_id INTEGER REFERENCES fornecedores(id);
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS data_pedido DATE DEFAULT CURRENT_DATE;
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS data_entrega_prevista DATE;
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'aberto';
-- status: aberto (aguardando entrega) | parcial (algo já recebido) | concluido (fechado pelo planejador/admin) | cancelado
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS valor_total NUMERIC(12,2);
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS criado_por INTEGER REFERENCES usuarios(id);
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS obs TEXT;
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS pedido_id INTEGER REFERENCES pedidos_compra(id) ON DELETE CASCADE;
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS produto_id INTEGER REFERENCES produtos(id);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS quantidade_pedida NUMERIC(12,4);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS unidade VARCHAR(10);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS preco_unitario NUMERIC(12,4);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS quantidade_recebida NUMERIC(12,4) DEFAULT 0;
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS lote_id INTEGER REFERENCES lotes(id);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS codigo_barras_conferido VARCHAR(80);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS data_validade DATE;
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS conferido_por INTEGER REFERENCES usuarios(id);
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS conferido_em TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos_compra(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_entrega ON pedidos_compra(data_entrega_prevista);

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
