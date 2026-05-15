# Estoque MP — Sistema de Controle de Matéria-Prima

## Como publicar no Railway (passo a passo sem conhecimento técnico)

### Pré-requisitos
- Conta Google (para login)
- O arquivo `index.html` do sistema

---

### PASSO 1 — Criar conta no GitHub (gratuito)
1. Acesse **github.com** e clique em **Sign up**
2. Use seu e-mail e crie uma senha
3. Confirme o e-mail

### PASSO 2 — Criar repositório no GitHub
1. Clique no botão **+** (canto superior direito) → **New repository**
2. Nome: `estoque-mp`
3. Marque **Private** (privado)
4. Clique **Create repository**

### PASSO 3 — Fazer upload dos arquivos
1. Na página do repositório, clique em **uploading an existing file**
2. Arraste os arquivos: `server.js`, `package.json`, `schema.sql`, `README.md`
3. Crie uma pasta `public/` e coloque o `index.html` dentro dela
4. Clique **Commit changes**

> **Como criar a pasta public/:**
> Clique em "Add file" → "Create new file" → escreva `public/index.html` no nome
> Cole o conteúdo do arquivo HTML e salve

### PASSO 4 — Criar conta no Railway
1. Acesse **railway.app**
2. Clique **Login** → **Login with GitHub**
3. Autorize o Railway a acessar seu GitHub

### PASSO 5 — Criar projeto no Railway
1. Clique **New Project**
2. Escolha **Deploy from GitHub repo**
3. Selecione o repositório `estoque-mp`
4. Railway detecta automaticamente que é Node.js

### PASSO 6 — Adicionar o banco de dados
1. No projeto, clique **+ New** → **Database** → **Add PostgreSQL**
2. O Railway cria o banco e adiciona a variável `DATABASE_URL` automaticamente

### PASSO 7 — Rodar o schema SQL
1. Clique no serviço **PostgreSQL** no Railway
2. Vá na aba **Data** → **Query**
3. Cole o conteúdo do arquivo `schema.sql` e clique **Run**
4. As tabelas serão criadas automaticamente

### PASSO 8 — Acessar o sistema
1. Clique no serviço Node.js → aba **Settings** → **Domains**
2. Clique **Generate Domain**
3. Sua URL será algo como: `estoque-mp-production.railway.app`
4. Abra essa URL em qualquer navegador da empresa ✓

---

## Estrutura de arquivos

```
estoque-mp/
├── server.js        ← API Node.js (backend)
├── package.json     ← dependências
├── schema.sql       ← criar tabelas no banco
├── README.md        ← este arquivo
└── public/
    └── index.html   ← o sistema (frontend)
```

## Custo estimado

| Plano | Preço | Inclui |
|-------|-------|--------|
| Hobby | ~$5/mês | Node.js + PostgreSQL + domínio HTTPS |

O Railway oferece $5 de crédito gratuito no início.

## Suporte

Em caso de dúvidas, consulte: **docs.railway.app**
