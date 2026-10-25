export interface Project {
  id: string;
  name: string;
  description: string;
  cloudProjectId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Named MdDocument to avoid clashing with the DOM's global Document type. */
export interface MdDocument {
  id: string;
  projectId: string;
  folderId: string | null;
  /** File name including the .md extension. */
  title: string;
  content: string;
  cloudDocumentId?: string;
  headVersionId?: string;
  /** Changed since the last cloud version. Always true until Phase 5 adds versions. */
  dirty: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';

/** Image metadata. The bytes live in the separate imageData table (see getImageBytes). */
export interface ImageAsset {
  id: string;
  projectId: string;
  folderId: string | null;
  /** File name including its extension, e.g. "diagram.png". */
  name: string;
  contentType: ImageType;
  size: number;
  /** Hex SHA-256 of the bytes; used for de-duplication from Phase 5. */
  sha256: string;
  createdAt: number;
  updatedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface ProjectSummary extends Project {
  documentCount: number;
}

/** A whole project to create in one go (zip import). Folder paths are names from the project root; [] is the root. */
export interface ProjectImportData {
  name: string;
  description: string;
  /** Set when the project comes from the user's account (Phase 5b download). */
  cloudProjectId?: string;
  /** Parents before children. */
  folders: string[][];
  documents: Array<{ folder: string[]; title: string; content: string; cloudDocumentId?: string; headVersionId?: string; dirty?: boolean }>;
  images: Array<{ folder: string[]; name: string; contentType: ImageType; bytes: ArrayBuffer }>;
}
