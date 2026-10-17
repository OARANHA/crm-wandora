import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspectMigrations } from '../../scripts/elus-upstream-migrations-preflight.mjs';

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
