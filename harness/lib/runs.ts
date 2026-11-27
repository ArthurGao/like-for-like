import { mkdir, readdir, writeFile } from 'node:fs/promises';

export const repoRoot = new URL('../../', import.meta.url);
export const runsDir = new URL('runs/', repoRoot);

/** Next run number: one more than the highest numeric folder in runs/, three digits. */
export async function nextRunNumber(): Promise<string> {
  const names = await readdir(runsDir).catch(() => [] as string[]);
  const max = Math.max(0, ...names.filter((n) => /^\d{3}$/.test(n)).map(Number));
  return String(max + 1).padStart(3, '0');
}

export async function countKnowledgeEntries(): Promise<number> {
  const names = await readdir(new URL('knowledge/', repoRoot)).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith('.md') && n !== 'README.md').length;
}

export async function writeReport(dir: string, report: unknown): Promise<string> {
  const target = new URL(`${dir}/`, runsDir);
  await mkdir(target, { recursive: true });
  const file = new URL('report.json', target);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file.pathname;
}
