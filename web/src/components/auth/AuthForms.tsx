'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Input } from '@/components/ui';
import {
  getAuthErrorMessage,
  useAuth,
} from '@/components/providers/AuthProvider';
import { ApiError, api } from '@/lib/api/client';
import { useToast } from '@/components/ui';
import type { RegisterInput } from '@/lib/api/types';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Enter your password.'),
});
const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name.').max(120),
    email: z.string().trim().email(),
    password: z.string().min(10, 'Use at least 10 characters.').max(128),
    confirmPassword: z.string(),
    consent: z.literal(true, {
      error: 'Consent is required to create an account.',
    }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });
const resetSchema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters.').max(128),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type ResetValues = z.infer<typeof resetSchema>;

function safeNextPath(value: string | null): string | null {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return null;
  }
  return value;
}

function FormAlert({ message }: { message: string }) {
  return (
    <div className="auth-alert" role="alert">
      {message}
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<div className="auth-loading" aria-label="Loading" />}>
      <LoginFormContent />
    </Suspense>
  );
}

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));
  const { user, isLoading, login } = useAuth();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [serverError, setServerError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (!isLoading && user) {
      router.replace(user.role === 'customer' ? nextPath ?? '/' : '/admin');
    }
  }, [isLoading, nextPath, router, user]);

  const submit = handleSubmit(async (values) => {
    setServerError('');
    try {
      const result = await login({ ...values, portal: 'customer' });
      router.replace(
        result.user.role === 'customer' ? nextPath ?? '/' : '/admin',
      );
    } catch (error) {
      setServerError(getAuthErrorMessage(error));
    }
  });

  if (user)
    return (
      <p className="auth-loading" role="status">
        Redirecting…
      </p>
    );
  return (
    <section className="auth-form-content">
      <p className="auth-kicker">Welcome back</p>
      <h1>Sign in</h1>
      <p className="auth-intro">Sign in to continue to your account.</p>
      {serverError ? <FormAlert message={serverError} /> : null}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
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
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            title={passwordVisible ? 'Hide password' : 'Show password'}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <div className="auth-link-row">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="auth-switch">
        New to Dainty Bloom?{' '}
        <Link href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : '/register'}>
          Create an account
        </Link>
      </p>
    </section>
  );
}

export function RegisterForm() {
  return (
    <Suspense fallback={<div className="auth-loading" aria-label="Loading" />}>
      <RegisterFormContent />
    </Suspense>
  );
}

function RegisterFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));
  const { user, isLoading, register: createAccount } = useAuth();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [serverError, setServerError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  useEffect(() => {
    if (!isLoading && user)
      router.replace(user.role === 'customer' ? nextPath ?? '/' : '/admin');
  }, [isLoading, nextPath, router, user]);

  const submit = handleSubmit(async (values) => {
    setServerError('');
    const input: RegisterInput = {
      name: values.name,
      email: values.email,
      password: values.password,
    };
    try {
      await createAccount(input);
      router.replace(nextPath ?? '/');
    } catch (error) {
      setServerError(getAuthErrorMessage(error));
    }
  });

  if (isLoading || user)
    return (
      <p className="auth-loading" role="status">
        {isLoading ? 'Checking session…' : 'Redirecting…'}
      </p>
    );
  return (
    <section className="auth-form-content">
      <p className="auth-kicker">Join us</p>
      <h1>Create your account</h1>
      {serverError ? <FormAlert message={serverError} /> : null}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <Input
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
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
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="new-password"
            hint="Use at least 10 characters."
            error={errors.password?.message}
            {...register('password')}
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            title={passwordVisible ? 'Hide password' : 'Show password'}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <label className="auth-consent">
          <input type="checkbox" {...register('consent')} />
          <span>I agree to create an account and provide these details.</span>
        </label>
        {errors.consent ? (
          <p className="field-error">{errors.consent.message}</p>
        ) : null}
        <Button type="submit" loading={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}

export function ForgotPasswordForm() {
  return (
    <section className="auth-form-content">
      <p className="auth-kicker">Account help</p>
      <h1>Forgot password?</h1>
      <p className="auth-intro">
        Password reset links cannot currently be delivered because email
        delivery is not configured. Please use the Contact Us page to reach the
        store for help accessing your account.
      </p>
      <Link className="button button--secondary button--md" href="/contact">
        Contact Us
      </Link>
      <p className="auth-switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </section>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense fallback={<div className="auth-loading" aria-label="Loading" />}>
      <ResetPasswordFormContent />
    </Suspense>
  );
}

function ResetPasswordFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const toast = useToast();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [serverError, setServerError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
  });
  const submit = handleSubmit(async ({ password }) => {
    setServerError('');
    try {
      const result = await api.resetPassword(token, password);
      toast(result.message, 'success');
      router.replace('/login');
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'This reset link is invalid or has expired. Request a new one.',
      );
    }
  });

  if (!token) {
    return (
      <section className="auth-form-content">
        <h1>Reset link unavailable</h1>
        <p className="auth-intro">
          This password reset link is invalid or has expired.
        </p>
        <Link
          className="button button--primary button--md"
          href="/forgot-password"
        >
          Request a new reset link
        </Link>
      </section>
    );
  }
  return (
    <section className="auth-form-content">
      <p className="auth-kicker">Account help</p>
      <h1>Choose a new password</h1>
      {serverError ? <FormAlert message={serverError} /> : null}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <div className="password-field">
          <Input
            label="New password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="new-password"
            hint="Use at least 10 characters."
            error={errors.password?.message}
            {...register('password')}
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            title={passwordVisible ? 'Hide password' : 'Show password'}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" loading={isSubmitting}>
          Reset password
        </Button>
      </form>
      <p className="auth-switch">
        <Link href="/forgot-password">Request a new reset link</Link>
      </p>
    </section>
  );
}
