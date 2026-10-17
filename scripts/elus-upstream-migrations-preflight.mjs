#!/usr/bin/env node
// Gate read-only para reconciliar as migrations ELUS com uma tag upstream fixa.
// Não faz fetch, checkout, rename, SQL nem alteração do ledger de migrations.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const migrationPath = /^supabase\/migrations\/(\d{14})_(\d{4})_(.+)\.sql$/;

export function inspectMigrations(elusFiles, upstreamFiles) {
  const issues = [];
  function index(files, side) {
    const byPath = new Map();
    const byNumber = new Map();
    const byVersion = new Map();
    for (const file of files) {
      if (!file.path.startsWith('supabase/migrations/') || !file.path.endsWith('.sql')) continue;
      const match = migrationPath.exec(file.path);
      if (!match) {
        issues.push({ type: 'invalid_filename', side, path: file.path });
        continue;
      }
      const [, version, number] = match;
      const record = { path: file.path, version, number, sha: file.sha };
      if (byPath.has(record.path)) {
        issues.push({ type: 'duplicate_path', side, path: record.path });
      }
      for (const [key, map, type] of [
        [number, byNumber, 'duplicate_number_in_ref'],
        [version, byVersion, 'duplicate_version_in_ref'],
      ]) {
        const previous = map.get(key);
        if (previous && previous.path !== record.path) {
          issues.push({ type, side, left: previous.path, right: record.path });
        } else map.set(key, record);
      }
      byPath.set(record.path, record);
    }
    return { byPath, byNumber, byVersion };
  }
  const elus = index(elusFiles, 'elus');
  const upstream = index(upstreamFiles, 'upstream');
  for (const [number, left] of elus.byNumber) {
    const right = upstream.byNumber.get(number);
    if (right && right.path !== left.path) {
      issues.push({ type: 'number_collision', number, elus: left.path, upstream: right.path });
    }
  }
  for (const [version, left] of elus.byVersion) {
    const right = upstream.byVersion.get(version);
    if (right && right.path !== left.path) {
      issues.push({ type: 'version_collision', version, elus: left.path, upstream: right.path });
    }
  }
  for (const [path, left] of elus.byPath) {
    const right = upstream.byPath.get(path);
    if (right && left.sha !== right.sha) {
      issues.push({ type: 'same_path_different_content', path });
    }
  }
  const pending = [...upstream.byPath.values()].filter(m => !elus.byPath.has(m.path));
  const elusOnly = [...elus.byPath.values()].filter(m => !upstream.byPath.has(m.path));
  const highestElusTimestamp = [...elus.byPath.values()].map(m => m.version).sort().at(-1) ?? null;
  const pendingEarlierThanElus = pending.filter(m => highestElusTimestamp && m.version <= highestElusTimestamp);
  issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  pending.sort((a, b) => a.path.localeCompare(b.path));
  const status = issues.length ? 'blocked' : pending.length ? 'incomplete' : 'ready_for_schema_tests';
  return {
    status,
    counts: { elus: elus.byPath.size, upstream: upstream.byPath.size, pending: pending.length, elusOnly: elusOnly.length, issues: issues.length, pendingEarlierThanElus: pendingEarlierThanElus.length },
    issues,
    pending: pending.map(p => p.path),
    note: 'Resultado estático de árvores Git. Não prova ledger aplicado, ordem de execução, baseline nem segurança de upgrade. Nunca aplicar SQL automaticamente.',
  };
}

function readGitMigrationTree(ref) {
  // Sempre exige ref local existente: nenhuma operação que atualize refs ou índice.
  execFileSync('git', ['rev-parse', '--verify', '--end-of-options', ref + '^{tree}'], { stdio: 'pipe' });
  const output = execFileSync('git', ['ls-tree', '-r', '-z', ref, '--', 'supabase/migrations/']);
  return output.toString('utf8').split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t');
    const header = entry.slice(0, tab);
    const match = /^\d{6} blob ([a-f0-9]{40})$/.exec(header);
    if (tab < 0 || !match) throw new Error('Entrada inesperada no git ls-tree');
    return { path: entry.slice(tab + 1), sha: match[1] };
  });
}

function main(argv) {
  if (argv.length !== 2) {
    console.error('Uso: node scripts/elus-upstream-migrations-preflight.mjs <elus-ref> <upstream-ref>');
    process.exitCode = 2;
    return;
  }
  try {
    const result = inspectMigrations(readGitMigrationTree(argv[0]), readGitMigrationTree(argv[1]));
    console.log(JSON.stringify({ refs: { elus: argv[0], upstream: argv[1] }, ...result }, null, 2));
    if (result.status !== 'ready_for_schema_tests') process.exitCode = 1;
  } catch (error) {
    console.error('NÃO MEDIDO: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
