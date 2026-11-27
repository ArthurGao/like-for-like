import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

export const repoRoot = new URL('../../', import.meta.url);
export const runsDir = new URL('runs/', repoRoot);

/** Numbered run folders in runs/ ("001", "002", ...), in order. */
export async function runIds(): Promise<string[]> {
  const names = await readdir(runsDir).catch(() => [] as string[]);
  return names.filter((n) => /^\d{3}$/.test(n)).sort();
}

/** Each numbered run's report.json, optionally only those of one feature. */
export async function readRunReports(feature?: string): Promise<{ id: string; report: any }[]> {
  const out = [];
  for (const id of await runIds()) {
    const report = JSON.parse(await readFile(new URL(`${id}/report.json`, runsDir), 'utf8'));
    if (!feature || report.feature === feature) out.push({ id, report });
  }
  return out;
}

/** Next run number: one more than the highest numeric folder in runs/, three digits. */
export async function nextRunNumber(): Promise<string> {
  const max = Math.max(0, ...(await runIds()).map(Number));
  return String(max + 1).padStart(3, '0');
}

/** Knowledge entry file names (every .md in knowledge/ except its README), sorted. */
export async function knowledgeFiles(): Promise<string[]> {
  const names = await readdir(new URL('knowledge/', repoRoot)).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith('.md') && n !== 'README.md').sort();
}

export const countKnowledgeEntries = async () => (await knowledgeFiles()).length;

export async function writeReport(dir: string, report: unknown): Promise<string> {
  const target = new URL(`${dir}/`, runsDir);
  await mkdir(target, { recursive: true });
  const file = new URL('report.json', target);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file.pathname;
}
