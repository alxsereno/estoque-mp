# Estoque MP v2 — Sistema de Controle de Matéria-Prima

## O que mudou da v1 pra v2

**v1:** toda entrada gerava uma etiqueta impressa com código de lote para cada
embalagem recebida; a saída era feita lendo essa etiqueta.

**v2:**
- Ao **receber** matéria-prima, o operador lê o código de barras que já vem
  de fábrica na embalagem do fornecedor. O sistema associa esse código a um
  produto interno (ex: código externo do fornecedor → produto interno "001 —
  Feijão Carioca"). Essa associação é feita **uma vez** e fica salva — nas
  próximas entradas o mesmo código já é reconhecido automaticamente.
- Um produto pode ter **vários códigos de barras** associados (embalagens ou
  fornecedores diferentes), cada um com seu próprio fator de conversão
  (ex: pacote de 5kg vs saco de 25kg).
- Cada entrada gera um **lote** (controla validade e custo), sem precisar
  imprimir etiqueta.
- Etiqueta com código de lote só é oferecida quando o produto/entrada
  **não** tem código de barras de fábrica — aí sim ela é necessária para
  a saída conseguir "ler" o lote depois.
- Na **saída**, o operador lê o código de barras do produto; o sistema
  mostra os lotes disponíveis daquele produto (sugerindo o mais antigo —
  FIFO), o operador escolhe o lote e informa a quantidade retirada.
- Conversão de unidade de compra → unidade de estoque é automática
  (ex: 10 pacotes × 5kg = 50kg entram no estoque).
- Dashboard: valor de estoque por categoria, lotes próximos do vencimento,
  valor das baixas do dia.

---

## Como publicar no Railway (passo a passo sem conhecimento técnico)

### Pré-requisitos
- Conta Google (para login)
- Os arquivos: `server.js`, `package.json`, `schema.sql`, `README.md` e a pasta `public/` com `index.html` dentro

### PASSO 1 — Repositório no GitHub
No mesmo repositório que você já usa (`estoque-mp`), **substitua** os arquivos:
1. `server.js` → substitua pelo novo
2. `schema.sql` → substitua pelo novo
3. `package.json` → substitua pelo novo (só mudou a versão)
4. `public/index.html` → substitua pelo novo (se seu repo tinha `index.html` na raiz, mova para dentro de `public/`)

### PASSO 2 — Atualizar o banco de dados
1. No Railway, clique no serviço **PostgreSQL** → aba **Data** → **Query**
2. Cole o conteúdo do novo `schema.sql` e clique **Run**
   - Isso cria as tabelas novas (`produto_codigos`, `lotes` com a nova
     estrutura, etc.) sem apagar `produtos` e `fornecedores` já existentes,
     que continuam com a mesma estrutura.
   - **Atenção:** a tabela `lotes` da v1 tinha colunas diferentes. Se você
     já tem lotes/embalagens da v1 e quer preservar o histórico, renomeie a
     tabela antiga antes de rodar o schema novo:
     ```sql
     ALTER TABLE lotes RENAME TO lotes_v1_bkp;
     ALTER TABLE embalagens RENAME TO embalagens_v1_bkp;
     ```
     Depois rode o `schema.sql` normalmente. Os produtos e fornecedores da
     v1 continuam valendo — não precisa recadastrar.

### PASSO 3 — Redeploy no Railway
Railway detecta o push no GitHub e reimplanta automaticamente. Se não subir
sozinho, vá no serviço Node.js → **Deployments** → **Redeploy**.

### PASSO 4 — Acessar o sistema
Mesma URL de antes: `estoque-mp-production.up.railway.app`

---

## Estrutura de arquivos

```
estoque-mp/
├── server.js        ← API Node.js (backend)
├── package.json      ← dependências
├── schema.sql        ← criar/atualizar tabelas no banco
├── README.md          ← este arquivo
└── public/
    └── index.html    ← o sistema (frontend)
```

## Fluxo de uso resumido

**Entrada:** Menu "Entrada" → escaneia código de barras → se novo, associa a
um produto cadastrado (unidade de compra + fator de conversão) → preenche
fornecedor, validade, preço, NF → salva. Se o produto não tinha código de
barras, o sistema oferece gerar etiqueta do lote.

**Saída:** Menu "Saída" → escaneia código de barras (ou etiqueta do lote) →
sistema mostra lotes disponíveis (mais antigo primeiro) → operador escolhe o
lote e informa a quantidade → confirma.

## Suporte
Em caso de dúvidas, consulte: **docs.railway.app**
