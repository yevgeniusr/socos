export function getServerApiBaseUrl(): string {
  const baseUrl =
    process.env.API_INTERNAL_URL ||
    process.env.SOCOS_API_URL ||
    'http://localhost:3001';

  return baseUrl.replace(/\/+$/, '');
}
