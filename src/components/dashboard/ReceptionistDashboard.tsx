import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
    AlertCircle,
    ArrowRight,
    Bell,
    CalendarDays,
    Check,
    CheckCircle2,
    Clock,
    Phone,
    PhoneCall,
    Plus,
    RefreshCw,
    Search,
    Sparkle,
    Sparkles,
    TableProperties,
    Trash2,
    UserCheck,
    Users,
    UserX,
    UtensilsCrossed,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface Reservation {
    id: string;
    table_id: string | null;
    table_number?: string | null;
    table_capacity?: number | null;
    table_location?: string | null;
    customer_name: string;
    customer_phone: string | null;
    customer_email: string | null;
    party_size: number;
    reservation_date: string;
    start_time: string;
    slot_duration_hours: number;
    status: string;
    notes: string | null;
    source: string;
    no_show_reason?: string | null;
}

interface RestaurantTable {
    id: string;
    table_number: string;
    capacity: number;
    location?: string | null;
    is_active: boolean;
    status?: string;
    occupied?: boolean;
    cleaning_since?: string | null;
}

interface WaitingListEntry {
    id: string;
    restaurant_id: string;
    guest_name: string;
    phone: string | null;
    party_size: number;
    quoted_wait_minutes: number | null;
    status: string;
    notified_at: string | null;
    created_at: string;
}

const displayTableNumber = (tableNum?: string | null): string => {
    if (!tableNum) return "";
    const trimmed = tableNum.trim();
    if (/^table\b/i.test(trimmed)) return trimmed;
    return `Table ${trimmed}`;
};

