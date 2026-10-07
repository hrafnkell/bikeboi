// Routes beyond auth and settings: bests, workouts, rides, account.

import type { RouteTable } from '../app.ts';
import { api } from '../http.ts';
import { accountRoutes } from './account.ts';
import type { AuthContext } from './auth.ts';
import { bestsRoutes } from './bests.ts';
import { ridesRoutes } from './rides.ts';
import { workoutsRoutes } from './workouts.ts';

export function extraRoutes(ctx: AuthContext): RouteTable {
  const bests = bestsRoutes(ctx);
  const workouts = workoutsRoutes(ctx);
  const rides = ridesRoutes(ctx);
  const account = accountRoutes(ctx);
  return {
    '/api/bests': { GET: api(bests.get), PUT: api(bests.put) },
    '/api/workouts': { GET: api(workouts.list) },
    '/api/workouts/:id': { PUT: api(workouts.put), DELETE: api(workouts.remove) },
    '/api/rides': { GET: api(rides.list), POST: api(rides.create) },
    '/api/rides/:id': { GET: api(rides.get), DELETE: api(rides.remove) },
    '/api/rides/:id/fit': { GET: api(rides.fit) },
    '/api/account': { DELETE: api(account.remove) },
  };
}
