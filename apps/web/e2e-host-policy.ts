const productionHostname = "socos.rachkovan.com";

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

export function getStagingBaseUrl(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const baseURL = environment.E2E_BASE_URL;
  if (!baseURL) {
    throw new Error(
      "E2E_BASE_URL is required and must target a staging deployment."
    );
  }

  const allowedHosts = environment.E2E_ALLOWED_HOSTS;
  if (!allowedHosts) {
    throw new Error(
      "E2E_ALLOWED_HOSTS is required and must list explicit staging hostnames."
    );
  }

  const hostname = normalizeHostname(new URL(baseURL).hostname);
  if (hostname === productionHostname) {
    throw new Error(
      "E2E_BASE_URL must not target the production SOCOS hostname."
    );
  }

  const allowlist = new Set(
    allowedHosts
      .split(",")
      .map((host) => normalizeHostname(host.trim()))
      .filter(Boolean)
  );
  if (!allowlist.has(hostname)) {
    throw new Error(
      "E2E_BASE_URL hostname must be explicitly listed in E2E_ALLOWED_HOSTS."
    );
  }

  return baseURL;
}
