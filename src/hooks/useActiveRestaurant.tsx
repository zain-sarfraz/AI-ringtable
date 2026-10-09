import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface RestaurantInfo {
  id: string;
  name: string;
  slug?: string;
  is_active?: boolean;
  parent_restaurant_id?: string | null;
  is_branch?: boolean;
  address?: string | null;
  service_radius_km?: number | null;
  is_accepting_orders?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  subscription_plan?: string | null;
  subscription_status?: string | null;
}

interface ActiveRestaurantContextType {
  restaurantId: string | null;
  activeRestaurant: RestaurantInfo | null;
  restaurants: RestaurantInfo[];
  setRestaurantId: (id: string | null) => void;
  loading: boolean;
  isSuperAdmin: boolean;
  refreshRestaurants: () => Promise<void>;
}

const ActiveRestaurantContext = createContext<ActiveRestaurantContextType>({
  restaurantId: null,
  activeRestaurant: null,
  restaurants: [],
  setRestaurantId: () => {},
  loading: true,
  isSuperAdmin: false,
  refreshRestaurants: async () => {},
});

export function ActiveRestaurantProvider({ children }: { children: React.ReactNode }) {
  const { user, role } = useAuth();
  const isSuperAdmin = role === "super_admin";

  const [restaurantId, setRestaurantIdState] = useState<string | null>(null);
  const [restaurants, setRestaurants] = useState<RestaurantInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRestaurantsList = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("restaurants")
        .select("id, name, slug, is_active, parent_restaurant_id, is_branch, address, service_radius_km, is_accepting_orders, latitude, longitude, subscription_plan, subscription_status")
        .order("name", { ascending: true });
      if (data) {
        setRestaurants(data as RestaurantInfo[]);
      }
    } catch (err) {
      console.error("Failed to fetch restaurants list:", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        if (!user?.id) {
          if (!cancelled) {
            setRestaurantIdState(null);
            setRestaurants([]);
          }
          return;
        }

        // Fetch all restaurants list
        const { data: allRests } = await supabase
          .from("restaurants")
          .select("id, name, slug, is_active, parent_restaurant_id, is_branch, address, service_radius_km, is_accepting_orders, latitude, longitude, subscription_plan, subscription_status")
          .order("name", { ascending: true });

        const restsList = (allRests as RestaurantInfo[]) || [];
        if (!cancelled) {
          setRestaurants(restsList);
        }

        // 1. Super Admin: Platform-wide control.
        // Can view "All Restaurants" (null) or pick a specific restaurant from dropdown.
        if (role === "super_admin") {
          const storedRid = localStorage.getItem("active_restaurant_id");
          if (storedRid && storedRid !== "all" && restsList.some((r) => r.id === storedRid)) {
            if (!cancelled) setRestaurantIdState(storedRid);
          } else {
            // Default to null (All Restaurants) for Super Admin
            if (!cancelled) setRestaurantIdState(null);
          }
          return;
        }

        // 2. Regular Restaurant Admin / Member (e.g. royal@gmail.com)
        const { data: memberRows } = await supabase
          .from("restaurant_members")
          .select("restaurant_id, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        const memberIds = [
          ...new Set(
            (memberRows as { restaurant_id: string }[] | null)?.map((m) => m.restaurant_id) ?? []
          ),
        ].filter(Boolean);

        if (memberIds.length > 0) {
          const storedRid = localStorage.getItem("active_restaurant_id");
          if (storedRid && memberIds.includes(storedRid)) {
            if (!cancelled) setRestaurantIdState(storedRid);
          } else {
            if (!cancelled) setRestaurantIdState(memberIds[0]);
          }
          return;
        }

        // 3. Driver Role
        if (role === "driver") {
          const { data: driverRow } = await supabase
            .from("drivers")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();

          const driverPk = (driverRow as { id?: string } | null)?.id;
          if (driverPk) {
            const { data: drRows } = await supabase
              .from("driver_restaurants")
              .select("restaurant_id")
              .eq("driver_id", driverPk)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            const rid = (drRows as { restaurant_id?: string } | null)?.restaurant_id;
            if (rid && !cancelled) {
              setRestaurantIdState(rid);
              return;
            }
          }
        }

        if (!cancelled) setRestaurantIdState(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  const setRestaurantId = useCallback(
    (id: string | null) => {
      if (id && id !== "all") {
        localStorage.setItem("active_restaurant_id", id);
        setRestaurantIdState(id);
      } else {
        localStorage.setItem("active_restaurant_id", "all");
        setRestaurantIdState(null);
      }
    },
    []
  );

  const activeRestaurant = useMemo(() => {
    if (!restaurantId) return null;
    return restaurants.find((r) => r.id === restaurantId) || null;
  }, [restaurantId, restaurants]);

  return (
    <ActiveRestaurantContext.Provider
      value={{
        restaurantId,
        activeRestaurant,
        restaurants,
        setRestaurantId,
        loading,
        isSuperAdmin,
        refreshRestaurants: fetchRestaurantsList,
      }}
    >
      {children}
    </ActiveRestaurantContext.Provider>
  );
}

export function useActiveRestaurant() {
  return useContext(ActiveRestaurantContext);
}

