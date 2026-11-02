import type { RequestHandler } from 'express';

import {
  clearAuthCookies,
  changePassword,
  loginUser,
  logoutUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  rotateRefreshToken,
  setAuthCookies,
  toSafeUser,
  updateProfile,
} from '../services/auth.service';
import { ROLE_PERMISSIONS } from '../constants/permissions';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  ProfileInput,
  RegisterInput,
  ResetPasswordInput,
} from '../validators/auth.validators';

export const register: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const user = await registerUser(req.body as RegisterInput);
    res.status(201).json({
      success: true,
      data: {
        user: toSafeUser(user),
        permissions: ROLE_PERMISSIONS[user.role],
      },
    });
  },
);

export const login: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const input = req.body as LoginInput;
    const user = await loginUser(
      input.email,
      input.password,
      req.ip,
      req.guestSessionId,
      input.portal,
    );
    setAuthCookies(res, user);
    res.json({
      success: true,
      data: {
        user: toSafeUser(user),
        permissions: ROLE_PERMISSIONS[user.role],
      },
    });
  },
);

export const logout: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const user = getUser(req);
    await logoutUser(user, req.ip);
    clearAuthCookies(res);
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  },
);

export const refresh: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const token = req.cookies?.daintyRefreshToken as string | undefined;
    if (!token) {
      throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    const user = await rotateRefreshToken(token);
    setAuthCookies(res, user);
    res.json({ success: true, data: { message: 'Session refreshed' } });
  },
);

export const me: RequestHandler = (req, res): void => {
  const user = getUser(req);
  res.json({
    success: true,
    data: {
      user: toSafeUser(user),
      permissions: ROLE_PERMISSIONS[user.role],
    },
  });
};

export const updateMe: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const user = await updateProfile(
      getUser(req)._id.toString(),
      req.body as ProfileInput,
    );
    res.json({ success: true, data: { user: toSafeUser(user) } });
  },
);

export const updatePassword: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const input = req.body as ChangePasswordInput;
    const user = await changePassword(
      getUser(req),
      input.currentPassword,
      input.newPassword,
      req.ip,
    );
    setAuthCookies(res, user);
    res.json({ success: true, data: { user: toSafeUser(user) } });
  },
);

export const forgotPassword: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const input = req.body as ForgotPasswordInput;
    try {
      await requestPasswordReset(input.email);
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        !['EMAIL_NOT_CONFIGURED', 'EMAIL_DELIVERY_FAILED'].includes(error.code)
      ) {
        throw error;
      }
    }
    res.json({
      success: true,
      data: {
        message:
          'If an account exists for that email, the reset request has been received.',
      },
    });
  },
);

export const resetPasswordHandler: RequestHandler = asyncHandler(
  async (req, res): Promise<void> => {
    const input = req.body as ResetPasswordInput;
    await resetPassword(input.token, input.password, req.ip);
    res.json({
      success: true,
      data: { message: 'Password reset successfully' },
    });
  },
);

function getUser(req: Parameters<RequestHandler>[0]) {
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }
  return req.user;
}
