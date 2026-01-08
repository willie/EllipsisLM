import type { Context, Next } from 'hono';
import { UserService } from '../services/user.service.js';

// Simple single-user auth middleware
// In production, this would verify JWT tokens or session cookies
export async function authMiddleware(c: Context, next: Next) {
  // For single-user mode, get or create default user
  const user = UserService.getOrCreateDefaultUser();
  c.set('userId', user.id);
  c.set('user', user);

  await next();
}

export default authMiddleware;
