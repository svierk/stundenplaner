import { lazy, Suspense } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { Layout } from "@/components/layout/layout";

const DashboardPage = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const SubjectsPage = lazy(() => import("@/pages/subjects").then((m) => ({ default: m.SubjectsPage })));
const TeachersPage = lazy(() => import("@/pages/teachers").then((m) => ({ default: m.TeachersPage })));
const ClassesPage = lazy(() => import("@/pages/classes").then((m) => ({ default: m.ClassesPage })));
const TimetablePage = lazy(() => import("@/pages/timetable").then((m) => ({ default: m.TimetablePage })));
const SettingsPage = lazy(() => import("@/pages/settings").then((m) => ({ default: m.SettingsPage })));

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Suspense fallback={null}><DashboardPage /></Suspense> },
      { path: "subjects", element: <Suspense fallback={null}><SubjectsPage /></Suspense> },
      { path: "teachers", element: <Suspense fallback={null}><TeachersPage /></Suspense> },
      { path: "classes", element: <Suspense fallback={null}><ClassesPage /></Suspense> },
      { path: "timetable", element: <Suspense fallback={null}><TimetablePage /></Suspense> },
      { path: "settings", element: <Suspense fallback={null}><SettingsPage /></Suspense> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
