import { closePools } from './db.ts';

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Run a script's main: its return value (or 1 on a throw) is the exit code; pools are closed. */
export function runMain(main: () => Promise<number | void>): void {
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(closePools);
}
