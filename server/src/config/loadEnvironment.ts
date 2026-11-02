import dotenv from 'dotenv';

export function loadEnvironment(
  overridePath = process.env.DOTENV_CONFIG_PATH,
  target: NodeJS.ProcessEnv = process.env,
  fallbackPath = '.env',
): void {
  const loaded = Object.fromEntries(
    Object.entries(target).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  if (overridePath) {
    const result = dotenv.config({
      path: overridePath,
      processEnv: loaded,
      override: true,
    });
    if (result.error) {
      throw new Error('DOTENV_CONFIG_PATH could not be loaded');
    }
  }
  dotenv.config({ path: fallbackPath, processEnv: loaded });
  Object.assign(target, loaded);
}
