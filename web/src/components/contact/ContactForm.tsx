'use client';

import { useCallback, useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Input, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type { ContactMessageInput, MessageToken } from '@/lib/api/types';

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(120, 'Name must be 120 characters or fewer.'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .max(254, 'Email must be 254 characters or fewer.'),
  orderNumber: z
    .string()
    .trim()
    .max(40, 'Order number must be 40 characters or fewer.')
    .optional(),
  subject: z
    .string()
    .trim()
    .min(2, 'Subject must be at least 2 characters.')
    .max(160, 'Subject must be 160 characters or fewer.')
    .refine(
      (value) =>
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        }),
      'Subject cannot contain control characters.',
    ),
  message: z
    .string()
    .trim()
    .min(5, 'Message must be at least 5 characters.')
    .max(5000, 'Message must be 5,000 characters or fewer.')
    .refine(
      (value) => !/<\/?[a-z][^>]*>/i.test(value),
      'HTML is not allowed in the message.',
    ),
  website: z.string().max(500).optional(),
});

type ContactValues = z.infer<typeof contactSchema>;
type ContactField = 'name' | 'email' | 'orderNumber' | 'subject' | 'message';

const FIELD_NAMES = new Set<ContactField>([
  'name',
  'email',
  'orderNumber',
  'subject',
  'message',
]);

function parseServerIssues(
  details: unknown,
): Array<{ field: ContactField; message: string }> {
  if (!Array.isArray(details)) return [];
  const issues: Array<{ field: ContactField; message: string }> = [];
  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const issue = detail as { path?: unknown; message?: unknown };
    if (!Array.isArray(issue.path) || typeof issue.message !== 'string')
      continue;
    const field = issue.path.find(
      (part): part is ContactField =>
        typeof part === 'string' && FIELD_NAMES.has(part as ContactField),
    );
    if (field) issues.push({ field, message: issue.message });
  }
  return issues;
}

function safeErrorMessage(error: ApiError): string {
  if (error.code === 'RATE_LIMITED') {
    return 'There have been too many attempts. Please wait a little while before trying again.';
  }
  if (error.code === 'MESSAGE_TOKEN_INVALID') {
    return 'The form security check expired. We refreshed it; please submit your message again.';
  }
  if (error.code === 'NETWORK_ERROR') {
    return 'We could not confirm whether your enquiry was received. You can retry the unchanged form; it will not create a duplicate enquiry.';
  }
  if (error.code === 'CONTACT_EMAIL_NOT_CONFIGURED') {
    return 'Your enquiry was saved, but store email delivery is not configured. Please contact the store using the details on this page, and do not submit it again.';
  }
  if (error.code === 'CONTACT_EMAIL_DELIVERY_FAILED') {
    return 'Your enquiry was saved, but email delivery could not be confirmed. Retrying the unchanged form will not create a duplicate enquiry.';
  }
  if (
    error.code === 'FILE_TOO_LARGE' ||
    error.code === 'FILE_TYPE_NOT_ALLOWED'
  ) {
    return 'The message could not be submitted. Please review the form and try again.';
  }
  return 'Your message could not be submitted right now. Please review the form and try again.';
}

function safeTokenErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
    return 'The secure form has reached its request limit. Please wait before preparing it again.';
  }
  if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
    return 'The message service could not be reached. Check your connection and prepare the form again.';
  }
  return 'The secure form could not be prepared. Please try again.';
}

async function getUsableToken(
  currentToken: MessageToken | null,
  loadToken: () => Promise<MessageToken | null>,
): Promise<string | null> {
  let token = currentToken;
  let age = token ? Date.now() - Date.parse(token.issuedAt) : Number.NaN;
  if (!token || !Number.isFinite(age) || age < 0 || age > 9 * 60 * 1000) {
    token = await loadToken();
    if (!token) return null;
    age = Date.now() - Date.parse(token.issuedAt);
  }
  const minimumAgeWait = Math.max(0, 3000 - age);
  if (minimumAgeWait) {
    await new Promise((resolve) => window.setTimeout(resolve, minimumAgeWait));
  }
  return token.token;
}

