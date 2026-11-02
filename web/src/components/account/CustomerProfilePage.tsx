'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api/client';
import type { AuthResponse, AuthUser } from '@/lib/api/types';

const addressSchema = z.object({
  label: z.string().trim().min(1, 'Enter an address label.').max(80),
  line1: z.string().trim().min(1, 'Enter the first address line.').max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1, 'Enter a town or city.').max(100),
  state: z.string().trim().min(1, 'Enter a county, state, or region.').max(100),
  postalCode: z.string().trim().min(1, 'Enter a postcode or postal code.').max(32),
  country: z.string().trim().min(2, 'Enter a country.').max(100),
  isDefault: z.boolean(),
});

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120, 'Name must be 120 characters or fewer.'),
  phone: z.string().trim().max(40, 'Phone number must be 40 characters or fewer.'),
  addresses: z.array(addressSchema).max(30, 'You can save up to 30 addresses.'),
});

type ProfileValues = z.infer<typeof profileSchema>;
type AddressField = keyof z.infer<typeof addressSchema>;

function profileValues(user: AuthUser): ProfileValues {
  return {
    name: user.name,
    phone: user.phone ?? '',
    addresses: user.addresses.map((address) => ({
      label: address.label,
      line1: address.line1,
      line2: address.line2 ?? '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      isDefault: address.isDefault,
    })),
  };
}

function serverValidationIssues(details: unknown): Array<{
  field: 'name' | 'phone' | 'address';
  index?: number;
  addressField?: AddressField;
}> {
  if (!Array.isArray(details)) return [];
  const issues: Array<{
    field: 'name' | 'phone' | 'address';
    index?: number;
    addressField?: AddressField;
  }> = [];
  const addressFields = new Set<AddressField>([
    'label',
    'line1',
    'line2',
    'city',
    'state',
    'postalCode',
    'country',
    'isDefault',
  ]);

  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const path: unknown = Reflect.get(detail, 'path');
    if (!Array.isArray(path)) continue;
    if (path.includes('name')) issues.push({ field: 'name' });
    else if (path.includes('phone')) issues.push({ field: 'phone' });
    else {
      const addressIndex = path.findIndex((part) => part === 'addresses');
      const index = addressIndex >= 0 ? path[addressIndex + 1] : undefined;
      const addressField = path.find(
        (part): part is AddressField =>
          typeof part === 'string' && addressFields.has(part as AddressField),
      );
      if (
        typeof index === 'number' &&
        Number.isInteger(index) &&
        addressField
      ) {
        issues.push({ field: 'address', index, addressField });
      }
    }
  }
  return issues;
}

export function CustomerProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoading, authError, retryAuth } = useAuth();
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  if (isLoading) {
    return (
      <div className="commerce-page">
        <div className="commerce-skeleton" role="status" aria-live="polite">
          <span className="sr-only">Loading your account…</span>
          <div className="commerce-skeleton__block" />
        </div>
      </div>
    );
  }

  if (!user) {
    if (authError) {
      return (
        <div className="commerce-page">
          <section className="commerce-card commerce-state" role="alert">
            <h1>Your profile could not be loaded</h1>
            <p>Please check your connection and try again.</p>
            <Button variant="secondary" onClick={() => void retryAuth()}>
              Retry
            </Button>
          </section>
        </div>
      );
    }
    return (
      <div className="commerce-page">
        <section className="commerce-card checkout-signin">
          <h1>Sign in to view your profile</h1>
          <p>Your profile is available with your customer account.</p>
          <Button onClick={() => router.push('/login?next=%2Faccount%2Fprofile')}>
            Sign in
          </Button>
        </section>
      </div>
    );
  }

  if (user.role !== 'customer') {
    return (
      <div className="commerce-page">
        <section className="commerce-card commerce-state" role="alert">
          <h1>This page is for customer accounts</h1>
          <p>Customer profile details are not available from this account.</p>
          <Link className="button button--secondary" href="/">
            Return to the shop
          </Link>
        </section>
      </div>
    );
  }

  return (
    <CustomerProfileForm
      user={user}
      queryClient={queryClient}
      errorMessage={errorMessage}
      successMessage={successMessage}
      setErrorMessage={setErrorMessage}
      setSuccessMessage={setSuccessMessage}
    />
  );
}

