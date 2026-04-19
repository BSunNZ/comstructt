import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import OrderSearch from "./pages/OrderSearch.tsx";
import Cart from "./pages/Cart.tsx";
import OrderStatusScreen from "./pages/OrderStatusScreen.tsx";
import OrderOverview from "./pages/OrderOverview.tsx";
import ListPage from "./pages/ListPage.tsx";
import { DeviceFrame } from "./components/DeviceFrame.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <DeviceFrame>
          <div className="phone-shell shadow-rugged">
            <Routes>
              <Route path="/" element={<OrderSearch />} />
              <Route path="/sites" element={<Index />} />
              <Route path="/order/trade" element={<OrderSearch />} />
              <Route path="/order" element={<OrderSearch />} />
              <Route path="/search" element={<OrderSearch />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/status" element={<OrderStatusScreen />} />
              <Route path="/order/status" element={<OrderOverview />} />
              <Route path="/reorder" element={<ListPage mode="reorder" />} />
              <Route path="/favorites" element={<ListPage mode="favorites" />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </DeviceFrame>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
