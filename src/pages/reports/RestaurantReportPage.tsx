import { PageHeader, PageShell } from "@/components/layout/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { usePermission } from "@/hooks/usePermission";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { formatCurrency } from "@/lib/restaurant";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, Loader2, ShoppingCart, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface EarningStats {
    restaurants: {
        restaurant_id: string;
        restaurant_name: string;
        commission_rate: number;
        total_sales: number;
        order_count: number;
        admin_earning: number;
        restaurant_earning: number;
    }[];
}

export default function RestaurantReportPage() {
    const { t } = useTranslation(["reports", "common"]);
    const { role } = useAuth();
    const can = usePermission();
    const showAdminEarnings = can("admin_earnings.view") && role !== "manager";
    const [restaurantId, setRestaurantId] = useState("");

    const { data, isLoading, error } = useQuery<EarningStats>({
        queryKey: ["restaurant-reports"],
        queryFn: async () => {
            const token = getToken();
            const res = await fetch(`${getApiBase()}/api/stats/earnings`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error("Failed to fetch restaurant reports");
            return res.json();
        },
        refetchInterval: 30000,
    });

    const restaurants = data?.restaurants || [];

    useEffect(() => {
        if (
            restaurants.length > 0 &&
            (!restaurantId ||
                !restaurants.some((r) => r.restaurant_id === restaurantId))
        ) {
            setRestaurantId(restaurants[0].restaurant_id);
        }
    }, [restaurants, restaurantId]);

    const filtered = useMemo(
        () => restaurants.filter((r) => r.restaurant_id === restaurantId),
        [restaurants, restaurantId],
    );

    const totals = useMemo(
        () =>
            filtered.reduce(
                (acc, curr) => {
                    acc.sales += curr.total_sales;
                    acc.orders += curr.order_count;
                    return acc;
                },
                { sales: 0, orders: 0 },
            ),
        [filtered],
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
                <p className="font-bold">
                    {t("common:error", "Error loading restaurant report")}
                </p>
                <p className="text-sm">{(error as Error).message}</p>
            </div>
        );
    }

    return (
        <PageShell>
            <PageHeader
                title={t("reports:restaurantReport", "Restaurant report")}
                description={t(
                    "reports:restaurantReportDesc",
                    "Sales and commission by restaurant",
                )}
                icon={<Store className="h-5 w-5" />}
                actions={
                    restaurants.length > 1 ? (
                        <Select
                            value={restaurantId}
                            onValueChange={setRestaurantId}
                        >
                            <SelectTrigger className="h-10 w-full justify-start bg-card border-border/80 rounded-xl px-3.5 text-xs font-medium gap-2 shadow-sm hover:border-border sm:w-[240px]">
                                <SelectValue
                                    placeholder={t(
                                        "reports:filterByRestaurant",
                                        "Filter by restaurant",
                                    )}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {restaurants.map((r) => (
                                    <SelectItem
                                        key={r.restaurant_id}
                                        value={r.restaurant_id}
                                    >
                                        {r.restaurant_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : null
                }
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="rounded-2xl border border-border/80 shadow-xs">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">
                                    {t("reports:totalSales", "Total Sales")}
                                </p>
                                <p className="text-2xl font-bold">
                                    {formatCurrency(totals.sales)}
                                </p>
                            </div>
                            <DollarSign className="h-6 w-6 text-primary" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="rounded-2xl border border-border/80 shadow-xs">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">
                                    {t("reports:totalOrders", "Total Orders")}
                                </p>
                                <p className="text-2xl font-bold">
                                    {totals.orders}
                                </p>
                            </div>
                            <ShoppingCart className="h-6 w-6 text-emerald-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="rounded-2xl border border-border/80 shadow-xs">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">
                                    {t(
                                        "reports:restaurantsIncluded",
                                        "Restaurants Included",
                                    )}
                                </p>
                                <p className="text-2xl font-bold">
                                    {filtered.length}
                                </p>
                            </div>
                            <Store className="h-6 w-6 text-primary" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="rounded-2xl border border-border/80 shadow-xs overflow-hidden">
                <CardHeader>
                    <CardTitle>
                        {t(
                            "reports:reportDetails",
                            "Restaurant report details",
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground font-medium border-y">
                                <tr>
                                    <th className="px-6 py-4">
                                        {t(
                                            "reports:colRestaurant",
                                            "Restaurant",
                                        )}
                                    </th>
                                    <th className="px-6 py-4 text-right">
                                        {t("reports:colOrders", "Orders")}
                                    </th>
                                    <th className="px-6 py-4 text-right">
                                        {t("reports:colSales", "Sales")}
                                    </th>
                                    {showAdminEarnings && (
                                        <>
                                            <th className="px-6 py-4 text-right">
                                                {t(
                                                    "reports:colCommission",
                                                    "Commission %",
                                                )}
                                            </th>
                                            <th className="px-6 py-4 text-right">
                                                {t(
                                                    "reports:colAdminEarnings",
                                                    "Admin Earnings",
                                                )}
                                            </th>
                                        </>
                                    )}
                                    <th className="px-6 py-4 text-right">
                                        {t(
                                            "reports:colRestaurantEarnings",
                                            "Restaurant Earnings",
                                        )}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {filtered.map((row) => (
                                    <tr
                                        key={row.restaurant_id}
                                        className="hover:bg-muted/30 transition-colors"
                                    >
                                        <td className="px-6 py-4 font-semibold text-foreground">
                                            {row.restaurant_name}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {row.order_count}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {formatCurrency(row.total_sales)}
                                        </td>
                                        {showAdminEarnings && (
                                            <>
                                                <td className="px-6 py-4 text-right">
                                                    {row.commission_rate}%
                                                </td>
                                                <td className="px-6 py-4 text-right text-primary font-medium">
                                                    {formatCurrency(
                                                        row.admin_earning,
                                                    )}
                                                </td>
                                            </>
                                        )}
                                        <td className="px-6 py-4 text-right text-emerald-600 font-medium">
                                            {formatCurrency(
                                                row.restaurant_earning,
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={showAdminEarnings ? 6 : 4}
                                            className="px-6 py-8 text-center text-muted-foreground"
                                        >
                                            {t(
                                                "reports:noData",
                                                "No report data available for this restaurant.",
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </PageShell>
    );
}
