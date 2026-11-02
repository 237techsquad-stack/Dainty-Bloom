export interface PasswordResetEmail {
  to: string;
  name: string;
  resetLink: string;
}

export interface Mailer {
  sendPasswordReset(input: PasswordResetEmail): Promise<void>;
  sendTransactionalEmail(input: TransactionalEmail): Promise<void>;
}

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}
