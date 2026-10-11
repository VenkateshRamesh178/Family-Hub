import { ApiProvider } from '@family-hub/api-provider';

/**
 * App-wide singleton. Screens use it through the DataProvider interface; only
 * sign-in/sign-up use the ApiProvider-specific auth methods.
 */
export const provider = new ApiProvider();
