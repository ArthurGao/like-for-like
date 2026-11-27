// Local-only connection settings for the Docker database (bound to 127.0.0.1).
// These passwords exist only on a developer machine; override with env vars if needed.
const host = process.env.PGHOST ?? '127.0.0.1';
const port = process.env.PGPORT ?? '5482';
const database = process.env.PGDATABASE ?? 'likeforlike';

const url = (user: string, password: string) =>
  `postgres://${user}:${password}@${host}:${port}/${database}`;

export const roles = {
  appUser: { name: 'app_user', password: process.env.APP_USER_PASSWORD ?? 'app_user_local' },
  migrator: { name: 'migrator', password: process.env.MIGRATOR_PASSWORD ?? 'migrator_local' },
} as const;

export const urls = {
  /** Superuser. Used only by reset, seed and the harness, never by feature code. */
  admin: process.env.ADMIN_DATABASE_URL ?? url('postgres', 'postgres_local'),
  /** Runtime role: no ownership, no BYPASSRLS. Every query goes through withTenant. */
  appUser: process.env.APP_DATABASE_URL ?? url(roles.appUser.name, roles.appUser.password),
  /** Migration role: reads legacy, writes app and migration. */
  migrator: process.env.MIGRATOR_DATABASE_URL ?? url(roles.migrator.name, roles.migrator.password),
};
