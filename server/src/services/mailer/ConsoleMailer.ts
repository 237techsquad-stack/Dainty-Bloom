import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { Mailer, PasswordResetEmail, TransactionalEmail } from './Mailer';

export class ConsoleMailer implements Mailer {
  async sendPasswordReset(_input: PasswordResetEmail): Promise<void> {
    if (env.NODE_ENV === 'production') {
      logger.info(
        'Password reset email requested; configure a production mail provider',
      );
      return;
    }

    if (env.NODE_ENV !== 'development') {
      logger.info('Password reset email requested in test environment');
      return;
    }

    logger.info('Password reset email requested in development');
  }

  async sendTransactionalEmail(input: TransactionalEmail): Promise<void> {
    logger.info({ subject: input.subject }, 'Transactional email requested');
  }
}
