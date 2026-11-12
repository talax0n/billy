import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "./components/shell/app-shell.tsx";
import { EmptyState } from "./components/ui/page.tsx";
import { Toaster } from "./components/ui/toast.tsx";
import { ApiError } from "./lib/api.ts";
import { meQuery } from "./lib/auth.ts";
import { navItems } from "./nav.tsx";
import { ComingSoon } from "./routes/coming-soon.tsx";
import { KasirPage } from "./routes/kasir.tsx";
import { LoginPage } from "./routes/login.tsx";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    onError: (err) => {
      // A session that expired mid-use sends the user back to the login page.
      if (err instanceof ApiError && err.status === 401) {
        queryClient.setQueryData(meQuery.queryKey, null);
        void router.navigate({ to: "/login" });
      }
    },
  }),
});

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: () => <EmptyState title="Halaman tidak ditemukan" />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me) throw redirect({ to: me.role === "kasir" ? "/kasir" : "/" });
  },
  component: LoginPage,
});

/** Everything below needs a session. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/login" });
    return { me };
  },
});

/** Full-screen POS, without the back-office shell. Open to every role. */
const kasirRoute = createRoute({ getParentRoute: () => authedRoute, path: "/kasir", component: KasirPage });

/** The back-office shell. A kasir only ever sees /kasir. */
const shellRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: "shell",
  beforeLoad: ({ context }) => {
    if (context.me.role === "kasir") throw redirect({ to: "/kasir" });
  },
  component: AppShell,
});

const pageRoutes = navItems.map((item) =>
  createRoute({
    getParentRoute: () => shellRoute,
    path: item.path,
    beforeLoad: ({ context }) => {
      if (item.roles && !item.roles.includes(context.me.role)) throw redirect({ to: "/" });
    },
    component: item.page ?? (() => <ComingSoon title={item.label} />),
  }),
);

const routeTree = rootRoute.addChildren([loginRoute, authedRoute.addChildren([kasirRoute, shellRoute.addChildren(pageRoutes)])]);

export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });
