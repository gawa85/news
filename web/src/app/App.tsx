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
import { LegalPage } from "../features/public/LegalPage";
import { AlertsPage } from "../features/alerts/AlertsPage";
import { LearningPage } from "../features/learning/LearningPage";
import { OriginPage } from "../features/origin/OriginPage";
import { MediaCheckPage } from "../features/media/MediaCheckPage";
import { StatsPage } from "../features/stats/StatsPage";
import { CampaignsPage, ClassroomsPage, RepliesPage } from "../features/team/TeamToolsPages";
import { BrandingPage, CouponsPage } from "../features/commerce/CommercePages";
import { RebuttalPage, RulesPage as SourceRulesPage, SourcesPage } from "../features/sources/SourcesPages";
import { CorrectionsPage, ObservatoryPage, OpenDataPage, OutletPage, OutletsPage } from "../features/public/PublicPages";
import { TeamRoomPage, TeamRoomsPage } from "../features/rooms/TeamRoomsPages";
import { JoinPage, OrganizationPage } from "../features/organization/OrganizationPages";
import { AdminLayout } from "../features/admin/AdminLayout";
import { SupportQueuePage } from "../features/admin/SupportQueuePage";
import { VerificationPage } from "../features/admin/VerificationPage";
import { RebuttalsPage } from "../features/admin/RebuttalsPage";
import { EventsHostPage } from "../features/admin/EventsHostPage";
import { AbusePage } from "../features/admin/AbusePage";
import { MetricsPage } from "../features/admin/MetricsPage";
import { ParametersPage } from "../features/admin/ParametersPage";
import { RulesPage } from "../features/admin/RulesPage";
import { FlagsPage } from "../features/admin/FlagsPage";
import { TaxonomyPage } from "../features/admin/TaxonomyPage";
import { PeoplePage } from "../features/admin/PeoplePage";
import { QualityPage } from "../features/admin/QualityPage";
import { CatalogPage, DocumentsPage } from "../features/admin/DataPages";
import { OutletsAdminPage } from "../features/admin/OutletsAdminPage";
import { CorrectionsAdminPage } from "../features/admin/CorrectionsAdminPage";
import { PlansAdminPage } from "../features/admin/PlansAdminPage";
import { LegalAdminPage } from "../features/admin/LegalAdminPage";
import { AuditPage, BackupsPage, CostsPage } from "../features/admin/OpsPages";
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
      { path: "/origen", element: guard(<OriginPage />) },
      { path: "/revisar", element: guard(<MediaCheckPage />) },
      { path: "/fuentes", element: guard(<SourcesPage />) },
      { path: "/estadisticas", element: guard(<StatsPage />) },
      { path: "/aulas", element: guard(<ClassroomsPage />) },
      { path: "/respuestas", element: guard(<RepliesPage />) },
      { path: "/campanas", element: guard(<CampaignsPage />) },
      { path: "/marca", element: guard(<BrandingPage />) },
      { path: "/reglas", element: guard(<SourceRulesPage />) },
      { path: "/replica", element: guard(<RebuttalPage />) },
      { path: "/alertas", element: guard(<AlertsPage />) },
      { path: "/jugar", element: guard(<LearningPage />) },
      { path: "/salas", element: guard(<TeamRoomsPage />) },
      { path: "/organizacion", element: guard(<OrganizationPage />) },
      { path: "/unirme", element: <JoinPage /> },
      {
        path: "/admin",
        element: guard(<AdminLayout />),
        children: [
          { path: "personas", element: <PeoplePage /> },
          { path: "soporte", element: <SupportQueuePage /> },
          { path: "verificacion", element: <VerificationPage /> },
          { path: "replicas", element: <RebuttalsPage /> },
          { path: "eventos", element: <EventsHostPage /> },
          { path: "abuso", element: <AbusePage /> },
          { path: "metricas", element: <MetricsPage /> },
          { path: "parametros", element: <ParametersPage /> },
          { path: "reglas", element: <RulesPage /> },
          { path: "planes", element: <PlansAdminPage /> },
          { path: "legal", element: <LegalAdminPage /> },
          { path: "cupones", element: <CouponsPage /> },
          { path: "funciones", element: <FlagsPage /> },
          { path: "temas", element: <TaxonomyPage /> },
          { path: "calidad", element: <QualityPage /> },
          { path: "documentos", element: <DocumentsPage /> },
          { path: "medios", element: <OutletsAdminPage /> },
          { path: "erratas", element: <CorrectionsAdminPage /> },
          { path: "catalogo", element: <CatalogPage /> },
          { path: "auditoria", element: <AuditPage /> },
          { path: "costos", element: <CostsPage /> },
          { path: "copias", element: <BackupsPage /> },
        ],
      },
      { path: "/salas/:id", element: guard(<TeamRoomPage />) },
      { path: "/cuenta", element: guard(<AccountPage />) },
      { path: "/archivo", element: guard(<EvidencePage />) },
      { path: "/ayuda", element: guard(<SupportPage />) },
      { path: "/eventos", element: <EventsPage /> },
      { path: "/observatorio", element: <ObservatoryPage /> },
      { path: "/medios", element: <OutletsPage /> },
      { path: "/medios/:id", element: <OutletPage /> },
      { path: "/fe-de-erratas", element: <CorrectionsPage /> },
      { path: "/datos", element: <OpenDataPage /> },
      { path: "/legal/:slug", element: <LegalPage /> },
      { path: "/eventos/:code", element: <EventPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function App() {
  return <RouterProvider router={createBrowserRouter(routes)} />;
}
