// Minimal ambient types for the parts of Google Identity Services and the
// Google Picker that we use. Both are loaded from Google's CDN at runtime.

declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    error?: string;
    error_description?: string;
  }
  interface ClientConfigError {
    type: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
    message?: string;
  }
  interface OverridableTokenClientConfig {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    login_hint?: string;
    scope?: string;
  }
  interface TokenClient {
    requestAccessToken(overrides?: OverridableTokenClientConfig): void;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ClientConfigError) => void;
    prompt?: string;
    login_hint?: string;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
  function revoke(accessToken: string, done?: () => void): void;
}

declare namespace gapi {
  function load(api: string, callback: () => void): void;
}

declare namespace google.picker {
  enum ViewId {
    DOCS = 'all',
    FOLDERS = 'folders',
  }
  enum Action {
    PICKED = 'picked',
    CANCEL = 'cancel',
  }
  interface PickedDoc {
    id: string;
    name: string;
    mimeType: string;
  }
  interface ResponseObject {
    action: string;
    docs?: PickedDoc[];
  }
  class DocsView {
    constructor(viewId?: ViewId);
    setIncludeFolders(v: boolean): DocsView;
    setSelectFolderEnabled(v: boolean): DocsView;
    setMimeTypes(mimeTypes: string): DocsView;
    setOwnedByMe(v: boolean): DocsView;
    setMode(mode: unknown): DocsView;
  }
  class Picker {
    setVisible(v: boolean): void;
    dispose(): void;
  }
  class PickerBuilder {
    addView(view: DocsView | ViewId): PickerBuilder;
    setAppId(appId: string): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setTitle(title: string): PickerBuilder;
    setCallback(cb: (data: ResponseObject) => void): PickerBuilder;
    build(): Picker;
  }
}
