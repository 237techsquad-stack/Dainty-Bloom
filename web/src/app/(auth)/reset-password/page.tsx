import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/AuthForms';

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
