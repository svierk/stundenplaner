import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { Toaster } from "@/components/ui/toaster";

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6 max-w-7xl mx-auto w-full">
          <Outlet />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
