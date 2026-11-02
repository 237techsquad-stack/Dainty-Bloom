'use client';

import Link from 'next/link';
import { Suspense, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/components/providers/AuthProvider';
import { ApiError } from '@/lib/api/client';

const adminLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type AdminLoginValues = z.infer<typeof adminLoginSchema>;

export function AdminLoginForm() {
  return (
    <Suspense
      fallback={
        <p className="auth-loading" role="status">
          Loading staff sign in…
        </p>
      }
    >
      <AdminLoginFormContent />
    </Suspense>
  );
}

function AdminLoginFormContent() {
  const { login, user } = useAuth();
  const errorId = useId();
  const [visible, setVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminLoginValues>({ resolver: zodResolver(adminLoginSchema) });

  const submit = handleSubmit(async (values) => {
    setErrorMessage('');
    try {
      await login({ ...values, portal: 'admin' });
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError
          ? error.message
          : 'Staff sign in could not be completed.',
      );
    }
  });

  if (user && user.role !== 'customer') {
    return (
      <p className="auth-loading" role="status">
        Checking staff access…
      </p>
    );
  }

  return (
    <section className="auth-form-content">
      <p className="auth-kicker">STAFF WORKSPACE</p>
      <h1>Welcome back</h1>
      <p className="auth-intro">Sign in to your Dainty Bloom workspace.</p>
      {errorMessage ? (
        <div className="auth-alert" id={errorId} role="alert">
          {errorMessage}
        </div>
      ) : null}
      <form
        className="auth-form"
        aria-describedby={errorMessage ? errorId : undefined}
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <Input
          label="Email address"
          type="email"
          autoComplete="username"
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="password-field">
          <Input
            label="Password"
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? (
              <EyeOff aria-hidden="true" size={18} />
            ) : (
              <Eye aria-hidden="true" size={18} />
            )}
          </button>
        </div>
        <div className="auth-link-row">
          <span>Need help accessing your account?</span>
          <Link href="/contact">Contact us</Link>
        </div>
        <Button type="submit" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </section>
  );
}