export function ContactForm() {
  const [messageToken, setMessageToken] = useState<MessageToken | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submission, setSubmission] = useState<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { website: '' },
  });

  const loadToken = useCallback(async (forceRefresh = false) => {
    setTokenLoading(true);
    setTokenError('');
    try {
      const nextToken = await api.messageToken(forceRefresh);
      setMessageToken(nextToken);
      return nextToken;
    } catch (error) {
      setMessageToken(null);
      setTokenError(safeTokenErrorMessage(error));
      return null;
    } finally {
      setTokenLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api
      .messageToken()
      .then((nextToken) => {
        if (!active) return;
        setMessageToken(nextToken);
        setTokenError('');
        setTokenLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setTokenError(safeTokenErrorMessage(error));
        setTokenLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = handleSubmit(async (values) => {
    setSubmitError('');
    setSuccessMessage('');
    if (tokenLoading) {
      setSubmitError(
        'The secure form is still loading. Please try again shortly.',
      );
      return;
    }
    const token = await getUsableToken(messageToken, loadToken);
    if (!token) {
      return;
    }

    const fingerprint = JSON.stringify([
      values.name.trim(),
      values.email.trim().toLowerCase(),
      values.orderNumber?.trim() ?? '',
      values.subject.trim(),
      values.message.trim(),
    ]);
    const submissionId =
      submission?.fingerprint === fingerprint
        ? submission.id
        : crypto.randomUUID();
    setSubmission({ fingerprint, id: submissionId });

    const input: ContactMessageInput = {
      name: values.name.trim(),
      email: values.email.trim(),
      subject: values.subject.trim(),
      message: values.message.trim(),
      token,
      submissionId,
      website: values.website ?? '',
      ...(values.orderNumber?.trim()
        ? { orderNumber: values.orderNumber.trim() }
        : {}),
    };

    try {
      const result = await api.submitContactMessage(input);
      setSuccessMessage(result.message);
      setSubmission(null);
      reset({ website: '' });
      document.querySelector<HTMLElement>('[data-contact-success]')?.focus();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const issue of parseServerIssues(error.details)) {
          setError(issue.field, { type: 'server', message: issue.message });
        }
        if (error.code === 'MESSAGE_TOKEN_INVALID') {
          await loadToken(true);
        }
        setSubmitError(safeErrorMessage(error));
      } else {
        setSubmitError(
          'Your message could not be submitted right now. Please try again.',
        );
      }
    }
  });

  return (
    <section
      className="commerce-card contact-form-card"
      aria-labelledby="contact-form-title"
    >
      <div className="contact-form-card__heading">
        <span className="eyebrow">Send a message</span>
        <h2 id="contact-form-title">How can we help?</h2>
        <p>Fields marked required must be completed.</p>
      </div>

      {successMessage ? (
        <div
          className="commerce-alert contact-form__success"
          role="status"
          aria-live="polite"
          tabIndex={-1}
          data-contact-success
        >
          <span>
            <strong>Message received</strong>
            <span>{successMessage}</span>
          </span>
        </div>
      ) : null}
      {submitError ? (
        <div className="commerce-alert commerce-alert--error" role="alert">
          <p>{submitError}</p>
        </div>
      ) : null}
      {tokenError ? (
        <div className="commerce-alert commerce-alert--error" role="alert">
          <p>{tokenError}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadToken()}
          >
            Prepare form
          </Button>
        </div>
      ) : null}

      <form
        className="contact-form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="contact-form__honeypot" aria-hidden="true" hidden>
          <label htmlFor="contact-website">Leave this field empty</label>
          <input
            id="contact-website"
            type="text"
            autoComplete="off"
            tabIndex={-1}
            {...register('website')}
          />
        </div>
        <Input
          label="Name"
          autoComplete="name"
          maxLength={120}
          required
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Email address"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Order number"
          autoComplete="off"
          maxLength={40}
          hint="Optional — include this if your question is about an order."
          error={errors.orderNumber?.message}
          {...register('orderNumber')}
        />
        <Input
          label="Subject"
          maxLength={160}
          required
          error={errors.subject?.message}
          {...register('subject')}
        />
        <Textarea
          label="Message"
          required
          maxLength={5000}
          rows={7}
          error={errors.message?.message}
          {...register('message')}
        />
        <Button
          type="submit"
          loading={isSubmitting}
          disabled={tokenLoading || !messageToken}
        >
          {tokenLoading ? 'Preparing secure form…' : 'Send message'}
        </Button>
        <p className="contact-form__privacy">
          Please do not include payment card details or passwords in your
          message.
        </p>
      </form>
    </section>
  );
}
