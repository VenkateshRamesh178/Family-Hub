import { describe, expect, it } from 'vitest';
import { childFolders, documentAlerts, expiryStatus, folderAndDescendants, folderPath, formatFileSize, type DocFolder } from './docs';

const folder = (id: string, name: string, parentId: string | null = null): DocFolder => ({
  id,
  name,
  parentId,
  createdBy: null,
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '2026-10-11T00:00:00Z',
});

const folders = [folder('ins', 'Insurance'), folder('car', 'Car', 'ins'), folder('home', 'Home'), folder('old', 'Old', 'car')];

describe('folders', () => {
  it('finds the path from the top level', () => {
    expect(folderPath(folders, 'old').map((f) => f.id)).toEqual(['ins', 'car', 'old']);
    expect(folderPath(folders, null)).toEqual([]);
    expect(folderPath(folders, 'missing')).toEqual([]);
  });

  it('stops on a loop instead of hanging', () => {
    const loop = [folder('a', 'A', 'b'), folder('b', 'B', 'a')];
    expect(folderPath(loop, 'a').map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('lists children by name', () => {
    expect(childFolders(folders, null).map((f) => f.name)).toEqual(['Home', 'Insurance']);
    expect(childFolders(folders, 'ins').map((f) => f.name)).toEqual(['Car']);
  });

  it('collects a folder and everything below it', () => {
    expect([...folderAndDescendants(folders, 'ins')].sort()).toEqual(['car', 'ins', 'old']);
    expect([...folderAndDescendants(folders, 'home')]).toEqual(['home']);
  });
});

describe('expiry', () => {
  const today = '2026-10-11';

  it('classifies expiry dates', () => {
    expect(expiryStatus(null, today)).toBe('none');
    expect(expiryStatus('2026-10-10', today)).toBe('expired');
    expect(expiryStatus('2026-10-11', today)).toBe('expiring');
    expect(expiryStatus('2026-12-10', today)).toBe('expiring');
    expect(expiryStatus('2026-12-11', today)).toBe('active');
  });

  it('lists alerts soonest first', () => {
    const docs = [
      { title: 'later', expiryDate: '2026-11-30' },
      { title: 'none', expiryDate: null },
      { title: 'gone', expiryDate: '2026-09-01' },
      { title: 'far', expiryDate: '2028-01-01' },
    ];
    expect(documentAlerts(docs, today).map((d) => [d.title, d.status, d.daysLeft])).toEqual([
      ['gone', 'expired', -40],
      ['later', 'expiring', 50],
    ]);
  });
});

describe('formatFileSize', () => {
  it('uses readable units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatFileSize(3.2 * 1024 ** 3)).toBe('3.2 GB');
  });
});
