/**
 * How the family tree is laid out in the admin's Drive (plan §4).
 * Folders and files are tagged with appProperties so the app finds them by id or
 * tag rather than by name (names can be renamed by users in the Drive UI).
 */
export const ROOT_FOLDER_NAME = 'FamilyHub';

export const PROP_KIND = 'fhKind';
export const PROP_FAMILY = 'fhFamily';
/** On the root folder: id of `_meta/family.json`. */
export const PROP_FAMILY_FILE = 'fhFamilyFile';

export const KIND_ROOT = 'root';
export const KIND_JOINED = 'joined';
export const KIND_SPIKE = 'spike';

export const META_FILE_NAMES = {
  family: 'family.json',
  members: 'members.json',
  roles: 'roles.json',
} as const;
