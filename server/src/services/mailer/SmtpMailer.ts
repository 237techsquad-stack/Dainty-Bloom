import type { Mailer, PasswordResetEmail, TransactionalEmail } from './Mailer';
import { sendSmtpEmail } from './smtpTransport';

export class SmtpMailer implements Mailer {
  async sendPasswordReset(input: PasswordResetEmail): Promise<void> {
    const text = [
      `Hello ${input.name},`,
      '',
      'Use the following link to reset your Dainty Bloom password:',
      input.resetLink,
      '',
      'If you did not request a password reset, you can ignore this email.',
    ].join('\n');

    await sendSmtpEmail({
      to: input.to,
      subject: 'Reset your Dainty Bloom password',
      text,
      html: `<p>Hello ${escapeHtml(input.name)},</p><p>Use the following link to reset your Dainty Bloom password:</p><p><a href="${escapeHtml(input.resetLink)}">Reset password</a></p><p>If you did not request a password reset, you can ignore this email.</p>`,
    });
  }

  async sendTransactionalEmail(input: TransactionalEmail): Promise<void> {
    await sendSmtpEmail(input);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}
