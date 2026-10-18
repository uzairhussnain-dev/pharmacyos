import { describe, it, expect, beforeEach } from 'vitest';
import { setAccessToken, getAccessToken } from './api-client';

describe('API Client Token Management', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });

  it('stores and retrieves access tokens', () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken('sample-jwt-token-12345');
    expect(getAccessToken()).toBe('sample-jwt-token-12345');
  });

  it('clears access token upon logout', () => {
    setAccessToken('sample-jwt-token-12345');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
