import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspectMigrations, projectHistoricalNames } from '../../scripts/elus-upstream-migrations-preflight.mjs';

const file = (name, sha = 'a'.repeat(40)) => ({ path: 'supabase/migrations/' + name, sha });
const base = [file('20260930180000_0501_org_operante_e_suspensao_tipada.sql')];

const own = [
  '20261001133000_0502_integracoes_erp_modulo_oficial.sql',
  '20261003231500_0503_integracoes_erp_admin_whatsapp_readonly.sql',
  '20261005150000_0504_integracoes_erp_entrega_danfe_governada.sql',
  '20261006213000_0505_integracoes_erp_customer_resolution_v1.sql',
  '20261015031500_0506_org_ai_autonomy_protected.sql',
].map(name => file(name));
const foreign = [
  '20260930191523_0502_anotacao_simultanea_nao_apaga_a_outra.sql',
  '20261001120300_0503_trigger_imutavel_cobre_flags_e_debounce.sql',
  '20261001120400_0504_credencial_de_mapas.sql',
  '20261001120500_0505_demanda_marca_proximo_passo_com_o_caso.sql',
  '20261001120600_0506_selecao_de_empresas_na_prospeccao.sql',
].map(name => file(name));

test('fail-closed: cinco colisões de NNNN mesmo com timestamps distintos', () => {
  const result = inspectMigrations([...base, ...own], [...base, ...foreign]);
  assert.equal(result.status, 'blocked');
  assert.equal(result.issues.filter(i => i.type === 'number_collision').length, 5);
  assert.equal(result.issues.filter(i => i.type === 'version_collision').length, 0);
  assert.equal(result.counts.pending, 5);
});

test('arquivo idêntico nas duas refs não é contado como conflito', () => {
  const result = inspectMigrations(base, base);
  assert.equal(result.status, 'ready_for_schema_tests');
  assert.equal(result.counts.issues, 0);
});

test('migrations upstream ausentes bloqueiam o gate mesmo sem colisões', () => {
  const result = inspectMigrations(base, [...base, file('20261017100000_0687_example.sql')]);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.counts.pending, 1);
});

test('mesmo path com blob divergente exige reconciliação', () => {
  const result = inspectMigrations(base, [file('20260930180000_0501_org_operante_e_suspensao_tipada.sql', 'b'.repeat(40))]);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.type === 'same_path_different_content'));
});

test('timestamp duplicado em migrations distintas falha fechado', () => {
  const result = inspectMigrations([file('20261001133000_0502_erp.sql')], [file('20261001133000_0687_other.sql')]);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.type === 'version_collision'));
});

test('duas migrations com mesmo NNNN dentro de uma ref também falham', () => {
  const result = inspectMigrations([...base, file('20261001000000_0502_a.sql'), file('20261002000000_0502_b.sql')], base);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.type === 'duplicate_number_in_ref'));
});

test('arquivo SQL fora do nome canônico não passa despercebido', () => {
  const result = inspectMigrations([...base, file('legacy.sql')], base);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.type === 'invalid_filename'));
});

test('migrations ainda pendentes com timestamp anterior são evidenciadas', () => {
  const result = inspectMigrations([...base, ...own], [...base, file('20261005160000_0687_between.sql')]);
  assert.equal(result.counts.pendingEarlierThanElus, 1);
});

