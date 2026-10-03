const env = import.meta.env;

export const config = {
  clientId: (env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '',
  apiKey: (env.VITE_GOOGLE_API_KEY as string | undefined)?.trim() ?? '',
  appId: (env.VITE_GOOGLE_APP_ID as string | undefined)?.trim() ?? '',
  appUrl: (env.VITE_APP_URL as string | undefined)?.trim() || window.location.origin,
  scopes: ((env.VITE_DRIVE_SCOPES as string | undefined) ?? '').split(/\s+/).filter(Boolean),
};

export const isConfigured = !!config.clientId;
export const canPickFolders = !!config.apiKey && !!config.appId;
