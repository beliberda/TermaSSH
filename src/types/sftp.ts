import { z } from 'zod';

export const sftpEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  size: z.number(),
  modifiedAt: z.string().optional(),
});

export type SftpEntry = z.infer<typeof sftpEntrySchema>;

export const listDirResponseSchema = z.object({
  entries: z.array(sftpEntrySchema),
  resolvedPath: z.string(),
});

export type ListDirResponse = z.infer<typeof listDirResponseSchema>;

export const recursiveFileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  relativePath: z.string(),
  size: z.number(),
  modifiedAt: z.string().optional(),
});

export type RecursiveFileEntry = z.infer<typeof recursiveFileEntrySchema>;
