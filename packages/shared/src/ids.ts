import { z } from 'zod';

/** Every record id is a UUID (v7 on the server, so ids sort by creation time). */
export const idSchema = z.uuid({ message: 'Must be a valid id' });
export type Id = z.infer<typeof idSchema>;
