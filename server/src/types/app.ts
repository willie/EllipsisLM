import type { User } from './index.js';

// Hono app environment type with variables set by middleware
export interface AppEnv {
  Variables: {
    userId: string;
    user: User;
  };
}
