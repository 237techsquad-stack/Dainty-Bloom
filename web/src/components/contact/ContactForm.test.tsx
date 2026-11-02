import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const { messageTokenMock, submitContactMessageMock } = vi.hoisted(() => ({
  messageTokenMock: vi.fn(),
  submitContactMessageMock: vi.fn(),
}));

vi.mock('@/lib/api/client', () => {
  class TestApiError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly details: unknown,
      readonly status: number,
    ) {
      super(message);
    }
  }

  return {
    ApiError: TestApiError,
    api: {
      messageToken: messageTokenMock,
      submitContactMessage: submitContactMessageMock,
    },
  };
});

import { ApiError } from '@/lib/api/client';
import { ContactForm } from './ContactForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ContactForm delivery feedback', () => {
  it('uses the same submission ID for a safe retry and explains the saved enquiry', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '37c87063-1ab2-4c85-9430-f28bd7aeb454',
    });
    messageTokenMock.mockResolvedValue({
      token: 'signed-message-token',
      issuedAt: new Date(Date.now() - 5_000).toISOString(),
    });
    submitContactMessageMock
      .mockRejectedValueOnce(
        new ApiError('Network unavailable', 'NETWORK_ERROR', null, 0),
      )
      .mockResolvedValueOnce({ message: 'We received your message.' });

    render(<ContactForm />);

    await screen.findByRole('button', { name: 'Send message' });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Sample Customer' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'customer@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Question about an order' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Please check the status of my order.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'retry the unchanged form; it will not create a duplicate enquiry',
    );

    const submitButton = screen.getByRole('button', {
      name: 'Send message',
    }) as HTMLButtonElement;
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);
    expect(await screen.findByText('We received your message.')).toBeTruthy();

    expect(submitContactMessageMock).toHaveBeenCalledTimes(2);
    expect(submitContactMessageMock.mock.calls[0]?.[0].submissionId).toBe(
      submitContactMessageMock.mock.calls[1]?.[0].submissionId,
    );
  });
});
