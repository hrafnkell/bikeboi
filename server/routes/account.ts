// Deleting an account removes everything it holds.

import { findUserByEmail, verifyPassword } from '../auth.ts';
import { ApiError, json, readJson, sessionCookie } from '../http.ts';
import * as v from '../validate.ts';
import { requireUser } from './auth.ts';
import type { AuthContext } from './auth.ts';

export function accountRoutes(ctx: AuthContext) {
  return {
    async remove(req: Request): Promise<Response> {
      const user = requireUser(ctx, req);
      const body = v.object(await readJson(req));
      if (typeof body.password !== 'string') throw new ApiError(400, 'password is required');
      const found = findUserByEmail(ctx.db, user.email);
      if (!found || !(await verifyPassword(body.password, found.passwordHash))) throw new ApiError(401, 'wrong password');
      ctx.db.query('DELETE FROM users WHERE id = $id').run({ id: user.id });
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, ctx.cookieSecure) });
    },
  };
}
