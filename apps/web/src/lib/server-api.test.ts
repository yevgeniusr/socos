import { afterEach, describe, expect, it } from 'vitest';
import { getServerApiBaseUrl } from './server-api';

const originalInternalUrl = process.env.API_INTERNAL_URL;
const originalSocosUrl = process.env.SOCOS_API_URL;

afterEach(() => {
  if (originalInternalUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalInternalUrl;

  if (originalSocosUrl === undefined) delete process.env.SOCOS_API_URL;
  else process.env.SOCOS_API_URL = originalSocosUrl;
});

describe('getServerApiBaseUrl', () => {
  it('prefers API_INTERNAL_URL and removes trailing slashes', () => {
    process.env.API_INTERNAL_URL = 'http://api:3001///';
    process.env.SOCOS_API_URL = 'https://staging-api.example.test';

    expect(getServerApiBaseUrl()).toBe('http://api:3001');
  });

  it('uses SOCOS_API_URL when API_INTERNAL_URL is absent', () => {
    delete process.env.API_INTERNAL_URL;
    process.env.SOCOS_API_URL = 'https://staging-api.example.test/';

    expect(getServerApiBaseUrl()).toBe('https://staging-api.example.test');
  });

  it('uses the local API origin when neither environment variable is set', () => {
    delete process.env.API_INTERNAL_URL;
    delete process.env.SOCOS_API_URL;

    expect(getServerApiBaseUrl()).toBe('http://localhost:3001');
  });
});
