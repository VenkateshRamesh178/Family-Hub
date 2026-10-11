import { INLINE_CONTENT_TYPES, type DocumentInput, type FamilyDocument } from '@family-hub/core';
import { useRef } from 'react';
import { useDocMutation } from '../lib/queries';
import { provider } from '../services';
import { Button, type ButtonProps } from './ui';

/** A button that opens the file chooser. */
export function FileButton({
  onFiles,
  multiple = false,
  ...buttonProps
}: Omit<ButtonProps, 'onClick' | 'type'> & { onFiles: (files: File[]) => void; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ''; // so choosing the same file again still fires
          if (files.length) onFiles(files);
        }}
      />
      <Button type="button" {...buttonProps} onClick={() => input.current?.click()} />
    </>
  );
}

/** Uploads files one after another, each as a new document. */
export async function uploadFiles(files: readonly File[], input: Partial<DocumentInput> = {}): Promise<void> {
  for (const file of files) await provider.docs.upload(file, input);
}

export const canOpenInBrowser = (doc: Pick<FamilyDocument, 'file'>) =>
  !!doc.file && INLINE_CONTENT_TYPES.includes(doc.file.contentType);

/**
 * Opens a document's file in a new tab (PDFs, images, text) or downloads it.
 * The tab is opened before the short-lived link is fetched, so popup blockers allow it.
 */
export function useOpenFile() {
  return useDocMutation(async ({ id, versionId, inline = false }: { id: string; versionId?: string; inline?: boolean }) => {
    const tab = inline ? window.open('', '_blank') : null;
    try {
      const url = await provider.docs.downloadUrl(id, { versionId, inline });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (e) {
      tab?.close();
      throw e;
    }
  });
}
