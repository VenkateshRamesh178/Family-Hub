/// <reference path="./google.d.ts" />
import { FOLDER_MIME } from './drive-client';
import { loadScript } from './load-script';

export interface PickerConfig {
  accessToken: string;
  /** Browser API key from the Google Cloud project. */
  apiKey: string;
  /** Cloud project *number*. Required so `drive.file` access is granted for the pick. */
  appId: string;
}

let pickerReady: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  pickerReady ??= loadScript('https://apis.google.com/js/api.js').then(
    () => new Promise<void>((resolve) => gapi.load('picker', resolve)),
  );
  return pickerReady;
}

/**
 * Let a member select the family folder the admin shared with them.
 * Under the `drive.file` scope this pick is what grants the app access to it.
 */
export async function pickSharedFolder(cfg: PickerConfig): Promise<{ id: string; name: string } | null> {
  await loadPicker();
  return new Promise((resolve) => {
    const sharedWithMe = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME)
      .setOwnedByMe(false);
    const all = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME);

    const picker = new google.picker.PickerBuilder()
      .setTitle('Choose the shared "FamilyHub" folder')
      .setAppId(cfg.appId)
      .setDeveloperKey(cfg.apiKey)
      .setOAuthToken(cfg.accessToken)
      .addView(sharedWithMe)
      .addView(all)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
          picker.dispose();
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
          picker.dispose();
        }
      })
      .build();
    picker.setVisible(true);
  });
}