test('CLI compara duas refs reais em repo descartável sem escrever no checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elus-migration-preflight-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 'teste@example.invalid',
    GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 'teste@example.invalid',
  });
  const git = (...args) => execFileSync('git', args, { cwd: dir, env }).toString();
  try {
    git('init', '-q', '-b', 'elus');
    const root = join(dir, 'supabase', 'migrations');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '20260930180000_0501_common.sql'), 'select 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'common');
    git('branch', 'upstream');
    writeFileSync(join(root, '20261001133000_0502_erp.sql'), 'select 2;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'elus');
    git('switch', '-q', 'upstream');
    writeFileSync(join(root, '20260930191523_0502_other.sql'), 'select 3;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'upstream');
    git('switch', '-q', 'elus');
    const before = git('status', '--porcelain');
    const script = fileURLToPath(new URL('../../scripts/elus-upstream-migrations-preflight.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, 'elus', 'upstream'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'blocked');
    assert.equal(report.issues.filter(i => i.type === 'number_collision').length, 1);
    assert.equal(git('status', '--porcelain'), before);
    const missing = spawnSync(process.execPath, [script, 'elus', 'missing-ref'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /NÃO MEDIDO/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('projeção preserva version e SHA sem alterar arquivos existentes', () => {
  const upstream = [...base, ...foreign, file('20261020000003_0686_ultima.sql')];
  const result = projectHistoricalNames([...base, ...own], upstream);
  assert.equal(result.status, 'proposal_only');
  assert.equal(result.proposals.length, 5);
  assert.deepEqual(result.proposals.map(p => p.newNumber), [
    '0687', '0688', '0689', '0690', '0691',
  ]);
  for (const p of result.proposals) {
    assert.equal(p.from.slice('supabase/migrations/'.length, 'supabase/migrations/'.length + 14), p.timestamp);
    assert.equal(p.to.slice('supabase/migrations/'.length, 'supabase/migrations/'.length + 14), p.timestamp);
    assert.equal(p.blobShaUnchanged, 'a'.repeat(40));
    assert.equal(p.to.endsWith('.sql'), true);
  }
  assert.equal(result.upstreamPending, 6, 'renomear nomes não aplica nenhuma das 6 SQLs upstream');
});

test('não presume autoria quando colisão é de caminho diferente do overlay aprovado', () => {
  const result = projectHistoricalNames(
    [...base, file('20261001133000_0502_outra_migration.sql')],
    [...base, foreign[0]],
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'collision_ownership_unknown');
  assert.equal(result.proposals.length, 0);
});

test('recusa projeção se houver colisão adicional de timestamp', () => {
  const result = projectHistoricalNames(
    [...base, ...own],
    [...base, ...foreign, file('20261001133000_0685_mesmo_timestamp.sql')],
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'non_number_conflict');
});

test('não ultrapassa o espaço de quatro dígitos NNNN', () => {
  const result = projectHistoricalNames(
    [...base, ...own],
    [...base, ...foreign, file('20261020000003_9999_limite.sql')],
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'no_free_four_digit_number');
});

test('duas árvores sem migrations são NÃO MEDIDO, nunca sucesso', () => {
  const result = projectHistoricalNames([], []);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'migration_tree_missing');
});

test('sem colisão nominal não inventa renumeração nem confunde pendência upstream com sucesso', () => {
  const result = projectHistoricalNames(base, [...base, file('20261020000003_0686_nova.sql')]);
  assert.equal(result.status, 'no_name_collision');
  assert.equal(result.proposals.length, 0);
  assert.equal(result.upstreamPending, 1);
});


test('stub histórico idêntico permanece bloqueado no gate original, mas não impede a projeção nominal', () => {
  const legacy = file('00001_initial_schema.sql', 'f'.repeat(40));
  const elus = [...base, legacy, ...own];
  const upstream = [...base, legacy, ...foreign, file('20261020000003_0686_ultima.sql')];
  assert.equal(inspectMigrations(elus, upstream).issues.filter(i => i.type === 'invalid_filename').length, 2);
  const projected = projectHistoricalNames(elus, upstream);
  assert.equal(projected.status, 'proposal_only');
  assert.equal(projected.proposals.length, 5);
  assert.equal(projected.sharedLegacyExcludedFromProjection, legacy.path);
  assert.equal(projected.upstreamPending, 6);
});

test('stub histórico com SHA diferente é bloqueado, sem normalização silenciosa', () => {
  const result = projectHistoricalNames(
    [...base, file('00001_initial_schema.sql', 'a'.repeat(40)), ...own],
    [...base, file('00001_initial_schema.sql', 'b'.repeat(40)), ...foreign],
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'shared_legacy_mismatch');
});

test('stub histórico ausente de um lado impede a projeção', () => {
  const result = projectHistoricalNames(
    [...base, file('00001_initial_schema.sql', 'a'.repeat(40)), ...own],
    [...base, ...foreign],
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'shared_legacy_mismatch');
});

test('outro arquivo SQL fora do padrão não recebe exceção de legado', () => {
  const result = projectHistoricalNames(
    [...base, ...own, file('00002_outra_migration.sql')],
    [...base, ...foreign],
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'non_number_conflict');
});


test('CLI em git descartável projeta nomes sem modificar working tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elus-projection-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 'teste@example.invalid',
    GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 'teste@example.invalid',
  });
  const git = (...args) => execFileSync('git', args, { cwd: dir, env }).toString();
  try {
    git('init', '-q', '-b', 'elus');
    const root = join(dir, 'supabase', 'migrations');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '00001_initial_schema.sql'), '-- stub histórico\n');
    writeFileSync(join(root, '20260930180000_0501_org_operante.sql'), 'select 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'legacy');
    git('branch', 'upstream');
    writeFileSync(join(root, '20261001133000_0502_integracoes_erp_modulo_oficial.sql'), 'select 2;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'elus');
    git('switch', '-q', 'upstream');
    writeFileSync(join(root, '20260930191523_0502_anotacao_simultanea_nao_apaga_a_outra.sql'), 'select 3;\n');
    writeFileSync(join(root, '20261020000003_0686_tail.sql'), 'select 4;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'upstream');
    git('switch', '-q', 'elus');
    const before = git('status', '--porcelain');
    const script = fileURLToPath(new URL('../../scripts/elus-upstream-migrations-preflight.mjs', import.meta.url));
    const cli = spawnSync(process.execPath, [script, 'elus', 'upstream', '--project-names'], {
      cwd: dir, env, encoding: 'utf8',
    });
    assert.equal(cli.status, 1, 'projeção jamais libera gate de importação');
    const payload = JSON.parse(cli.stdout);
    assert.equal(payload.status, 'blocked', 'gate original ainda detecta legado e colisão');
    assert.equal(payload.projection.status, 'proposal_only');
    assert.equal(payload.projection.proposals.length, 1);
    assert.equal(payload.projection.proposals[0].newNumber, '0687');
    assert.equal(git('status', '--porcelain'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
