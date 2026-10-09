import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ActiveRestaurantProvider } from "@/hooks/useActiveRestaurant";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Calls from "@/pages/Calls";

import Customers from "@/pages/Customers";
import Leads from "@/pages/Leads";
import Agents from "@/pages/Agents";
import Analytics from "@/pages/Analytics";
import Settings from "@/pages/Settings";
import IntegrationConfig from "@/pages/IntegrationConfig";
import OutboundCalls from "@/pages/OutboundCalls";
import AutoDialer from "@/pages/AutoDialer";
import LiveQueue from "@/pages/LiveQueue";
import NotFound from "@/pages/NotFound";
import Menu from "@/pages/Menu";
import MenuItemDetail from "@/pages/menu/MenuItemDetail";
import Deals from "@/pages/Deals";
import Orders from "@/pages/Orders";
import OrdersNew from "@/pages/orders/OrdersNew";
import OrdersConfirmed from "@/pages/orders/OrdersConfirmed";
import OrdersPreparing from "@/pages/orders/OrdersPreparing";
import OrdersOutForDelivery from "@/pages/orders/OrdersOutForDelivery";
import OrdersDelivered from "@/pages/orders/OrdersDelivered";
import OrderDetail from "@/pages/orders/OrderDetail";
import Vehicles from "@/pages/Vehicles";
import Drivers from "@/pages/Drivers";
import RestaurantSettings from "@/pages/RestaurantSettings";
import DriverPortal from "@/pages/DriverPortal";
import Track from "@/pages/Track";
import Order from "@/pages/Order";
import Restaurants from "@/pages/Restaurants";
import RestaurantDetails from "@/pages/RestaurantDetails";
import RestaurantConfiguration from "@/pages/RestaurantConfiguration";
import Profile from "@/pages/Profile";
import Earnings from "@/pages/Earnings";
import Coupons from "@/pages/Coupons";
import Cuisines from "@/pages/Cuisines";
import RestaurantReportPage from "@/pages/reports/RestaurantReportPage";
import ItemReportPage from "@/pages/reports/ItemReportPage";
import BestSellersReportPage from "@/pages/reports/BestSellersReportPage";
import InventoryReportPage from "@/pages/reports/InventoryReportPage";
import CustomerAnalyticsPage from "@/pages/reports/CustomerAnalyticsPage";
import OrderReportPage from "@/pages/reports/OrderReportPage";
import RestaurantOwnersPage from "@/pages/users/RestaurantOwnersPage";
import TeamMembersPage from "@/pages/users/TeamMembersPage";
import BranchPortal from "@/pages/BranchPortal";
import TableReservations from "@/pages/TableReservations";
import StaffTables from "@/pages/StaffTables";
import Permissions from "@/pages/Permissions";
import Kitchen from "@/pages/Kitchen";
import Landing from "@/pages/Landing";
import Subscribe from "@/pages/Subscribe";
import SubscribeSuccess from "@/pages/SubscribeSuccess";
import Signup from "@/pages/Signup";
import SignupSuccess from "@/pages/SignupSuccess";
import { PlanFeatureGate } from "@/components/PlanFeatureGate";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <ActiveRestaurantProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/track/:code" element={<Track />} />
              <Route path="/order" element={<Order />} />
              <Route path="/:restaurantSlug/:branchId/menu" element={<Order />} />
              <Route path="/:restaurantSlug/menu" element={<Order />} />
              <Route
                path="/driver"
                element={
                  <ProtectedRoute>
                    <DriverPortal />
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<Landing />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/signup/success" element={<SignupSuccess />} />
              <Route path="/subscribe" element={<Subscribe />} />
              <Route path="/subscribe/success" element={<SubscribeSuccess />} />
              <Route
                element={
                  <ProtectedRoute>
                    <DashboardLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="calls" element={<Calls />} />

                <Route path="customers" element={<Navigate to="/users/customers" replace />} />
                <Route path="users" element={<Navigate to="/users/team-members" replace />} />
                <Route path="users/customers" element={<Customers />} />
                <Route
                  path="users/team-members"
                  element={
                    <PlanFeatureGate feature="staff_management">
                      <TeamMembersPage />
                    </PlanFeatureGate>
                  }
                />
                <Route path="users/restaurant-owners" element={<Navigate to="/users/team-members" replace />} />
                <Route path="leads" element={<Leads />} />
                <Route path="agents" element={<Agents />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="settings" element={<Settings />} />
                <Route path="integrations" element={<IntegrationConfig />} />
                <Route path="outbound" element={<OutboundCalls />} />
                <Route path="auto-dialer" element={<AutoDialer />} />
                <Route path="live-queue" element={<LiveQueue />} />
                <Route path="menu" element={<Menu />} />
                <Route path="menu/items/:itemId" element={<MenuItemDetail />} />
                <Route path="inventory" element={<Menu />} />
                <Route path="deals" element={<Deals />} />
                <Route path="orders" element={<Orders />} />
                <Route path="orders/new" element={<OrdersNew />} />
                <Route path="orders/confirmed" element={<OrdersConfirmed />} />
                <Route path="orders/preparing" element={<OrdersPreparing />} />
                <Route path="orders/out-for-delivery" element={<OrdersOutForDelivery />} />
                <Route path="orders/delivered" element={<OrdersDelivered />} />
                <Route path="orders/:orderId" element={<OrderDetail />} />
                <Route path="vehicles" element={<Vehicles />} />
                <Route path="drivers" element={<Drivers />} />
                <Route path="restaurant-settings" element={<RestaurantSettings />} />
                <Route
                  path="branches"
                  element={
                    <PlanFeatureGate feature="branches">
                      <BranchPortal />
                    </PlanFeatureGate>
                  }
                />
                <Route
                  path="branches/:branchId"
                  element={
                    <PlanFeatureGate feature="branches">
                      <BranchPortal />
                    </PlanFeatureGate>
                  }
                />
                <Route
                  path="branch-portal"
                  element={
                    <PlanFeatureGate feature="branches">
                      <BranchPortal />
                    </PlanFeatureGate>
                  }
                />
                <Route
                  path="branch-portal/:branchId"
                  element={
                    <PlanFeatureGate feature="branches">
                      <BranchPortal />
                    </PlanFeatureGate>
                  }
                />
                <Route
                  path="permissions"
                  element={
                    <PlanFeatureGate feature="staff_management">
                      <Permissions />
                    </PlanFeatureGate>
                  }
                />
                <Route path="restaurants" element={<Restaurants />} />
                <Route path="restaurants/:id/details" element={<RestaurantDetails />} />
                <Route path="restaurants/:id/configuration" element={<RestaurantConfiguration />} />
                <Route path="earnings" element={<Earnings />} />
                <Route path="reports" element={<Navigate to="/reports/restaurant" replace />} />
                <Route path="reports/restaurant" element={<RestaurantReportPage />} />
                <Route path="reports/orders" element={<OrderReportPage />} />
                <Route path="reports/items" element={<ItemReportPage />} />
                <Route path="reports/best-sellers" element={<BestSellersReportPage />} />
                <Route path="reports/inventory" element={<InventoryReportPage />} />
                <Route path="reports/customers" element={<CustomerAnalyticsPage />} />
                <Route path="coupons" element={<Coupons />} />
                <Route path="cuisines" element={<Cuisines />} />
                <Route path="reservations" element={<TableReservations />} />
                <Route path="kitchen" element={<Kitchen />} />
                <Route path="tables" element={<StaffTables />} />
                <Route path="profile" element={<Profile />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </ActiveRestaurantProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
