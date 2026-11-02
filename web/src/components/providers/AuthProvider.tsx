'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api/client';
import type {
  AuthCredentials,
  AuthResponse,
  AuthUser,
  Permission,
  RegisterInput,
} from '@/lib/api/types';

interface AuthContextValue {
  user: AuthUser | null;
  permissions: Permission[];
  isLoading: boolean;
  authError: unknown;
  retryAuth: () => Promise<void>;
  login: (credentials: AuthCredentials) => Promise<AuthResponse>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [loggedOut, setLoggedOut] = useState(false);
  const loggedOutRef = useRef(false);
  const {
    data: meData,
    error: meError,
    isLoading: meIsLoading,
    refetch: refetchMe,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });

  useEffect(() => {
    const onLoggedOut = () => {
      loggedOutRef.current = true;
      setLoggedOut(true);
      queryClient.setQueryData(['auth', 'me'], null);
    };
    window.addEventListener('auth:logged-out', onLoggedOut);
    return () => window.removeEventListener('auth:logged-out', onLoggedOut);
  }, [queryClient]);

  const refreshCustomerData = useCallback(async () => {
    loggedOutRef.current = false;
    setLoggedOut(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
      queryClient.invalidateQueries({ queryKey: ['cart-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
    ]);
  }, [queryClient]);
  const retryAuth = useCallback(async () => {
    await refetchMe();
  }, [refetchMe]);

  const login = useCallback(
    async (credentials: AuthCredentials) => {
      const result = await api.login(credentials);
      queryClient.setQueryData(['auth', 'me'], result);
      await refreshCustomerData();
      return result;
    },
    [queryClient, refreshCustomerData],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await api.register(input);
      const result = await api.login({
        email: input.email,
        password: input.password,
        portal: 'customer',
      });
      queryClient.setQueryData(['auth', 'me'], result);
      await refreshCustomerData();
    },
    [queryClient, refreshCustomerData],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        loggedOutRef.current
      ) {
        return;
      }
      throw error;
    }
    loggedOutRef.current = true;
    setLoggedOut(true);
    queryClient.setQueryData(['auth', 'me'], null);
    queryClient.clear();
  }, [queryClient]);

  const user = loggedOut ? null : (meData?.user ?? null);
  const permissions = useMemo(
    () => (loggedOut ? [] : (meData?.permissions ?? [])),
    [loggedOut, meData?.permissions],
  );
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      isLoading: meIsLoading && !loggedOut,
      authError: meError,
      retryAuth,
      login,
      register,
      logout,
    }),
    [
      user,
      permissions,
      meIsLoading,
      meError,
      loggedOut,
      retryAuth,
      login,
      register,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePermissions() {
  const { permissions } = useAuth();
  return {
    permissions,
    can: (permission: Permission) => permissions.includes(permission),
  };
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function getAuthErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Unable to continue. Please try again.';
}
