import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { orpc } from '@/lib/api';
import { platform } from '@/lib/platform';

export const Route = createFileRoute('/')({
  component: Home,
});

/**
 * Phase 0 placeholder: proves the web app reaches the API through the typed contract.
 * The request builder replaces it in phase 1.
 */
function Home() {
  const me = useQuery(orpc.me.get.queryOptions());

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">povik</h1>
        <p className="text-sm text-muted-foreground">API client. Phase 0 scaffolding.</p>
      </div>

      <section className="rounded-lg border bg-card p-4 text-sm" aria-live="polite">
        <h2 className="mb-2 font-medium">API</h2>
        {me.isPending && (
          <p className="text-muted-foreground">Connecting to {platform.apiBaseUrl}…</p>
        )}
        {me.isError && (
          <div className="flex items-start justify-between gap-3">
            <p className="text-destructive">The API request failed: {me.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => me.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {me.isSuccess && (
          <p data-testid="api-status">
            Connected.{' '}
            {me.data.user
              ? `Signed in as ${me.data.user.name} (${pluralize(me.data.workspaces.length, 'workspace')}).`
              : 'Signed out.'}
          </p>
        )}
      </section>
    </main>
  );
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
