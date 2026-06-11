import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import Device from "./pages/Device";
import Profile from "./pages/Profile";
import Research from "./pages/Research";
import OwnerStats from "./pages/OwnerStats";
import ResearchLogin from "./pages/ResearchLogin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ResearchProtectedRoute({ children }: { children: React.ReactNode }) {
  const isResearcher = localStorage.getItem("researcher_logged_in") === "true";

  if (!isResearcher) {
    return <Navigate to="/research-login" replace />;
  }

  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Device />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/my-stats" element={<OwnerStats />} />
            <Route path="/research-login" element={<ResearchLogin />} />
            <Route path="/research/stats" element={<OwnerStats />} />

            <Route
              path="/research"
              element={
                <ResearchProtectedRoute>
                  <Research />
                </ResearchProtectedRoute>
              }
            />

            <Route
              path="/research/stats"
              element={
                <ResearchProtectedRoute>
                  <OwnerStats />
                </ResearchProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;