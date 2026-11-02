'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { useAuth } from '@/components/providers/AuthProvider';
import { api, ApiError } from '@/lib/api/client';
import type { CustomProductRequestInput, MessageToken } from '@/lib/api/types';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i;

const safeText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine(
      (value) => !value || !HTML_TAG_PATTERN.test(value),
      'HTML is not allowed.',
    );

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const requestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter your name.')
      .max(120, 'Name must be 120 characters or fewer.')
      .refine((value) => !HTML_TAG_PATTERN.test(value), 'HTML is not allowed.'),
    email: z
      .string()
      .trim()
      .email('Enter a valid email address.')
      .max(254, 'Email must be 254 characters or fewer.'),
    phone: safeText(40, 'Phone number'),
    productType: z.enum(
      [
        '',
        'Custom 3D print or figurine',
        'Paint-it-yourself canvas or custom artwork',
        'Personalised clothing',
        'Mug or drinkware',
        'Phone case',
        'Other personalised or custom product',
        'Other',
      ],
      { error: 'Choose a product type.' },
    ),
    otherProductType: safeText(120, 'Product type'),
    productName: z
      .string()
      .trim()
      .min(1, 'Enter a short title for your request.')
      .max(160, 'Request title must be 160 characters or fewer.')
      .refine((value) => !HTML_TAG_PATTERN.test(value), 'HTML is not allowed.'),
    description: z
      .string()
      .trim()
      .min(20, 'Describe your idea in at least 20 characters.')
      .max(2000, 'Description must be 2,000 characters or fewer.')
      .refine((value) => !HTML_TAG_PATTERN.test(value), 'HTML is not allowed.'),
    approximateSize: safeText(200, 'Approximate size'),
    preferredColour: safeText(120, 'Preferred colour'),
    preferredMaterial: safeText(120, 'Preferred material'),
    budget: safeText(120, 'Budget'),
    imagePurpose: z.enum(['no_image', 'my_design', 'reference', 'example']),
    quantity: z
      .string()
      .refine(
        (value) =>
          value === '' ||
          (Number.isFinite(Number(value)) &&
            Number(value) > 0 &&
            Number.isInteger(Number(value))),
        'Enter a whole number greater than zero.',
      ),
    neededByDate: z
      .string()
      .refine(
        (value) => value === '' || isCalendarDate(value),
        'Enter a valid date.',
      ),
  })
  .superRefine((values, context) => {
    if (!values.productType) {
      context.addIssue({
        code: 'custom',
        path: ['productType'],
        message: 'Choose a product type.',
      });
    }
    if (values.productType === 'Other' && !values.otherProductType.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['otherProductType'],
        message: 'Describe the product type you have in mind.',
      });
    }
  });

type RequestValues = z.infer<typeof requestSchema>;
type RequestField = keyof RequestValues;
const REQUEST_FIELDS = new Set<RequestField>([
  'name',
  'email',
  'phone',
  'productType',
  'otherProductType',
  'imagePurpose',
  'productName',
  'description',
  'approximateSize',
  'preferredColour',
  'preferredMaterial',
  'budget',
  'quantity',
  'neededByDate',
]);

function parseServerIssues(
  details: unknown,
): Array<{ field: RequestField; message: string }> {
  if (!Array.isArray(details)) return [];
  const issues: Array<{ field: RequestField; message: string }> = [];
  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const issue = detail as { path?: unknown; message?: unknown };
    if (!Array.isArray(issue.path) || typeof issue.message !== 'string')
      continue;
    const pathField = [...issue.path]
      .reverse()
      .find(
        (part): part is RequestField =>
          typeof part === 'string' && REQUEST_FIELDS.has(part as RequestField),
      );
    if (pathField) issues.push({ field: pathField, message: issue.message });
  }
  return issues;
}

function safeErrorMessage(error: ApiError): string {
  if (error.code === 'RATE_LIMITED') {
    return 'There have been too many attempts. Please wait a little while before trying again.';
  }
  if (error.code === 'MESSAGE_TOKEN_INVALID') {
    return 'The form security check expired. We refreshed it; please submit your request again.';
  }
  if (error.code === 'NETWORK_ERROR') {
    return 'We could not confirm whether your request was received. Please contact us before resubmitting to avoid a duplicate.';
  }
  if (error.code === 'FILE_TOO_LARGE') {
    return 'The image exceeds the allowed file size. Choose a smaller image and try again.';
  }
  if (error.code === 'FILE_TYPE_NOT_ALLOWED' || error.code === 'FILE_CORRUPT') {
    return 'The image could not be accepted. Choose a valid JPEG, PNG, or WebP image.';
  }
  return 'Your request could not be submitted right now. Please review the form and try again.';
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
  if (!Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000) return null;
  const minimumAgeWait = Math.max(0, 3000 - age);
  if (minimumAgeWait) {
    await new Promise((resolve) => window.setTimeout(resolve, minimumAgeWait));
  }
  return token.token;
}

function formatFileLimit(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number(megabytes.toFixed(2))} MB`;
}

export function CustomProductRequestForm({
  maxUploadBytes,
}: {
  maxUploadBytes: number | null;
}) {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [messageToken, setMessageToken] = useState<MessageToken | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState('');
  const [imageInputVersion, setImageInputVersion] = useState(0);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    clearErrors,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      productType: '',
      otherProductType: '',
      productName: '',
      description: '',
      approximateSize: '',
      preferredColour: '',
      preferredMaterial: '',
      budget: '',
      imagePurpose: 'no_image',
      quantity: '',
      neededByDate: '',
    },
  });
  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== 'customer') {
      router.replace('/login?next=%2Fcustom-3d-request');
      return;
    }
    setValue('name', user.name);
    setValue('email', user.email);
  }, [authLoading, router, setValue, user]);
  const description = useWatch({ control, name: 'description' });
  const productType = useWatch({ control, name: 'productType' });

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
    if (authLoading || !user || user.role !== 'customer') return;
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
  }, [authLoading, user]);

  const selectImage = (file: File | undefined) => {
    setImageError('');
    if (!file) {
      setReferenceImage(null);
      return;
    }
    if (!IMAGE_TYPES.has(file.type)) {
      setImageError('Choose a JPEG, PNG, or WebP image.');
      setImageInputVersion((version) => version + 1);
      return;
    }
    if (maxUploadBytes !== null && file.size > maxUploadBytes) {
      setImageError(
        `Choose an image no larger than ${formatFileLimit(maxUploadBytes)}.`,
      );
      setImageInputVersion((version) => version + 1);
      return;
    }
    setReferenceImage(file);
  };

  const submit = handleSubmit(async (values) => {
    if (!user || user.role !== 'customer') {
      router.replace('/login?next=%2Fcustom-3d-request');
      return;
    }
    setSubmitError('');
    setSuccessMessage('');
    setImageError('');
    if (
      (referenceImage && values.imagePurpose === 'no_image') ||
      (!referenceImage && values.imagePurpose !== 'no_image')
    ) {
      setError('imagePurpose', {
        type: 'manual',
        message: referenceImage
          ? 'Choose how we should use the uploaded image.'
          : 'Choose “No image” or upload an image to explain its purpose.',
      });
      return;
    }
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

    const descriptionText = values.description.trim();
    const details: CustomProductRequestInput['requestDetails'] = {
      description: descriptionText,
      productName: values.productName.trim(),
      productType: values.productType,
      ...(values.productType === 'Other'
        ? { otherProductType: values.otherProductType.trim() }
        : {}),
      ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
      ...(values.approximateSize.trim()
        ? { approximateSize: values.approximateSize.trim() }
        : {}),
      ...(values.preferredColour.trim()
        ? { preferredColour: values.preferredColour.trim() }
        : {}),
      ...(values.preferredMaterial.trim()
        ? { preferredMaterial: values.preferredMaterial.trim() }
        : {}),
      ...(values.budget.trim() ? { budget: values.budget.trim() } : {}),
      ...(values.quantity ? { quantity: Number(values.quantity) } : {}),
      ...(values.neededByDate ? { neededByDate: values.neededByDate } : {}),
    };
    const input: CustomProductRequestInput = {
      name: user.name,
      email: user.email,
      subject: `Custom product request: ${values.productName.trim()}`,
      message: descriptionText,
      token,
      website: '',
      requestDetails: details,
      imagePurpose: values.imagePurpose,
      ...(referenceImage ? { referenceImage } : {}),
    };

    try {
      await api.submitCustomProductRequest(input);
      setSuccessMessage(
        'Your request has been received. We’ll review it and get back to you about availability, pricing, feasibility, and next steps.',
      );
      reset();
      setReferenceImage(null);
      setImageInputVersion((version) => version + 1);
      document.querySelector<HTMLElement>('[data-custom-3d-success]')?.focus();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const issue of parseServerIssues(error.details)) {
          setError(issue.field, { type: 'server', message: issue.message });
        }
        if (error.code === 'MESSAGE_TOKEN_INVALID') {
          await loadToken(true);
        }
        if (
          error.code === 'FILE_TOO_LARGE' ||
          error.code === 'FILE_TYPE_NOT_ALLOWED'
        ) {
          setImageError(safeErrorMessage(error));
        }
        setSubmitError(safeErrorMessage(error));
      } else {
        setSubmitError(
          'Your request could not be submitted right now. Please try again.',
        );
      }
    }
  });

  if (authLoading || !user || user.role !== 'customer') {
    return (
      <p className="commerce-card" role="status">
        {authLoading ? 'Checking your account…' : 'Redirecting to sign in…'}
      </p>
    );
  }

  return (
    <section
      className="commerce-card contact-form-card custom-3d-form-card"
      aria-labelledby="custom-3d-form-title"
    >
      <div className="contact-form-card__heading">
        <span className="eyebrow">Share your idea</span>
        <h2 id="custom-3d-form-title">Custom product request details</h2>
        <p>
          Fields marked required must be completed. Describe your idea in
          20–2,000 characters. Requests are reviewed before availability,
          pricing, and production feasibility can be confirmed.
        </p>
      </div>

      {successMessage ? (
        <div
          className="commerce-alert contact-form__success"
          role="status"
          aria-live="polite"
          tabIndex={-1}
          data-custom-3d-success
        >
          <span>
            <strong>Request received</strong>
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
        className="contact-form custom-3d-form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="contact-form__honeypot" aria-hidden="true" hidden>
          <label htmlFor="custom-3d-website">Leave this field empty</label>
          <input
            id="custom-3d-website"
            type="text"
            autoComplete="off"
            tabIndex={-1}
            name="website"
            value=""
            readOnly
          />
        </div>

        <Input
          label="Name (required)"
          autoComplete="name"
          maxLength={120}
          required
          readOnly
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Email address (required)"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          readOnly
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Phone or preferred contact number (optional)"
          type="tel"
          autoComplete="tel"
          maxLength={40}
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Select
          label="Product type (required)"
          required
          error={errors.productType?.message}
          {...register('productType')}
        >
          <option value="">Choose a product type</option>
          <option value="Custom 3D print or figurine">
            Custom 3D print or figurine
          </option>
          <option value="Paint-it-yourself canvas or custom artwork">
            Paint-it-yourself canvas or custom artwork
          </option>
          <option value="Personalised clothing">Personalised clothing</option>
          <option value="Mug or drinkware">Mug or drinkware</option>
          <option value="Phone case">Phone case</option>
          <option value="Other personalised or custom product">
            Other personalised or custom product
          </option>
          <option value="Other">Other</option>
        </Select>
        {productType === 'Other' ? (
          <Input
            label="What kind of product? (required)"
            maxLength={120}
            required
            error={errors.otherProductType?.message}
            {...register('otherProductType')}
          />
        ) : null}
        <Input
          label="Product name or short request title (required)"
          maxLength={160}
          required
          error={errors.productName?.message}
          {...register('productName')}
        />
        <div className="custom-3d-form__description">
          <Textarea
            id="custom-3d-description"
            label="What would you like us to make? (required)"
            required
            maxLength={2000}
            rows={7}
            error={errors.description?.message}
            aria-describedby={
              errors.description
                ? 'custom-3d-description-hint custom-3d-description-count custom-3d-description-error'
                : 'custom-3d-description-hint custom-3d-description-count'
            }
            {...register('description')}
          />
          <p id="custom-3d-description-hint" className="field-hint">
            Describe the item, how you would use it, and any important details.
            If your image is only a reference, explain what you want to be
            different. A finished design is not required. Avoid HTML.
          </p>
          <p id="custom-3d-description-count" className="custom-3d-form__count">
            {description.trim().length}/2,000 characters (minimum 20)
          </p>
        </div>

        <div className="custom-3d-form__details">
          <Input
            label="Desired size or dimensions"
            maxLength={200}
            hint="Optional — include units such as cm or inches, or explain what size you have in mind."
            error={errors.approximateSize?.message}
            {...register('approximateSize')}
          />
          <Input
            label="Preferred colour"
            maxLength={120}
            error={errors.preferredColour?.message}
            {...register('preferredColour')}
          />
          <Input
            label="Preferred material"
            maxLength={120}
            error={errors.preferredMaterial?.message}
            {...register('preferredMaterial')}
          />
          <Input
            label="Budget range (optional)"
            maxLength={120}
            hint="If you have a budget in mind, include the amount and currency."
            error={errors.budget?.message}
            {...register('budget')}
          />
          <Input
            label="Quantity"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            error={errors.quantity?.message}
            {...register('quantity')}
          />
          <Input
            label="Preferred deadline"
            type="date"
            error={errors.neededByDate?.message}
            {...register('neededByDate')}
          />
        </div>

        <div className="custom-3d-form__upload">
          <Select
            label="How should we use your image?"
            error={errors.imagePurpose?.message}
            hint="Choose “No image” if you’ll describe your idea without an upload."
            {...register('imagePurpose', {
              onChange: () => clearErrors('imagePurpose'),
            })}
          >
            <option value="no_image">No image — I’ll describe my idea</option>
            <option value="my_design">
              This is my design — please use it for my custom product.
            </option>
            <option value="reference">
              This is a reference image — use it for inspiration, but I want
              something unique.
            </option>
            <option value="example">
              This image is just an example; I’ll explain what I want in my
              message.
            </option>
          </Select>
          <Input
            key={imageInputVersion}
            label="Design or reference image (optional)"
            type="file"
            accept={IMAGE_ACCEPT}
            hint={
              maxUploadBytes === null
                ? 'JPEG, PNG, or WebP. The server checks the configured size limit.'
                : `JPEG, PNG, or WebP. Maximum size: ${formatFileLimit(maxUploadBytes)}.`
            }
            error={imageError}
            onChange={(event) => selectImage(event.currentTarget.files?.[0])}
          />
          {referenceImage ? (
            <div className="custom-3d-form__selected-file">
              <span>{referenceImage.name}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setReferenceImage(null);
                  setImageError('');
                  setValue('imagePurpose', 'no_image', {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setImageInputVersion((version) => version + 1);
                }}
              >
                Remove image
              </Button>
            </div>
          ) : null}
          <p className="field-hint">
            Upload your own design or an image for inspiration. The selected
            file is checked again by the server; its filename and
            browser-reported type are not used as proof of image content.
          </p>
        </div>

        <Button
          type="submit"
          loading={isSubmitting}
          disabled={tokenLoading || !messageToken}
        >
          {tokenLoading
            ? 'Preparing secure form…'
            : 'Send custom product request'}
        </Button>
        <p className="contact-form__privacy">
          Do not include payment card details or passwords.
        </p>
      </form>
    </section>
  );
}
