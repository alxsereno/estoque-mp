# 📡 API ENDPOINTS - PostgreSQL Integration

Todos os dados agora são salvos **direto no PostgreSQL** em vez de localStorage.

---

## 🔽 GET - BUSCAR DADOS

### Embalagens
```javascript
fetch('/api/embalagens')
  .then(r => r.json())
  .then(embalagens => {
    console.log('Embalagens:', embalagens); // Array com até 5000 registros
  });
```

### Lotes
```javascript
fetch('/api/lotes')
  .then(r => r.json())
  .then(lotes => console.log('Lotes:', lotes));
```

### Produtos
```javascript
fetch('/api/produtos')
  .then(r => r.json())
  .then(produtos => console.log('Produtos:', produtos));
```

### Fornecedores
```javascript
fetch('/api/fornecedores')
  .then(r => r.json())
  .then(fornecedores => console.log('Fornecedores:', fornecedores));
```

### Movimentações
```javascript
fetch('/api/movimentacoes')
  .then(r => r.json())
  .then(movs => console.log('Movimentações:', movs));
```

### Ajustes
```javascript
fetch('/api/ajustes')
  .then(r => r.json())
  .then(ajustes => console.log('Ajustes:', ajustes));
```

---

## 🔼 POST - CRIAR NOVOS DADOS

### Novo Produto
```javascript
fetch('/api/produtos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    codigo: 'PROD-001',        // Obrigatório, único
    descricao: 'Canela em Pó', // Obrigatório
    categoria: 'Confeitaria',  // Opcional
    unidade: 'kg'              // Opcional
  })
})
.then(r => r.json())
.then(data => {
  if(data.ok){
    console.log('Produto criado:', data.produto);
  } else {
    console.error('Erro:', data.error);
  }
});
```

---

### Novo Fornecedor
```javascript
fetch('/api/fornecedores', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nome: 'TAUSTE SUPERMERCADOS',  // Obrigatório
    razao: 'Tauste Supermercados LTDA',
    cnpj: '12.345.678/0001-90',
    telefone: '(19) 3123-4567',
    email: 'contato@tauste.com.br',
    contato: 'João Silva',
    obs: 'Fornecedor local'
  })
})
.then(r => r.json())
.then(data => {
  if(data.ok){
    console.log('Fornecedor criado:', data.fornecedor);
  } else {
    console.error('Erro:', data.error);
  }
});
```

---

### Nova Movimentação
```javascript
fetch('/api/movimentacoes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    data: '2026-06-09',                    // Opcional, usa data atual se vazio
    tipo: 'saída',                        // Obrigatório: 'entrada', 'saída', 'devolução'
    produto: 'CANELA EM PÓ',              // Opcional
    codigo: 'LOT-20260428-214-001-E01',   // Obrigatório (código da embalagem)
    lote: 'LOT-20260428-214-001',         // Opcional
    quantidade: '0.5',                    // Opcional
    destino: 'Cozinha - Marmita A'        // Opcional
  })
})
.then(r => r.json())
.then(data => {
  if(data.ok){
    console.log('Movimentação registrada:', data.movimentacao);
  } else {
    console.error('Erro:', data.error);
  }
});
```

---

### Novo Ajuste
```javascript
fetch('/api/ajustes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    data: '2026-06-09',                    // Opcional
    codigo: 'LOT-20260428-214-001-E01',   // Obrigatório
    produto: 'CANELA EM PÓ',              // Opcional
    lote: 'LOT-20260428-214-001',         // Opcional
    antes: 0.5,                           // Obrigatório (quantidade anterior)
    depois: 0.3,                          // Obrigatório (quantidade nova)
    motivo: 'Perda por vencimento',       // Opcional
    obs: 'Data expirou em 07/07/2026'     // Opcional
  })
})
.then(r => r.json())
.then(data => {
  if(data.ok){
    console.log('Ajuste registrado:', data.ajuste);
    // A 'diff' é calculada automaticamente: depois - antes = 0.3 - 0.5 = -0.2
  } else {
    console.error('Erro:', data.error);
  }
});
```

---

## 🔌 Como Integrar no HTML Offline

### 1. Quando um usuário cadastra um novo **produto**:
```javascript
// Em vez de: produtos.push({...})
// Faça: 
fetch('/api/produtos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    codigo: codigoInput.value,
    descricao: descricaoInput.value.toUpperCase(),
    categoria: categoriaInput.value,
    unidade: unidadeInput.value
  })
})
.then(r => r.json())
.then(data => {
  if(data.ok){
    produtos.push(data.produto); // Adicionar ao array local também
    salvarAuto(); // Atualizar localStorage (backup)
    toast('✓ Produto criado!');
  }
});
```

### 2. Quando um usuário faz uma **movimentação**:
```javascript
// Registrar a movimentação no banco
fetch('/api/movimentacoes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tipo: tipoMovimento,
    codigo: codigoEmbalagem,
    quantidade: qtd,
    destino: destinoInput.value
  })
})
.then(r => r.json())
.then(data => {
  if(data.ok){
    movs.push(data.movimentacao); // Array local
    salvarAuto();
    toast('✓ Movimentação registrada!');
  }
});
```

---

## ⚙️ Fluxo de Sincronização

### Ao carregar a página:
1. **GET /api/embalagens** → carregar dados do PostgreSQL
2. **GET /api/movimentacoes** → carregar movimentações
3. **GET /api/produtos** → carregar produtos
4. **GET /api/fornecedores** → carregar fornecedores

### Quando o usuário faz algo:
1. **POST /api/[dados]** → salvar no PostgreSQL ✅
2. **salvarAuto()** → salvar também no localStorage (backup local)
3. **toast('✓ Sucesso!')** → mostrar feedback

### Resultado:
✅ Dados salvos no **PostgreSQL** (permanente)
✅ Dados em **localStorage** (backup local)
✅ Nenhum dado perdido!

---

## 📌 Erros Comuns

| Erro | Causa | Solução |
|------|-------|---------|
| `"Código já existe"` | Produto com esse código já foi criado | Use um código único |
| `"Nome é obrigatório"` | Tentou criar fornecedor sem nome | Preencha o campo nome |
| `"Código e descrição são obrigatórios"` | Campos faltando no produto | Complete os dados |

---

## 🎯 Próximo Passo

Atualizar o `index.html` para:
1. Carregar dados da API ao iniciar
2. Salvar novos produtos/fornecedores na API (POST)
3. Registrar movimentações na API

Todos os dados vão estar **100% seguros no PostgreSQL**! ✅
