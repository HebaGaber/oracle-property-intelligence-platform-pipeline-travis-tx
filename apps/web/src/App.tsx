// Route table and router of the hosted UI (A-03 T007; A-13 T015). The routes are built from
// routes/route-list.ts (data, also read by the hosted scan): every page is a lazy child of the
// shell, so no page's code (and never DuckDB-WASM) loads until it is visited. `/` renders the Hub
// (no redirect). `routes` is exported for the unit tests (memory router); `App` mounts the
// browser router. The shared tRPC client (packages/api-client, the only one) and its React Query
// client are provided once, above the shell.
import { ApiProvider } from "@countylens/api-client/react";
import { useMemo, type ReactElement } from "react";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router";
import { AppShell } from "./components/AppShell";
import { ROUTE_LIST } from "./routes/route-list";

function Root(): ReactElement {
  return (
    <ApiProvider>
      <AppShell />
    </ApiProvider>
  );
}

const children: RouteObject[] = ROUTE_LIST.map((entry) =>
  entry.path === "/"
    ? { index: true, lazy: entry.load }
    : { path: entry.path.slice(1), lazy: entry.load },
);

export const routes: RouteObject[] = [{ path: "/", Component: Root, children }];

export function App(): ReactElement {
  const router = useMemo(() => createBrowserRouter(routes), []);
  return <RouterProvider router={router} />;
}