function CustomerProfileForm({
  user,
  queryClient,
  errorMessage,
  successMessage,
  setErrorMessage,
  setSuccessMessage,
}: {
  user: AuthUser;
  queryClient: ReturnType<typeof useQueryClient>;
  errorMessage: string;
  successMessage: string;
  setErrorMessage: (message: string) => void;
  setSuccessMessage: (message: string) => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: profileValues(user),
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'addresses',
  });
  const addresses = useWatch({ control, name: 'addresses' });

  const submit = handleSubmit(async (values) => {
    setErrorMessage('');
    setSuccessMessage('');
    const input = {
      name: values.name.trim(),
      phone: values.phone.trim(),
      addresses: values.addresses.map((address) => ({
        label: address.label.trim(),
        line1: address.line1.trim(),
        ...(address.line2?.trim()
          ? { line2: address.line2.trim() }
          : {}),
        city: address.city.trim(),
        state: address.state.trim(),
        postalCode: address.postalCode.trim(),
        country: address.country.trim(),
        isDefault: address.isDefault,
      })),
    };

    try {
      const result = await api.updateProfile(input);
      queryClient.setQueryData<AuthResponse>(['auth', 'me'], (current) =>
        current ? { ...current, user: result.user } : current,
      );
      reset(profileValues(result.user));
      setSuccessMessage('Your profile was updated.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        for (const issue of serverValidationIssues(error.details)) {
          if (issue.field === 'name') {
            setError('name', {
              type: 'server',
              message: 'Please check your name and try again.',
            });
          } else if (issue.field === 'phone') {
            setError('phone', {
              type: 'server',
              message: 'Please check your phone number and try again.',
            });
          } else if (
            issue.field === 'address' &&
            issue.index !== undefined &&
            issue.addressField
          ) {
            const path =
              `addresses.${issue.index}.${issue.addressField}` as FieldPath<ProfileValues>;
            setError(path, {
              type: 'server',
              message: 'Please check this address field.',
            });
          }
        }
        setErrorMessage('Some profile details need attention. Review the marked fields.');
      } else if (error instanceof ApiError && error.status === 401) {
        setErrorMessage(
          'Your session could not be verified. Sign in again before saving changes.',
        );
      } else {
        setErrorMessage(
          'Your profile could not be updated right now. Please try again.',
        );
      }
    }
  });

  return (
    <div className="commerce-page customer-profile">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/account/orders">My account</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Profile</span>
      </nav>

      <div className="commerce-page__heading">
        <div>
          <h1>My profile</h1>
          <p>View and update the details saved to your customer account.</p>
        </div>
      </div>

      <nav className="customer-profile__navigation" aria-label="Account pages">
        <Link href="/account/profile" aria-current="page">
          My profile
        </Link>
        <Link href="/account/orders">My orders</Link>
      </nav>

      <section
        className="commerce-card customer-profile__card"
        aria-labelledby="profile-details-heading"
      >
        <div className="customer-profile__section-heading">
          <h2 id="profile-details-heading">Personal details</h2>
          <p>Email address is shown for reference and cannot be changed here.</p>
        </div>

        {successMessage ? (
          <p className="commerce-alert customer-profile__success" role="status" aria-live="polite">
            {successMessage}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="commerce-alert commerce-alert--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <form
          className="customer-profile__form"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <Input label="Email address" type="email" value={user.email} readOnly />
          <Input
            label="Name"
            autoComplete="name"
            maxLength={120}
            required
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Phone number"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            error={errors.phone?.message}
            {...register('phone')}
          />

          <fieldset className="customer-profile__addresses">
            <legend>Saved addresses</legend>
            <p className="field-hint">
              Add or update addresses for your account. Each saved address
              requires all fields except address line 2.
            </p>
            {fields.length ? (
              <div className="customer-profile__address-list">
                {fields.map((field, index) => (
                  <fieldset
                    className="customer-profile__address"
                    key={field.id}
                  >
                    <legend>Address {index + 1}</legend>
                    <Input
                      label="Address label"
                      maxLength={80}
                      required
                      error={errors.addresses?.[index]?.label?.message}
                      {...register(`addresses.${index}.label`)}
                    />
                    <Input
                      label="Address line 1"
                      autoComplete="address-line1"
                      maxLength={160}
                      required
                      error={errors.addresses?.[index]?.line1?.message}
                      {...register(`addresses.${index}.line1`)}
                    />
                    <Input
                      label="Address line 2"
                      autoComplete="address-line2"
                      maxLength={160}
                      error={errors.addresses?.[index]?.line2?.message}
                      {...register(`addresses.${index}.line2`)}
                    />
                    <Input
                      label="Town or city"
                      autoComplete="address-level2"
                      maxLength={100}
                      required
                      error={errors.addresses?.[index]?.city?.message}
                      {...register(`addresses.${index}.city`)}
                    />
                    <Input
                      label="County, state, or region"
                      autoComplete="address-level1"
                      maxLength={100}
                      required
                      error={errors.addresses?.[index]?.state?.message}
                      {...register(`addresses.${index}.state`)}
                    />
                    <Input
                      label="Postcode or postal code"
                      autoComplete="postal-code"
                      maxLength={32}
                      required
                      error={errors.addresses?.[index]?.postalCode?.message}
                      {...register(`addresses.${index}.postalCode`)}
                    />
                    <Input
                      label="Country"
                      autoComplete="country-name"
                      maxLength={100}
                      required
                      error={errors.addresses?.[index]?.country?.message}
                      {...register(`addresses.${index}.country`)}
                    />
                    <label className="customer-profile__default-address">
                      <input
                        type="checkbox"
                        {...register(`addresses.${index}.isDefault`)}
                      />
                      <span>Use as default address</span>
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => remove(index)}
                    >
                      Remove address
                    </Button>
                  </fieldset>
                ))}
              </div>
            ) : (
              <p className="customer-profile__empty-address">
                No saved addresses.
              </p>
            )}
            {errors.addresses?.root?.message ? (
              <p className="field-error" role="alert">
                {errors.addresses.root.message}
              </p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={fields.length >= 30}
              onClick={() =>
                append({
                  label: '',
                  line1: '',
                  line2: '',
                  city: '',
                  state: '',
                  postalCode: '',
                  country: '',
                  isDefault: !addresses.some((address) => address?.isDefault),
                })
              }
            >
              Add address
            </Button>
          </fieldset>

          <div className="customer-profile__actions">
            <Button type="submit" loading={isSubmitting}>
              Save profile
            </Button>
            <Link className="button button--secondary" href="/account/orders">
              View my orders
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
