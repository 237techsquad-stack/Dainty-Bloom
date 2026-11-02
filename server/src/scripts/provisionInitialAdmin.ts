import { createInterface } from 'node:readline';

import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/db';
import {
  configuredDatabaseName,
  provisionInitialAdmin,
  verifyProductionDatabase,
} from '../services/initialAdminProvisioning.service';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

async function run(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new AppError(
      'Run this command from an interactive terminal; credentials are never accepted as arguments',
      400,
      'INTERACTIVE_TERMINAL_REQUIRED',
    );
  }

  let confirmation = '';
  if (env.NODE_ENV === 'production') {
    const databaseName = configuredDatabaseName(env.MONGODB_URI);
    process.stdout.write(
      `Production database from MONGODB_URI: ${databaseName}\n`,
    );
    confirmation = await ask(`Type "${databaseName}" to confirm: `);
  }
  verifyProductionDatabase(env.NODE_ENV, env.MONGODB_URI, confirmation);

  const name = await ask('Administrator name: ');
  const email = await ask('Administrator email: ');
  const password = await askHidden('Administrator password: ');
  const passwordConfirmation = await askHidden('Confirm password: ');
  if (password !== passwordConfirmation) {
    throw new AppError(
      'The passwords did not match; no administrator was created',
      400,
      'PASSWORD_CONFIRMATION_FAILED',
    );
  }

  await connectDatabase();
  try {
    await provisionInitialAdmin({ name, email, password });
    process.stdout.write('Initial administrator provisioned.\n');
  } finally {
    await disconnectDatabase();
  }
}

async function ask(question: string): Promise<string> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await new Promise((resolve) => prompt.question(question, resolve));
  } finally {
    prompt.close();
  }
}

async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new AppError(
      'A terminal supporting hidden password input is required',
      400,
      'SECURE_PASSWORD_PROMPT_REQUIRED',
    );
  }

  process.stdout.write(question);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = (): void => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('error', onError);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          cleanup();
          reject(
            new AppError(
              'Password prompt cancelled; no administrator was created',
              400,
              'PROMPT_CANCELLED',
            ),
          );
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        value += character;
      }
    };

    process.stdin.on('data', onData);
    process.stdin.once('error', onError);
  });
}

void run().catch((error: unknown) => {
  const code = error instanceof AppError ? error.code : 'PROVISIONING_FAILED';
  const message =
    error instanceof AppError
      ? error.message
      : 'Administrator provisioning failed; no credentials were logged';
  logger.error({ code }, 'Initial administrator provisioning failed');
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
