'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Permission, Role, UserDto } from '@pharmacy-os/shared-types';
import { hasPermission as checkPermission } from '@pharmacy-os/shared-types';
import { api, getAccessToken, setAccessToken } from './api-client';
import { toast } from 'sonner';

interface AuthContextType {
  user: UserDto | null;
  isLoading: boolean;
  login: (username: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchUser: (username: string) => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const token = getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }
      const u = await api.auth.me();
      setUser(u);
    } catch {
      setUser(null);
      setAccessToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const login = async (username: string, password = 'Demo@12345') => {
    setIsLoading(true);
    try {
      const res = await api.auth.login({ username, password });
      setAccessToken(res.accessToken);
      setUser(res.user);
      toast.success(`Signed in as ${res.user.name} (${res.user.role})`);
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // ignore
    } finally {
      setAccessToken(null);
      setUser(null);
      toast.info('Logged out');
    }
  };

  const switchUser = async (username: string) => {
    await login(username, 'Demo@12345');
  };

  const hasPermission = (permission: Permission): boolean => {
    if (!user) return false;
    return checkPermission(user.role as Role, permission);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        switchUser,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
