import type { ReactNode } from "react";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router";
import { AccountPage } from "../features/account/AccountPage";
import { PlansPage } from "../features/account/PlansPage";
import { AnalyzePage } from "../features/analyze/AnalyzePage";
import { HistoryDetailPage, HistoryPage } from "../features/analyze/HistoryPage";
import { LoginPage } from "../features/auth/LoginPage";
import { ComparePage } from "../features/compare/ComparePage";
import { CredibilityPage } from "../features/credibility/CredibilityPage";
import { HomePage } from "../features/home/HomePage";
import { EvidencePage } from "../features/evidence/EvidencePage";
import { EventPage, EventsPage } from "../features/events/EventsPages";
import { SupportPage } from "../features/support/SupportPage";
import { NotFoundPage } from "../features/home/NotFoundPage";
import { Layout } from "./Layout";
import { RequireSession } from "./RequireSession";

const guard = (el: ReactNode) => <RequireSession>{el}</RequireSession>;

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/entrar", element: <LoginPage /> },
      { path: "/planes", element: <PlansPage /> },
      { path: "/analizar", element: guard(<AnalyzePage />) },
      { path: "/historial", element: guard(<HistoryPage />) },
      { path: "/historial/:id", element: guard(<HistoryDetailPage />) },
      { path: "/comparar", element: guard(<ComparePage />) },
      { path: "/credibilidad", element: guard(<CredibilityPage />) },
      { path: "/cuenta", element: guard(<AccountPage />) },
      { path: "/archivo", element: guard(<EvidencePage />) },
      { path: "/ayuda", element: guard(<SupportPage />) },
      { path: "/eventos", element: <EventsPage /> },
      { path: "/eventos/:code", element: <EventPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function App() {
  return <RouterProvider router={createBrowserRouter(routes)} />;
}