export function ReceptionistDashboard({ firstName }: { firstName: string }) {
    const { restaurantId, activeRestaurant } = useActiveRestaurant();
    const navigate = useNavigate();

    const [tables, setTables] = useState<RestaurantTable[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [waitingList, setWaitingList] = useState<WaitingListEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    // Walk-in modal state
    const [walkInOpen, setWalkInOpen] = useState(false);
    const [walkInName, setWalkInName] = useState("");
    const [walkInPhone, setWalkInPhone] = useState("");
    const [walkInPartySize, setWalkInPartySize] = useState("2");
    const [walkInTableId, setWalkInTableId] = useState("");
    const [walkInNotes, setWalkInNotes] = useState("");
    const [submittingWalkIn, setSubmittingWalkIn] = useState(false);

    // No-show dialog state
    const [noShowOpen, setNoShowOpen] = useState(false);
    const [noShowTarget, setNoShowTarget] = useState<Reservation | null>(null);
    const [noShowReason, setNoShowReason] = useState("Did not show");
    const [noShowNotes, setNoShowNotes] = useState("");
    const [submittingNoShow, setSubmittingNoShow] = useState(false);

    // Waiting list add modal state
    const [waitAddOpen, setWaitAddOpen] = useState(false);
    const [waitGuestName, setWaitGuestName] = useState("");
    const [waitPhone, setWaitPhone] = useState("");
    const [waitPartySize, setWaitPartySize] = useState("2");
    const [waitQuotedMins, setWaitQuotedMins] = useState("15");
    const [submittingWait, setSubmittingWait] = useState(false);

    // Waiting list seat modal state
    const [seatWaitEntry, setSeatWaitEntry] = useState<WaitingListEntry | null>(
        null,
    );
    const [seatWaitTableId, setSeatWaitTableId] = useState("");
    const [submittingSeatWait, setSubmittingSeatWait] = useState(false);

    const authHeader = useCallback(() => {
        return {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
        };
    }, []);

    const API = getApiBase() + "/api";

    const loadData = useCallback(async () => {
        if (!restaurantId) return;
        try {
            const todayStr = format(new Date(), "yyyy-MM-dd");
            const [tblRes, resRes, waitRes] = await Promise.all([
                fetch(`${API}/restaurants/${restaurantId}/tables`, {
                    headers: authHeader(),
                }),
                fetch(
                    `${API}/restaurants/${restaurantId}/reservations?date=${todayStr}`,
                    { headers: authHeader() },
                ),
                fetch(
                    `${API}/restaurants/${restaurantId}/waiting-list?status=waiting`,
                    { headers: authHeader() },
                ),
            ]);

            if (tblRes.ok) {
                const d = await tblRes.json();
                setTables(d.tables || []);
            }
            if (resRes.ok) {
                const d = await resRes.json();
                setReservations(d.reservations || []);
            }
            if (waitRes.ok) {
                const d = await waitRes.json();
                setWaitingList(d.list || []);
            }
        } catch (err) {
            console.error("Failed to load receptionist dashboard data:", err);
        } finally {
            setLoading(false);
        }
    }, [restaurantId, authHeader, API]);

    useEffect(() => {
        loadData();
        // 8-second live auto-refresh
        const interval = setInterval(() => {
            loadData();
        }, 8000);
        return () => clearInterval(interval);
    }, [loadData]);

    // Quick Arrival check-in
    const handleCustomerArrived = async (res: Reservation) => {
        if (!res.table_id && !res.table_number) {
            toast.warning("Table assignment required", {
                description: `Please assign a table for ${res.customer_name} in Reservations page.`,
            });
            navigate("/reservations");
            return;
        }

        try {
            const r = await fetch(`${API}/reservations/${res.id}`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({ status: "seated" }),
            });
            if (r.ok) {
                await loadData();
                const tblName =
                    displayTableNumber(res.table_number) ||
                    "their assigned table";
                toast.success(`🎉 Guest Arrived: ${res.customer_name}`, {
                    description: `Checked in and proceeding to ${tblName}.`,
                });
            } else {
                toast.error("Failed to confirm arrival");
            }
        } catch {
            toast.error("Network error while confirming arrival");
        }
    };

    // Confirm booking
    const handleConfirmReservation = async (res: Reservation) => {
        try {
            const r = await fetch(`${API}/reservations/${res.id}`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({ status: "confirmed" }),
            });
            if (r.ok) {
                await loadData();
                toast.success(`Booking confirmed for ${res.customer_name}`);
            } else {
                toast.error("Failed to confirm booking");
            }
        } catch {
            toast.error("Network error");
        }
    };

    // Open No-Show dialog
    const openNoShowModal = (res: Reservation) => {
        setNoShowTarget(res);
        setNoShowReason("Did not show");
        setNoShowNotes("");
        setNoShowOpen(true);
    };

    // Submit No-Show
    const handleNoShowSubmit = async () => {
        if (!noShowTarget) return;
        setSubmittingNoShow(true);
        try {
            const fullReason = noShowNotes.trim()
                ? `${noShowReason}: ${noShowNotes.trim()}`
                : noShowReason;
            const r = await fetch(`${API}/reservations/${noShowTarget.id}`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({
                    status: "no_show",
                    no_show_reason: fullReason,
                }),
            });
            if (r.ok) {
                setNoShowOpen(false);
                setNoShowTarget(null);
                await loadData();
                toast.success(
                    `Marked as No-Show: ${noShowTarget.customer_name}`,
                );
            } else {
                toast.error("Failed to mark as no-show");
            }
        } catch {
            toast.error("Network error while updating reservation");
        } finally {
            setSubmittingNoShow(false);
        }
    };

    // Complete dining
    const handleCompleteDining = async (id: string) => {
        try {
            const r = await fetch(`${API}/reservations/${id}`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({ status: "completed" }),
            });
            if (r.ok) {
                await loadData();
                toast.success("Dining completed! Table is now in cleaning.");
            } else {
                toast.error("Failed to complete dining");
            }
        } catch {
            toast.error("Network error");
        }
    };

    // Mark table clean
    const handleMarkClean = async (tableId: string) => {
        try {
            const r = await fetch(`${API}/tables/${tableId}/status`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({ status: "available" }),
            });
            if (r.ok) {
                await loadData();
                toast.success("Table marked as clean and ready!");
            } else {
                toast.error("Failed to update table status");
            }
        } catch {
            toast.error("Network error");
        }
    };

    // Walk-in submit
    const handleCreateWalkIn = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!restaurantId || !walkInTableId) {
            toast.warning("Please choose a table");
            return;
        }
        const size = parseInt(walkInPartySize, 10);
        if (!size || size < 1) {
            toast.warning("Party size must be at least 1");
            return;
        }

        setSubmittingWalkIn(true);
        try {
            const r = await fetch(
                `${API}/restaurants/${restaurantId}/walk-in`,
                {
                    method: "POST",
                    headers: authHeader(),
                    body: JSON.stringify({
                        table_id: walkInTableId,
                        customer_name: walkInName.trim() || "Walk-in Guest",
                        customer_phone: walkInPhone.trim() || null,
                        party_size: size,
                        notes: walkInNotes.trim() || null,
                    }),
                },
            );
            if (r.ok) {
                setWalkInOpen(false);
                setWalkInName("");
                setWalkInPhone("");
                setWalkInTableId("");
                setWalkInNotes("");
                await loadData();
                toast.success("Walk-in party seated successfully!");
            } else {
                const d = await r.json();
                toast.error(d.error || "Failed to create walk-in reservation");
            }
        } catch {
            toast.error("Network error while creating walk-in");
        } finally {
            setSubmittingWalkIn(false);
        }
    };

    // Waiting list add
    const handleAddToWaitingList = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!restaurantId) return;
        const size = parseInt(waitPartySize, 10);
        if (!size || size < 1) {
            toast.warning("Party size must be at least 1");
            return;
        }

        setSubmittingWait(true);
        try {
            const r = await fetch(
                `${API}/restaurants/${restaurantId}/waiting-list`,
                {
                    method: "POST",
                    headers: authHeader(),
                    body: JSON.stringify({
                        guest_name: waitGuestName.trim() || "Guest",
                        phone: waitPhone.trim() || null,
                        party_size: size,
                        quoted_wait_minutes: waitQuotedMins
                            ? parseInt(waitQuotedMins, 10)
                            : null,
                    }),
                },
            );
            if (r.ok) {
                setWaitAddOpen(false);
                setWaitGuestName("");
                setWaitPhone("");
                setWaitPartySize("2");
                setWaitQuotedMins("15");
                await loadData();
                toast.success("Added to waiting list");
            } else {
                toast.error("Failed to add to waiting list");
            }
        } catch {
            toast.error("Network error");
        } finally {
            setSubmittingWait(false);
        }
    };

    // Seat guest from waiting list
    const handleSeatWaitingGuest = async () => {
        if (!restaurantId || !seatWaitEntry || !seatWaitTableId) return;
        setSubmittingSeatWait(true);
        try {
            // 1. Create walk-in
            const r = await fetch(
                `${API}/restaurants/${restaurantId}/walk-in`,
                {
                    method: "POST",
                    headers: authHeader(),
                    body: JSON.stringify({
                        table_id: seatWaitTableId,
                        customer_name: seatWaitEntry.guest_name,
                        customer_phone: seatWaitEntry.phone,
                        party_size: seatWaitEntry.party_size,
                        notes: "Seated from waiting list",
                    }),
                },
            );
            if (!r.ok) {
                const d = await r.json();
                toast.error(d.error || "Failed to seat table");
                return;
            }
            // 2. Mark waiting list entry seated
            await fetch(`${API}/waiting-list/${seatWaitEntry.id}`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({ status: "seated" }),
            });
            setSeatWaitEntry(null);
            setSeatWaitTableId("");
            await loadData();
            toast.success(`Seated ${seatWaitEntry.guest_name}!`);
        } catch {
            toast.error("Network error");
        } finally {
            setSubmittingSeatWait(false);
        }
    };

    // Notify waiting guest
    const handleNotifyWaitingGuest = async (id: string) => {
        try {
            const r = await fetch(`${API}/waiting-list/${id}`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({ notified_at: new Date().toISOString() }),
            });
            if (r.ok) {
                await loadData();
                toast.success("Guest notified that their table is ready!");
            }
        } catch {
            toast.error("Failed to notify guest");
        }
    };

    // Remove from waiting list
    const handleRemoveWaitingGuest = async (id: string) => {
        try {
            const r = await fetch(`${API}/waiting-list/${id}`, {
                method: "DELETE",
                headers: authHeader(),
            });
            if (r.ok) {
                await loadData();
                toast.success("Removed from waiting list");
            }
        } catch {
            toast.error("Failed to remove guest");
        }
    };

    // Available tables for walk-in / seating
    const availableTables = useMemo(() => {
        return tables.filter(
            (t) =>
                t.is_active &&
                (t.status === "available" ||
                    (!t.occupied &&
                        !t.cleaning_since &&
                        t.status !== "cleaning" &&
                        t.status !== "reserved")),
        );
    }, [tables]);

    // Derived metrics
    const totalBookings = reservations.length;
    const awaitingArrival = reservations.filter(
        (r) => r.status === "confirmed",
    ).length;
    const currentlySeated = reservations.filter(
        (r) => r.status === "seated",
    ).length;
    const pendingRequests = reservations.filter(
        (r) => r.status === "pending",
    ).length;
    const waitingCount = waitingList.length;

    const countAvailable = tables.filter(
        (t) =>
            t.is_active &&
            (t.status === "available" ||
                (!t.occupied &&
                    !t.cleaning_since &&
                    t.status !== "cleaning" &&
                    t.status !== "reserved")),
    ).length;

    const countOccupied = tables.filter(
        (t) => t.is_active && (t.status === "occupied" || t.occupied),
    ).length;

    const countReserved = tables.filter(
        (t) => t.is_active && t.status === "reserved",
    ).length;

    const countCleaning = tables.filter(
        (t) =>
            t.is_active &&
            (t.status === "cleaning" || Boolean(t.cleaning_since)),
    ).length;

    // Filtered arrival queue
    const arrivalsList = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        const filtered = reservations
            .filter((r) =>
                ["confirmed", "pending", "seated"].includes(r.status),
            )
            .filter((r) => {
                if (!q) return true;
                return (
                    r.customer_name.toLowerCase().includes(q) ||
                    (r.customer_phone || "").includes(q) ||
                    (r.table_number || "").toLowerCase().includes(q)
                );
            });
        return filtered.sort((a, b) =>
            a.start_time.localeCompare(b.start_time),
        );
    }, [reservations, searchTerm]);

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-8">
            {/* ─── Reception Welcome Header Banner ─── */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 p-6 sm:p-8 text-white shadow-lg">
                <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Badge className="bg-white/20 text-white hover:bg-white/30 border-white/20 text-xs px-2.5 py-0.5 backdrop-blur-md">
                                <Sparkles className="h-3 w-3 mr-1 text-amber-300" />{" "}
                                Front Desk & Reception
                            </Badge>
                            <span className="text-white/80 text-xs font-medium">
                                {format(new Date(), "EEEE, MMMM d, yyyy")}
                            </span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                            Welcome back, {firstName} 👋
                        </h1>
                        <p className="text-white/80 text-sm max-w-xl">
                            Live guest arrivals, quick walk-in seating, waiting
                            list management, and floor table turnover for{" "}
                            {activeRestaurant?.name || "your restaurant"}.
                        </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                        <Button
                            onClick={() => setWalkInOpen(true)}
                            className="bg-white text-emerald-800 hover:bg-white/90 font-bold shadow-md rounded-xl text-xs gap-1.5"
                        >
                            <Plus className="h-4 w-4" /> Quick Walk-In
                        </Button>
                        <Button
                            onClick={() => setWaitAddOpen(true)}
                            variant="outline"
                            className="bg-white/10 hover:bg-white/20 text-white border-white/30 font-semibold rounded-xl text-xs gap-1.5"
                        >
                            <Users className="h-4 w-4" /> Add Waiting Guest
                        </Button>
                    </div>
                </div>
            </div>

            {/* ─── Operational KPI Cards (No sales/revenue) ─── */}
            <div className="grid grid-cols-1 gap-3.5 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
                {[
                    {
                        label: "Today's Bookings",
                        value: totalBookings,
                        desc: "Total scheduled",
                        icon: CalendarDays,
                        color: "text-emerald-600 dark:text-emerald-400",
                        bg: "bg-emerald-500/10 border-emerald-500/20",
                    },
                    {
                        label: "Awaiting Arrival",
                        value: awaitingArrival,
                        desc: "Confirmed guests",
                        icon: Clock,
                        color: "text-amber-600 dark:text-amber-400",
                        bg: "bg-amber-500/10 border-amber-500/20",
                    },
                    {
                        label: "Currently Seated",
                        value: currentlySeated,
                        desc: "Parties dining",
                        icon: UtensilsCrossed,
                        color: "text-blue-600 dark:text-blue-400",
                        bg: "bg-blue-500/10 border-blue-500/20",
                    },
                    {
                        label: "Pending Requests",
                        value: pendingRequests,
                        desc: "Need confirmation",
                        icon: AlertCircle,
                        color: "text-purple-600 dark:text-purple-400",
                        bg: "bg-purple-500/10 border-purple-500/20",
                    },
                    {
                        label: "Waiting List",
                        value: waitingCount,
                        desc: "In waiting queue",
                        icon: Users,
                        color: "text-cyan-600 dark:text-cyan-400",
                        bg: "bg-cyan-500/10 border-cyan-500/20",
                    },
                ].map((card) => (
                    <Card
                        key={card.label}
                        className="border border-border/70 rounded-2xl shadow-2xs overflow-hidden"
                    >
                        <CardContent className="p-3.5 sm:p-4">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                        {card.label}
                                    </p>
                                    <p className="text-xl sm:text-2xl font-black text-foreground mt-0.5 tracking-tight">
                                        {card.value}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground truncate">
                                        {card.desc}
                                    </p>
                                </div>
                                <div
                                    className={cn(
                                        "w-9 h-9 rounded-xl flex items-center justify-center border shrink-0",
                                        card.bg,
                                    )}
                                >
                                    <card.icon
                                        className={cn("h-4 w-4", card.color)}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* ─── Table Capacity Bar ─── */}
            <div className="flex items-center justify-between p-3 px-4 rounded-xl border border-border/70 bg-card text-xs flex-wrap gap-3">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                    <TableProperties className="h-4 w-4 text-primary" />
                    <span>Floor Tables Status:</span>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                    <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                        {countAvailable} Available
                    </span>
                    <span className="flex items-center gap-1.5 font-medium text-rose-600 dark:text-rose-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                        {countOccupied} Occupied
                    </span>
                    <span className="flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                        {countReserved} Reserved
                    </span>
                    <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                        {countCleaning} Cleaning
                    </span>
                </div>
                <Link
                    to="/reservations?tab=tables"
                    className="text-primary font-semibold hover:underline flex items-center gap-1 ml-auto"
                >
                    View Full Floor <ArrowRight className="h-3 w-3" />
                </Link>
            </div>

            {/* ─── Operations Grid: Arrival Queue + Mini Floor & Waiting List ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column (2 Cols): Live Guest Arrival Desk */}
                <div className="lg:col-span-2 space-y-4">
                    <Card className="border border-border/70 rounded-2xl shadow-xs overflow-hidden">
                        <CardHeader className="p-4 sm:p-5 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20">
                            <div>
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <UserCheck className="h-4 w-4 text-primary" />
                                    Live Guest Arrival Queue (Today)
                                </CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Confirm arrival, seat party, or mark no-show
                                </p>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <div className="relative flex-1 sm:w-56">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                        placeholder="Search guest, phone, table..."
                                        className="pl-8 h-8.5 text-xs rounded-xl"
                                        value={searchTerm}
                                        onChange={(e) =>
                                            setSearchTerm(e.target.value)
                                        }
                                    />
                                </div>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8.5 w-8.5 rounded-xl shrink-0"
                                    onClick={loadData}
                                    title="Refresh"
                                >
                                    <RefreshCw
                                        className={cn(
                                            "h-3.5 w-3.5",
                                            loading && "animate-spin",
                                        )}
                                    />
                                </Button>
                            </div>
                        </CardHeader>

                        <CardContent className="p-4 sm:p-5 space-y-3">
                            {loading ? (
                                <div className="space-y-3 py-4">
                                    <Skeleton className="h-20 w-full rounded-xl" />
                                    <Skeleton className="h-20 w-full rounded-xl" />
                                    <Skeleton className="h-20 w-full rounded-xl" />
                                </div>
                            ) : arrivalsList.length === 0 ? (
                                <div className="text-center py-12 space-y-2">
                                    <CalendarDays className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                                    <p className="text-sm font-semibold text-foreground">
                                        No active arrivals in queue
                                    </p>
                                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                                        {searchTerm
                                            ? "No reservations match your search query."
                                            : "All scheduled guests for today have been checked in or no bookings remain."}
                                    </p>
                                </div>
                            ) : (
                                arrivalsList.map((res) => (
                                    <div
                                        key={res.id}
                                        className="p-4 rounded-2xl border border-border/70 bg-card hover:border-primary/40 transition-all shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                                    >
                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-xs text-primary shrink-0">
                                                {res.customer_name
                                                    .slice(0, 2)
                                                    .toUpperCase()}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="font-bold text-sm text-foreground truncate">
                                                        {res.customer_name}
                                                    </p>
                                                    <Badge
                                                        variant="outline"
                                                        className={cn(
                                                            "text-[10px] font-semibold px-2 py-0",
                                                            res.status ===
                                                                "seated"
                                                                ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30"
                                                                : res.status ===
                                                                    "confirmed"
                                                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                                                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
                                                        )}
                                                    >
                                                        {res.status === "seated"
                                                            ? "Seated"
                                                            : res.status ===
                                                                "confirmed"
                                                              ? "Confirmed"
                                                              : "Pending"}
                                                    </Badge>
                                                    {res.source ===
                                                        "walk_in" && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[10px] px-1.5 py-0 text-cyan-700 border-cyan-500/30 bg-cyan-500/10"
                                                        >
                                                            Walk-in
                                                        </Badge>
                                                    )}
                                                    {res.source === "phone" && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[10px] gap-1 px-1.5 py-0 text-violet-600 border-violet-500/20 bg-violet-500/5"
                                                        >
                                                            <PhoneCall className="h-2.5 w-2.5" />{" "}
                                                            Voice AI
                                                        </Badge>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                                                    <span className="flex items-center gap-1 font-medium text-foreground">
                                                        <Clock className="h-3 w-3 text-primary" />{" "}
                                                        {res.start_time.slice(
                                                            0,
                                                            5,
                                                        )}{" "}
                                                        (
                                                        {
                                                            res.slot_duration_hours
                                                        }
                                                        h)
                                                    </span>
                                                    <span className="flex items-center gap-1 font-medium">
                                                        <Users className="h-3 w-3 text-primary" />{" "}
                                                        {res.party_size}{" "}
                                                        {res.party_size > 1
                                                            ? "Guests"
                                                            : "Guest"}
                                                    </span>
                                                    {res.customer_phone && (
                                                        <a
                                                            href={`tel:${res.customer_phone}`}
                                                            className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                                                        >
                                                            <Phone className="h-3 w-3" />{" "}
                                                            {res.customer_phone}
                                                        </a>
                                                    )}
                                                </div>

                                                {/* Assigned Table & Notes */}
                                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                    {res.table_number ? (
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-500/20">
                                                            <TableProperties className="h-3.5 w-3.5 text-emerald-600" />
                                                            {displayTableNumber(
                                                                res.table_number,
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300 font-medium">
                                                            <AlertCircle className="h-3.5 w-3.5" />{" "}
                                                            No table assigned
                                                        </span>
                                                    )}
                                                    {res.notes && (
                                                        <span className="text-[11px] text-muted-foreground italic truncate max-w-xs">
                                                            "{res.notes}"
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Operational Action Buttons */}
                                        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end flex-wrap">
                                            {res.status === "confirmed" && (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        className="h-8.5 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                                                        onClick={() =>
                                                            handleCustomerArrived(
                                                                res,
                                                            )
                                                        }
                                                    >
                                                        <UserCheck className="h-3.5 w-3.5" />
                                                        {res.table_number
                                                            ? `Seat at ${displayTableNumber(res.table_number)}`
                                                            : "Guest Arrived"}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8.5 text-xs font-semibold gap-1 text-destructive hover:bg-destructive/10 rounded-xl"
                                                        onClick={() =>
                                                            openNoShowModal(res)
                                                        }
                                                    >
                                                        <UserX className="h-3.5 w-3.5" />{" "}
                                                        No-Show
                                                    </Button>
                                                </>
                                            )}

                                            {res.status === "pending" && (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        className="h-8.5 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                                                        onClick={() =>
                                                            handleConfirmReservation(
                                                                res,
                                                            )
                                                        }
                                                    >
                                                        <Check className="h-3.5 w-3.5" />{" "}
                                                        Confirm
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8.5 text-xs font-semibold gap-1 text-destructive hover:bg-destructive/10 rounded-xl"
                                                        onClick={() =>
                                                            openNoShowModal(res)
                                                        }
                                                    >
                                                        <UserX className="h-3.5 w-3.5" />{" "}
                                                        Reject / No-Show
                                                    </Button>
                                                </>
                                            )}

                                            {res.status === "seated" && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8.5 text-xs font-semibold gap-1.5 text-foreground border-border/80 hover:bg-muted rounded-xl"
                                                    onClick={() =>
                                                        handleCompleteDining(
                                                            res.id,
                                                        )
                                                    }
                                                >
                                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{" "}
                                                    Complete Dining
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    {/* ─── Waiting List Section ─── */}
                    <Card className="border border-border/70 rounded-2xl shadow-xs overflow-hidden">
                        <CardHeader className="p-4 sm:p-5 border-b border-border/50 flex flex-row items-center justify-between bg-muted/20">
                            <div>
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <Users className="h-4 w-4 text-primary" />
                                    Live Waiting List ({waitingList.length})
                                </CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Walk-in guests waiting for an available
                                    table
                                </p>
                            </div>
                            <Button
                                size="sm"
                                onClick={() => setWaitAddOpen(true)}
                                className="gradient-primary text-xs font-semibold h-8 rounded-xl gap-1"
                            >
                                <Plus className="h-3.5 w-3.5" /> Add Guest
                            </Button>
                        </CardHeader>

                        <CardContent className="p-4 space-y-2.5">
                            {waitingList.length === 0 ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">
                                    No parties currently on the waiting list.
                                </div>
                            ) : (
                                waitingList.map((item) => (
                                    <div
                                        key={item.id}
                                        className="p-3 rounded-xl border border-border/70 bg-card hover:border-primary/30 flex items-center justify-between gap-3 text-xs"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 font-bold flex items-center justify-center shrink-0">
                                                {item.guest_name
                                                    .slice(0, 2)
                                                    .toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-foreground truncate">
                                                    {item.guest_name}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground">
                                                    {item.party_size} guests{" "}
                                                    {item.phone
                                                        ? `· ${item.phone}`
                                                        : ""}{" "}
                                                    · Quoted:{" "}
                                                    {item.quoted_wait_minutes ||
                                                        15}
                                                    m
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <Button
                                                size="sm"
                                                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg gap-1"
                                                onClick={() => {
                                                    setSeatWaitEntry(item);
                                                    setSeatWaitTableId(
                                                        availableTables[0]
                                                            ?.id || "",
                                                    );
                                                }}
                                            >
                                                <UtensilsCrossed className="h-3 w-3" />{" "}
                                                Seat
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className={cn(
                                                    "h-7 text-xs rounded-lg gap-1",
                                                    item.notified_at &&
                                                        "text-blue-600 border-blue-400 bg-blue-50/50",
                                                )}
                                                onClick={() =>
                                                    handleNotifyWaitingGuest(
                                                        item.id,
                                                    )
                                                }
                                                title={
                                                    item.notified_at
                                                        ? "Notified already"
                                                        : "Notify guest"
                                                }
                                            >
                                                <Bell className="h-3 w-3" />{" "}
                                                {item.notified_at
                                                    ? "Notified"
                                                    : "Notify"}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-destructive"
                                                onClick={() =>
                                                    handleRemoveWaitingGuest(
                                                        item.id,
                                                    )
                                                }
                                                title="Remove"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column (1 Col): Floor Tables Availability */}
                <div className="space-y-4">
                    <Card className="border border-border/70 rounded-2xl shadow-xs overflow-hidden">
                        <CardHeader className="p-4 sm:p-5 border-b border-border/50 flex flex-row items-center justify-between bg-muted/20">
                            <div>
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <TableProperties className="h-4 w-4 text-primary" />
                                    Mini Floor Status
                                </CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Live occupancy & table turnover
                                </p>
                            </div>
                            <Link
                                to="/reservations?tab=tables"
                                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                            >
                                View Tables <ArrowRight className="h-3 w-3" />
                            </Link>
                        </CardHeader>

                        <CardContent className="p-4 space-y-2.5 max-h-[620px] overflow-y-auto custom-scrollbar">
                            {tables.filter((t) => t.is_active).length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-8">
                                    No active tables configured.
                                </p>
                            ) : (
                                tables
                                    .filter((t) => t.is_active)
                                    .map((t) => {
                                        const isCleaning =
                                            t.status === "cleaning" ||
                                            Boolean(t.cleaning_since);
                                        const isOccupied =
                                            t.status === "occupied" ||
                                            Boolean(t.occupied);
                                        const isReserved =
                                            t.status === "reserved";
                                        const isAvail =
                                            !isOccupied &&
                                            !isCleaning &&
                                            !isReserved;

                                        return (
                                            <div
                                                key={t.id}
                                                className={cn(
                                                    "p-3 rounded-xl border transition-all text-xs flex items-center justify-between gap-2",
                                                    isOccupied &&
                                                        "bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-100",
                                                    isCleaning &&
                                                        "bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100",
                                                    isReserved &&
                                                        "bg-blue-500/10 border-blue-500/30 text-blue-950 dark:text-blue-100",
                                                    isAvail &&
                                                        "bg-card border-border/70 hover:border-emerald-500/40 text-foreground",
                                                )}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div
                                                        className={cn(
                                                            "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0",
                                                            isOccupied &&
                                                                "bg-rose-500/20 text-rose-700 dark:text-rose-300",
                                                            isCleaning &&
                                                                "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                                                            isReserved &&
                                                                "bg-blue-500/20 text-blue-700 dark:text-blue-300",
                                                            isAvail &&
                                                                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                                                        )}
                                                    >
                                                        <TableProperties className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-xs truncate">
                                                            {displayTableNumber(
                                                                t.table_number,
                                                            )}
                                                        </p>
                                                        <p className="text-[11px] text-muted-foreground truncate">
                                                            {t.capacity} seats{" "}
                                                            {t.location
                                                                ? `· ${t.location}`
                                                                : ""}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0 flex items-center gap-1.5">
                                                    {isOccupied && (
                                                        <Badge className="bg-rose-600 text-white text-[10px] px-2 py-0 font-bold">
                                                            Occupied
                                                        </Badge>
                                                    )}
                                                    {isCleaning && (
                                                        <>
                                                            <Badge className="bg-amber-500 text-white text-[10px] px-2 py-0 font-bold">
                                                                Cleaning
                                                            </Badge>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-6 text-[10px] px-2 rounded-md border-amber-400 text-amber-800 dark:text-amber-200 hover:bg-amber-100"
                                                                onClick={() =>
                                                                    handleMarkClean(
                                                                        t.id,
                                                                    )
                                                                }
                                                            >
                                                                Mark Clean
                                                            </Button>
                                                        </>
                                                    )}
                                                    {isReserved && (
                                                        <Badge className="bg-blue-600 text-white text-[10px] px-2 py-0 font-bold">
                                                            Reserved
                                                        </Badge>
                                                    )}
                                                    {isAvail && (
                                                        <Badge
                                                            variant="outline"
                                                            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] px-2 py-0 font-bold"
                                                        >
                                                            Available
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* ─── WALK-IN MODAL ─── */}
            <Dialog open={walkInOpen} onOpenChange={setWalkInOpen}>
                <DialogContent className="max-w-md">
                    <form onSubmit={handleCreateWalkIn}>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <UtensilsCrossed className="h-5 w-5 text-emerald-600" />
                                Seat Walk-in Party
                            </DialogTitle>
                            <DialogDescription>
                                Seat guests who arrived without a prior booking.
                                This immediately marks the table occupied.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4 text-xs">
                            <div className="space-y-1.5">
                                <Label htmlFor="walkin-party">
                                    Party Size (Required)
                                </Label>
                                <Input
                                    id="walkin-party"
                                    type="number"
                                    min="1"
                                    max="50"
                                    value={walkInPartySize}
                                    onChange={(e) =>
                                        setWalkInPartySize(e.target.value)
                                    }
                                    required
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="walkin-table">
                                    Select Available Table (Required)
                                </Label>
                                {availableTables.length === 0 ? (
                                    <p className="text-amber-600 font-medium">
                                        No tables currently available. Add party
                                        to Waiting List.
                                    </p>
                                ) : (
                                    <Select
                                        value={walkInTableId}
                                        onValueChange={setWalkInTableId}
                                        required
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Choose an available table..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableTables.map((t) => (
                                                <SelectItem
                                                    key={t.id}
                                                    value={t.id}
                                                >
                                                    {displayTableNumber(
                                                        t.table_number,
                                                    )}{" "}
                                                    ({t.capacity} seats
                                                    {t.location
                                                        ? ` - ${t.location}`
                                                        : ""}
                                                    )
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="walkin-name">
                                    Guest Name (Optional)
                                </Label>
                                <Input
                                    id="walkin-name"
                                    placeholder="e.g. John Doe / Walk-in Guest"
                                    value={walkInName}
                                    onChange={(e) =>
                                        setWalkInName(e.target.value)
                                    }
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="walkin-phone">
                                    Phone Number (Optional)
                                </Label>
                                <Input
                                    id="walkin-phone"
                                    placeholder="e.g. +1 555-0192"
                                    value={walkInPhone}
                                    onChange={(e) =>
                                        setWalkInPhone(e.target.value)
                                    }
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="walkin-notes">
                                    Notes / Special Requests
                                </Label>
                                <Textarea
                                    id="walkin-notes"
                                    placeholder="e.g. Highchair needed, booth preference..."
                                    value={walkInNotes}
                                    onChange={(e) =>
                                        setWalkInNotes(e.target.value)
                                    }
                                    rows={2}
                                />
                            </div>
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setWalkInOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                className="gradient-primary"
                                disabled={
                                    submittingWalkIn ||
                                    availableTables.length === 0
                                }
                            >
                                {submittingWalkIn
                                    ? "Seating..."
                                    : "Confirm & Seat"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ─── NO-SHOW DIALOG ─── */}
            <Dialog open={noShowOpen} onOpenChange={setNoShowOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <UserX className="h-5 w-5" />
                            Mark as No-Show
                        </DialogTitle>
                        <DialogDescription>
                            Mark {noShowTarget?.customer_name}'s reservation as
                            No-Show to release their reserved table.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4 text-xs">
                        <div className="space-y-1.5">
                            <Label>Reason for No-Show</Label>
                            <Select
                                value={noShowReason}
                                onValueChange={setNoShowReason}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Did not show">
                                        Did not show (Late / Unreachable)
                                    </SelectItem>
                                    <SelectItem value="Called to cancel">
                                        Called to cancel last minute
                                    </SelectItem>
                                    <SelectItem value="Wrong booking">
                                        Wrong date / time booking
                                    </SelectItem>
                                    <SelectItem value="Other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="noshow-notes">
                                Additional Notes (Optional)
                            </Label>
                            <Textarea
                                id="noshow-notes"
                                placeholder="e.g. Called twice at +10 mins, phone went to voicemail"
                                value={noShowNotes}
                                onChange={(e) => setNoShowNotes(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setNoShowOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleNoShowSubmit}
                            disabled={submittingNoShow}
                        >
                            {submittingNoShow
                                ? "Marking..."
                                : "Confirm No-Show"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── ADD TO WAITING LIST MODAL ─── */}
            <Dialog open={waitAddOpen} onOpenChange={setWaitAddOpen}>
                <DialogContent className="max-w-md">
                    <form onSubmit={handleAddToWaitingList}>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-primary" />
                                Add to Waiting List
                            </DialogTitle>
                            <DialogDescription>
                                Add arriving guests to the wait queue when no
                                tables are immediately ready.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4 text-xs">
                            <div className="space-y-1.5">
                                <Label htmlFor="wait-name">
                                    Guest Name (Required)
                                </Label>
                                <Input
                                    id="wait-name"
                                    placeholder="e.g. Sarah Smith"
                                    value={waitGuestName}
                                    onChange={(e) =>
                                        setWaitGuestName(e.target.value)
                                    }
                                    required
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="wait-phone">
                                    Phone Number (For SMS / Call)
                                </Label>
                                <Input
                                    id="wait-phone"
                                    placeholder="e.g. +1 555-0144"
                                    value={waitPhone}
                                    onChange={(e) =>
                                        setWaitPhone(e.target.value)
                                    }
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="wait-party">
                                        Party Size
                                    </Label>
                                    <Input
                                        id="wait-party"
                                        type="number"
                                        min="1"
                                        value={waitPartySize}
                                        onChange={(e) =>
                                            setWaitPartySize(e.target.value)
                                        }
                                        required
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="wait-time">
                                        Quoted Wait (Mins)
                                    </Label>
                                    <Input
                                        id="wait-time"
                                        type="number"
                                        min="5"
                                        step="5"
                                        value={waitQuotedMins}
                                        onChange={(e) =>
                                            setWaitQuotedMins(e.target.value)
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setWaitAddOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                className="gradient-primary"
                                disabled={submittingWait}
                            >
                                {submittingWait
                                    ? "Adding..."
                                    : "Add to Wait List"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ─── SEAT FROM WAITING LIST MODAL ─── */}
            <Dialog
                open={Boolean(seatWaitEntry)}
                onOpenChange={(open) => !open && setSeatWaitEntry(null)}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UtensilsCrossed className="h-5 w-5 text-emerald-600" />
                            Seat Waiting Guest: {seatWaitEntry?.guest_name}
                        </DialogTitle>
                        <DialogDescription>
                            Assign an available table for party of{" "}
                            {seatWaitEntry?.party_size}.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4 text-xs">
                        <div className="space-y-1.5">
                            <Label>Select Available Table</Label>
                            {availableTables.length === 0 ? (
                                <p className="text-amber-600 font-medium">
                                    No available tables right now.
                                </p>
                            ) : (
                                <Select
                                    value={seatWaitTableId}
                                    onValueChange={setSeatWaitTableId}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select table..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableTables.map((t) => (
                                            <SelectItem key={t.id} value={t.id}>
                                                {displayTableNumber(
                                                    t.table_number,
                                                )}{" "}
                                                ({t.capacity} seats
                                                {t.location
                                                    ? ` - ${t.location}`
                                                    : ""}
                                                )
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setSeatWaitEntry(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="gradient-primary"
                            onClick={handleSeatWaitingGuest}
                            disabled={submittingSeatWait || !seatWaitTableId}
                        >
                            {submittingSeatWait
                                ? "Seating..."
                                : "Seat Guest Now"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
