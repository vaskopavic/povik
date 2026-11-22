import { z } from 'zod';

/**
 * One environment variable. For a secret variable the server always stores an empty `value`;
 * the real value lives only on the user's device.
 */
export const EnvironmentVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
  enabled: z.boolean(),
});
export type EnvironmentVariable = z.infer<typeof EnvironmentVariableSchema>;
