import mongoose from 'mongoose';

import { disconnectDatabase, connectDatabase } from '../config/db';
import { env } from '../config/env';
import {
  applyCurrencyMigrationChanges,
  buildCurrencyMigrationPlan,
  cleanCurrencyMigrationMarkers,
  CurrencyMigrationError,
  USD_TO_GBP_CONFIRMATION,
  USD_TO_GBP_MIGRATION_ID,
  USD_TO_GBP_RATE,
  type CurrencyMigrationPlan,
} from '../services/currencyMigration.service';
import { logger } from '../utils/logger';

type MigrationLedger = {
  _id: string;
  status: 'applying' | 'complete';
  plan: CurrencyMigrationPlan;
  originalCurrency: 'USD';
  targetCurrency: 'GBP';
  rate: string;
  createdAt: Date;
  completedAt?: Date;
};

async function run(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const execute = args.has('--execute');
  const resume = args.has('--resume');
  const dryRun = args.has('--dry-run');
  const confirmation = process.argv
    .find((arg) => arg.startsWith('--confirm='))
    ?.slice('--confirm='.length);
  if (
    [...args].some(
      (arg) =>
        !['--execute', '--resume', '--dry-run'].includes(arg) &&
        !arg.startsWith('--confirm='),
    )
  ) {
    throw new CurrencyMigrationError('Unknown migration option');
  }
  if (execute && resume) {
    throw new CurrencyMigrationError(
      'Use either --execute or --resume, not both',
    );
  }
  if (dryRun && (execute || resume)) {
    throw new CurrencyMigrationError(
      'Do not combine --dry-run with write mode',
    );
  }
  if ((execute || resume) && confirmation !== USD_TO_GBP_CONFIRMATION) {
    throw new CurrencyMigrationError(
      `Write mode requires --confirm=${USD_TO_GBP_CONFIRMATION}`,
    );
  }
  if (!execute && !resume && args.size > 1) {
    throw new CurrencyMigrationError(
      'Use no arguments for a dry run, or --execute/--resume with the confirmation token',
    );
  }

  await connectDatabase();
  try {
    const ledgerCollection = mongoose.connection.collection<MigrationLedger>(
      'currency_migrations',
    );
    const existing = await ledgerCollection.findOne({
      _id: USD_TO_GBP_MIGRATION_ID,
    });

    if (existing?.status === 'complete') {
      if (execute || resume) await cleanCurrencyMigrationMarkers();
      console.log(
        JSON.stringify(
          {
            mode: 'already-complete',
            target: {
              environment: env.NODE_ENV,
              database: mongoose.connection.name,
            },
            migrationId: USD_TO_GBP_MIGRATION_ID,
            originalCurrency: existing.originalCurrency,
            targetCurrency: existing.targetCurrency,
            rate: existing.rate,
            affectedRecordCounts: existing.plan.counts,
            completedAt: existing.completedAt,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (resume) {
      if (!existing) {
        throw new CurrencyMigrationError(
          'No interrupted migration journal exists to resume',
        );
      }
      await applyCurrencyMigrationChanges(
        existing.plan.changes,
        USD_TO_GBP_MIGRATION_ID,
      );
      const completedAt = new Date();
      await ledgerCollection.updateOne(
        { _id: USD_TO_GBP_MIGRATION_ID, status: 'applying' },
        { $set: { status: 'complete', completedAt } },
      );
      await cleanCurrencyMigrationMarkers();
      printResult('resumed-and-completed', existing.plan, completedAt);
      return;
    }

    if (existing) {
      throw new CurrencyMigrationError(
        'An incomplete migration journal exists; use --resume after reviewing it',
      );
    }

    const plan = await buildCurrencyMigrationPlan();
    if (!execute) {
      printResult('dry-run-no-writes', plan);
      return;
    }

    const ledger: MigrationLedger = {
      _id: USD_TO_GBP_MIGRATION_ID,
      status: 'applying',
      plan,
      originalCurrency: 'USD',
      targetCurrency: 'GBP',
      rate: USD_TO_GBP_RATE,
      createdAt: new Date(),
    };
    await ledgerCollection.insertOne(ledger);
    await applyCurrencyMigrationChanges(plan.changes);
    const completedAt = new Date();
    await ledgerCollection.updateOne(
      { _id: USD_TO_GBP_MIGRATION_ID, status: 'applying' },
      { $set: { status: 'complete', completedAt } },
    );
    await cleanCurrencyMigrationMarkers();
    printResult('completed', plan, completedAt);
  } finally {
    await disconnectDatabase();
  }
}

function printResult(
  mode: string,
  plan: CurrencyMigrationPlan,
  completedAt?: Date,
): void {
  console.log(
    JSON.stringify(
      {
        mode,
        target: {
          environment: env.NODE_ENV,
          database: mongoose.connection.name,
        },
        migrationId: USD_TO_GBP_MIGRATION_ID,
        originalCurrency: 'USD',
        targetCurrency: 'GBP',
        rate: USD_TO_GBP_RATE,
        ...(completedAt ? { completedAt } : {}),
        affectedRecordCounts: plan.counts,
        historicalOrders: {
          unchanged: true,
          countByCurrency: plan.orderCurrencyCounts,
        },
        convertedAmountPreview: plan.examples,
      },
      null,
      2,
    ),
  );
}

void run().catch((error: unknown) => {
  logger.error(
    {
      err: error instanceof Error ? error.message : 'Unknown migration failure',
    },
    'USD-to-GBP migration stopped',
  );
  process.exitCode = 1;
});
