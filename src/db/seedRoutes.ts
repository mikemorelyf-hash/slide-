import type { Pool as PgPool } from 'pg';

export async function seedRoutes(db: PgPool, routeNames: string[]): Promise<number> {
  const uniqueRouteNames = [...new Set(routeNames.map((route) => route.trim()).filter(Boolean))];
  if (uniqueRouteNames.length === 0) {
    return 0;
  }

  const values = uniqueRouteNames.map((_, index) => `($${index + 1})`).join(', ');
  await db.query(
    `
      INSERT INTO routes (name)
      VALUES ${values}
      ON CONFLICT (name)
      DO UPDATE SET is_active = TRUE, updated_at = NOW()
    `,
    uniqueRouteNames
  );

  return uniqueRouteNames.length;
}
