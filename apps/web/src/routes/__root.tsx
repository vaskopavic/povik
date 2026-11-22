import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <Outlet />
    </div>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link to="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Back to povik
      </Link>
    </main>
  );
}
