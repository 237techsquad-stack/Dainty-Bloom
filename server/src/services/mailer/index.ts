import { env } from '../../config/env';
import { ConsoleMailer } from './ConsoleMailer';
import type { Mailer } from './Mailer';
import { SmtpMailer } from './SmtpMailer';

const consoleMailer = new ConsoleMailer();
const smtpMailer = new SmtpMailer();

export function getMailer(): Mailer {
  return env.NODE_ENV === 'production' ? smtpMailer : consoleMailer;
}
