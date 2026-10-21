// Route table and router of the hosted UI (A-03 T007; plan § Project Structure).
// Two destinations, both lazy so neither page's code (and later DuckDB-WASM, T054) loads until
// it is visited; `/` redirects to `/runs` (demo line 1). `routes` is exported for the unit tests
// (memory router); `App` mounts the browser router. The shared tRPC client (packages/api-client,
// the only one) and its React Query client are provided once, above the shell.
import { ApiProvider } from "@countylens/api-client/react";
import { useMemo, type ReactElement } from "react";
import { createBrowserRouter, redirect, RouterProvider, type RouteObject } from "react-router";
import { AppShell } from "./components/AppShell";

function Root(): ReactElement {
  return (
    <ApiProvider>
      <AppShell />
    </ApiProvider>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, loader: () => redirect("/runs") },
      { path: "runs", lazy: () => import("./routes/Runs") },
      { path: "permits", lazy: () => import("./routes/Permits") },
    ],
  },
];

export function App(): ReactElement {
  const router = useMemo(() => createBrowserRouter(routes), []);
  return <RouterProvider router={router} />;
}
