/**
 * Migração única: copia ingredientes, embalagens e categorias do banco
 * do sistema KDS para o banco do Estoque MP (produtos/categorias).
 *
 * NÃO conecta os dois sistemas — é uma cópia pontual. Depois de rodado,
 * os dados ficam gravados de forma independente no banco do Estoque MP.
 *
 * COMO RODAR (no seu computador, não precisa ser no Railway):
 *
 *   1. Instale as dependências (se ainda não tiver):
 *        npm install pg
 *
 *   2. Rode passando as duas conexões como variável de ambiente
 *      (pegue em Railway → serviço PostgreSQL → aba Variables → DATABASE_URL):
 *
 *      No Mac/Linux:
 *        KDS_DATABASE_URL="postgres://..." ESTOQUE_DATABASE_URL="postgres://..." node scripts/migrar-do-kds.js
 *
 *      No Windows (PowerShell):
 *        $env:KDS_DATABASE_URL="postgres://..."; $env:ESTOQUE_DATABASE_URL="postgres://..."; node scripts/migrar-do-kds.js
 *
 *   3. O script só faz LEITURA no banco do KDS (nunca escreve nele).
 *      No banco do Estoque MP ele faz INSERT — produtos com código já
 *      existente são pulados automaticamente (não duplica se rodar 2x).
 */

const { Pool } = require('pg');

const kdsUrl = process.env.KDS_DATABASE_URL;
const estoqueUrl = process.env.ESTOQUE_DATABASE_URL;

if (!kdsUrl || !estoqueUrl) {
  console.error('❌ Defina as variáveis de ambiente KDS_DATABASE_URL e ESTOQUE_DATABASE_URL antes de rodar.');
  process.exit(1);
}

const kds = new Pool({ connectionString: kdsUrl, ssl: { rejectUnauthorized: false } });
const estoque = new Pool({ connectionString: estoqueUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log('🔎 Lendo dados do banco do KDS...');

  const { rows: categoriasKds } = await kds.query(
    `SELECT id, nome FROM categorias_ingrediente ORDER BY ordem, nome`
  );
  const { rows: ingredientes } = await kds.query(
    `SELECT codigo, descricao, unidade, categoria_id, custo_unitario
     FROM ingredientes WHERE ativo = TRUE ORDER BY descricao`
  );
  const { rows: embalagens } = await kds.query(
    `SELECT codigo, descricao, unidade, precisa_revisao, custo_unitario
     FROM embalagens WHERE ativo = TRUE ORDER BY descricao`
  );

  console.log(`   ${categoriasKds.length} categorias de ingrediente`);
  console.log(`   ${ingredientes.length} ingredientes ativos`);
  console.log(`   ${embalagens.length} embalagens ativas`);

  // ── Mapa de categorias: nome (KDS) -> id (Estoque MP) ──────────────
  const mapaCategoriaId = {}; // nome em minúsculo -> id no Estoque MP

  console.log('\n📁 Garantindo categorias no Estoque MP...');
  for (const cat of categoriasKds) {
    const nome = cat.nome.trim();
    const existente = await estoque.query(`SELECT id FROM categorias WHERE nome = $1`, [nome]);
    if (existente.rows.length > 0) {
      mapaCategoriaId[nome.toLowerCase()] = existente.rows[0].id;
    } else {
      const criada = await estoque.query(
        `INSERT INTO categorias (nome) VALUES ($1) RETURNING id`,
        [nome]
      );
      mapaCategoriaId[nome.toLowerCase()] = criada.rows[0].id;
      console.log(`   + categoria criada: ${nome}`);
    }
  }

  // categoria fixa para embalagens (KDS não categoriza embalagem)
  const nomeCategoriaEmbalagens = 'Embalagens';
  let catEmbalagensId = mapaCategoriaId[nomeCategoriaEmbalagens.toLowerCase()];
  if (!catEmbalagensId) {
    const existente = await estoque.query(`SELECT id FROM categorias WHERE nome = $1`, [nomeCategoriaEmbalagens]);
    if (existente.rows.length > 0) {
      catEmbalagensId = existente.rows[0].id;
    } else {
      const criada = await estoque.query(`INSERT INTO categorias (nome) VALUES ($1) RETURNING id`, [nomeCategoriaEmbalagens]);
      catEmbalagensId = criada.rows[0].id;
      console.log(`   + categoria criada: ${nomeCategoriaEmbalagens}`);
    }
  }

  const idParaNomeCategoriaKds = {};
  categoriasKds.forEach(c => { idParaNomeCategoriaKds[c.id] = c.nome.trim(); });

  // ── Importar ingredientes ───────────────────────────────────────────
  console.log('\n🥕 Importando ingredientes...');
  let ingImportados = 0, ingPulados = 0;
  for (const ing of ingredientes) {
    const existe = await estoque.query(`SELECT id FROM produtos WHERE codigo = $1`, [ing.codigo]);
    if (existe.rows.length > 0) { ingPulados++; continue; }

    let categoriaId = null;
    if (ing.categoria_id && idParaNomeCategoriaKds[ing.categoria_id]) {
      categoriaId = mapaCategoriaId[idParaNomeCategoriaKds[ing.categoria_id].toLowerCase()] || null;
    }

    await estoque.query(
      `INSERT INTO produtos (codigo, descricao, categoria_id, unidade, origem)
       VALUES ($1,$2,$3,$4,'kds')`,
      [ing.codigo, ing.descricao, categoriaId, ing.unidade || 'kg']
    );
    ingImportados++;
  }
  console.log(`   ${ingImportados} importados, ${ingPulados} pulados (código já existia)`);

  // ── Importar embalagens ─────────────────────────────────────────────
  console.log('\n📦 Importando embalagens...');
  let embImportadas = 0, embPuladas = 0;
  const precisamRevisao = [];
  for (const emb of embalagens) {
    const existe = await estoque.query(`SELECT id FROM produtos WHERE codigo = $1`, [emb.codigo]);
    if (existe.rows.length > 0) { embPuladas++; continue; }

    await estoque.query(
      `INSERT INTO produtos (codigo, descricao, categoria_id, unidade, origem)
       VALUES ($1,$2,$3,$4,'kds')`,
      [emb.codigo, emb.descricao, catEmbalagensId, emb.unidade || 'un']
    );
    embImportadas++;
    if (emb.precisa_revisao) precisamRevisao.push(`${emb.codigo} — ${emb.descricao}`);
  }
  console.log(`   ${embImportadas} importadas, ${embPuladas} puladas (código já existia)`);

  if (precisamRevisao.length) {
    console.log(`\n⚠️  ${precisamRevisao.length} embalagens estavam marcadas como "precisa_revisao" no KDS`);
    console.log('   (importadas mesmo assim, mas vale conferir se são mesmo embalagens):');
    precisamRevisao.forEach(r => console.log('   - ' + r));
  }

  console.log('\n✅ Migração concluída.');
  await kds.end();
  await estoque.end();
}

main().catch(e => {
  console.error('❌ Erro na migração:', e.message);
  process.exit(1);
});
