import { DriveClient, DriveProvider, GoogleAuth } from '@family-hub/drive-provider';
import { config } from './config';

/**
 * App-wide singletons. The UI depends on `provider` only through the
 * DataProvider interface; `auth` and `client` are exposed for sign-in and the spike.
 */
export const auth = new GoogleAuth({ clientId: config.clientId, scopes: config.scopes });
export const client = new DriveClient((force) => auth.getAccessToken(force));
export const provider = new DriveProvider({ client, appUrl: config.appUrl, storage: localStorage });

export function deviceId(): string {
  const key = 'fh:deviceId';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID().slice(0, 8);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'ephemeral';
  }
}
