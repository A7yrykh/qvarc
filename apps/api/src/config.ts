export interface AppConfig {
  databaseUrl: string;
  cookieSecure: boolean;
  sessionHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL не задан');
  return {
    databaseUrl,
    cookieSecure: env.COOKIE_SECURE !== 'false',
    sessionHours: Number(env.SESSION_HOURS ?? 12),
  };
}
