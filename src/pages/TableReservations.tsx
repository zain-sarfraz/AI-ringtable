import {
    CallData,
    ConversationTurn,
    OrderCallRecording,
} from "@/components/orders/OrderCallRecording";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useActiveRestaurant } from "@/hooks/useActiveRestaurant";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { formatCurrency } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { format, isToday } from "date-fns";
import {
    AlertCircle,
    CalendarDays,
    CheckCircle2,
    Clock,
    Copy,
    ExternalLink,
    Eye,
    LayoutGrid,
    Mail,
    MessageSquare,
    MoreHorizontal,
    Pencil,
    Phone,
    PhoneCall,
    Plus,
    Printer,
    QrCode,
    RefreshCw,
    Search,
    TableProperties,
    Trash2,
    UserCheck,
    Users,
    UtensilsCrossed,
    Volume2,
    X,
    XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return (name.slice(0, 2) || "R").toUpperCase();
};

const displayTableNumber = (tableNum?: string | null) => {
    if (!tableNum) return "";
    const trimmed = tableNum.trim();
    if (/^table\b/i.test(trimmed)) return trimmed;
    return `Table ${trimmed}`;
};

function formatSafeDate(dateStr?: string | null): string {
    if (!dateStr) return "N/A";
    try {
        const raw = String(dateStr).trim();
        const datePart = raw.split("T")[0].split(" ")[0];
        const parts = datePart.split("-");
        if (parts.length === 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            if (y && m && d) {
                const dateObj = new Date(y, m - 1, d);
                if (!isNaN(dateObj.getTime())) {
                    return format(dateObj, "EEE, MMM d, yyyy");
                }
            }
        }
        const fallback = new Date(raw);
        if (!isNaN(fallback.getTime())) {
            return format(fallback, "EEE, MMM d, yyyy");
        }
        return dateStr;
    } catch {
        return String(dateStr);
    }
}

const getDisplayNotes = (notes: string | null) => {
    if (!notes) return null;
    if (
        /reserved via synthflow/i.test(notes) ||
        /phone ai/i.test(notes) ||
        /authflow/i.test(notes) ||
        /synthflow/i.test(notes)
    ) {
        return null;
    }
    return notes.trim();
};

const STATUS_COLORS: Record<string, string> = {
    pending:
        "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25",
    confirmed:
        "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
    seated: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
    completed:
        "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/25",
    cancelled:
        "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25",
    no_show:
        "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25",
};

const STATUS_DOT_COLORS: Record<string, string> = {
    pending: "bg-amber-500",
    confirmed: "bg-emerald-500",
    seated: "bg-blue-500",
    completed: "bg-slate-400",
    cancelled: "bg-rose-500",
    no_show: "bg-zinc-400",
};

const STATUS_CARD_ACCENTS: Record<string, string> = {
    pending: "border-l-4 border-l-amber-500",
    confirmed: "border-l-4 border-l-emerald-500",
    seated: "border-l-4 border-l-blue-500",
    completed: "border-l-4 border-l-slate-400",
    cancelled: "border-l-4 border-l-rose-500",
    no_show: "border-l-4 border-l-zinc-400",
};

const STATUS_LABELS: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    seated: "Seated",
    completed: "Completed",
    cancelled: "Cancelled",
    no_show: "No Show",
};

const SLOTS = ["1", "1.5", "2", "2.5", "3"];

interface RestaurantTable {
    id: string;
    table_number: string;
    capacity: number;
    location: string | null;
    is_active: boolean;
    notes: string | null;
}

interface Reservation {
    id: string;
    restaurant_id?: string | null;
    table_id: string | null;
    table_number: string | null;
    table_capacity: number | null;
    table_location: string | null;
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
    call_id?: string | null;
    ai_extracted_data?: any;
    call_transcript?: string | null;
    call_recording_url?: string | null;
    call_notes?: string | null;
    call_duration_seconds?: number | null;
    created_at: string;
}

export default function TableReservations() {
    const { restaurantId, activeRestaurant } = useActiveRestaurant();
    const { role, isReceptionist } = useAuth();
    const isRestaurantAdmin = role === "admin" || role === "super_admin";
    const [searchParams, setSearchParams] = useSearchParams();
    const mainTab =
        searchParams.get("tab") === "tables" ? "tables" : "reservations";

    type FloorBill = {
        session?: {
            id?: string;
            customer_name?: string | null;
            table_number?: string;
        };
        orders?: { id: string }[];
        totals?: { order_count?: number; total_amount?: number };
    };
    type FloorTableState = RestaurantTable & {
        occupied?: boolean;
        sessions?: FloorBill[];
    };

    const [tables, setTables] = useState<RestaurantTable[]>([]);
    const [floorTables, setFloorTables] = useState<FloorTableState[]>([]);
    const [qrTable, setQrTable] = useState<RestaurantTable | null>(null);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    type DateFilterMode = "current" | "today" | "past" | "all" | "custom";
    const [dateFilterMode, setDateFilterMode] =
        useState<DateFilterMode>("current");
    const [customDate, setCustomDate] = useState<string>("");
    const [viewMode, setViewMode] = useState<"table" | "cards">("table");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    // Reservation Details Modal
    const [detailDialogOpen, setDetailDialogOpen] = useState(false);
    const [detailReservation, setDetailReservation] =
        useState<Reservation | null>(null);
    const [call, setCall] = useState<CallData | null>(null);
    const [conversations, setConversations] = useState<ConversationTurn[]>([]);
    const [callLoading, setCallLoading] = useState(false);

    const loadReservationCall = useCallback(async (res: Reservation) => {
        setCallLoading(true);
        let loadedCall: CallData | null = null;
        let convTurns: ConversationTurn[] = [];

        try {
            // 1. Match by call_id if present
            if (res.call_id) {
                const { data: cData } = await supabase
                    .from("calls")
                    .select("*")
                    .eq("id", res.call_id)
                    .maybeSingle();
                if (cData) loadedCall = cData as CallData;
            }

            // 2. Match by synthflow_call_id
            if (!loadedCall && res.ai_extracted_data?.synthflow_call_id) {
                const { data: cData } = await supabase
                    .from("calls")
                    .select("*")
                    .eq(
                        "synthflow_call_id",
                        res.ai_extracted_data.synthflow_call_id,
                    )
                    .maybeSingle();
                if (cData) loadedCall = cData as CallData;
            }

            // 3. Fallback: same caller, comparing the last 10 digits (0323… and +92323… are the same number)
            if (!loadedCall && res.customer_phone) {
                const tail = res.customer_phone.replace(/\D/g, "").slice(-10);
                if (tail.length >= 8) {
                    const { data: cList } = await supabase
                        .from("calls")
                        .select("*")
                        .order("created_at", { ascending: false })
                        .limit(40);
                    if (Array.isArray(cList)) {
                        const matches = cList.filter((c: any) => {
                            const cTail = String(c.phone_number || "")
                                .replace(/\D/g, "")
                                .slice(-10);
                            return cTail && cTail === tail;
                        });
                        const withMedia = matches.find(
                            (c: any) => c.recording_url || c.transcript,
                        );
                        if (withMedia) loadedCall = withMedia as CallData;
                        else if (matches[0])
                            loadedCall = matches[0] as CallData;
                    }
                }
            }

            // 4. If loadedCall has an id, fetch conversation turns
            if (loadedCall?.id) {
                const { data: convData } = await supabase
                    .from("conversations")
                    .select("*")
                    .eq("call_id", loadedCall.id)
                    .order("created_at", { ascending: true });
                if (convData && Array.isArray(convData)) {
                    convTurns = convData as ConversationTurn[];
                }
            }

            // 5. Fallback from reservation fields if call row not found
            if (
                !loadedCall &&
                (res.call_transcript ||
                    res.call_recording_url ||
                    res.ai_extracted_data)
            ) {
                loadedCall = {
                    id: res.call_id || res.id,
                    phone_number: res.customer_phone,
                    duration_seconds:
                        res.call_duration_seconds ||
                        res.ai_extracted_data?.duration_seconds,
                    status: "completed",
                    recording_url:
                        res.call_recording_url ||
                        res.ai_extracted_data?.recording_url,
                    transcript:
                        res.call_transcript ||
                        res.ai_extracted_data?.transcript,
                    notes:
                        res.call_notes || res.ai_extracted_data?.call_summary,
                    provider: res.ai_extracted_data?.provider || "synthflow",
                    metadata: res.ai_extracted_data,
                    synthflow_call_id: res.ai_extracted_data?.synthflow_call_id,
                };
            }
        } catch (err) {
            console.warn("Could not load call for reservation:", err);
        } finally {
            setCall(loadedCall);
            setConversations(convTurns);
            setCallLoading(false);
        }
    }, []);

    const openDetailReservation = (r: Reservation) => {
        setDetailReservation(r);
        setDetailDialogOpen(true);
        void loadReservationCall(r);
    };

    // Table form
    const [tableDialogOpen, setTableDialogOpen] = useState(false);
    const [editingTable, setEditingTable] = useState<RestaurantTable | null>(
        null,
    );
    const [tableForm, setTableForm] = useState({
        table_number: "",
        capacity: "4",
        location: "",
        notes: "",
    });

    // Reservation form
    const [reservationDialogOpen, setReservationDialogOpen] = useState(false);
    const [editingReservation, setEditingReservation] =
        useState<Reservation | null>(null);
    const [reservationForm, setReservationForm] = useState({
        table_id: "",
        customer_name: "",
        customer_phone: "",
        customer_email: "",
        party_size: "2",
        reservation_date: format(new Date(), "yyyy-MM-dd"),
        start_time: "19:00",
        slot_duration_hours: "1",
        notes: "",
        status: "confirmed",
    });

    // Delete
    const [deleteReservationId, setDeleteReservationId] = useState<
        string | null
    >(null);
    const [deleteTableId, setDeleteTableId] = useState<string | null>(null);

    const restaurantSlug = useMemo(() => {
        return (
            activeRestaurant?.slug ||
            (activeRestaurant?.name
                ? activeRestaurant.name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")
                : "restaurant")
        );
    }, [activeRestaurant]);

    const branchIdentifier = useMemo(() => {
        return activeRestaurant?.is_branch
            ? activeRestaurant.slug || activeRestaurant.id
            : "main";
    }, [activeRestaurant]);

    const getTableMenuUrl = useCallback(
        (tbl: RestaurantTable) => {
            const origin =
                typeof window !== "undefined"
                    ? window.location.origin
                    : "http://localhost:8080";
            const cleanOrigin = origin.replace(/\/$/, "");
            const cleanTableNum = (tbl.table_number || "").trim();
            return `${cleanOrigin}/${restaurantSlug}/${branchIdentifier}/menu?table=${encodeURIComponent(cleanTableNum)}&table_id=${tbl.id}`;
        },
        [restaurantSlug, branchIdentifier],
    );

    const authHeader = () => ({
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
    });
    const API = getApiBase() + "/api";

    // ── Data Fetching ──────────────────────────────────────
    const loadTables = useCallback(async () => {
        if (!restaurantId) return;
        const r = await fetch(`${API}/restaurants/${restaurantId}/tables`, {
            headers: authHeader(),
        });
        if (r.ok) setTables((await r.json()).tables || []);
    }, [restaurantId]);

    const loadFloorTables = useCallback(async () => {
        if (!restaurantId) return;
        const r = await fetch(
            `${API}/restaurants/${restaurantId}/floor-tables`,
            { headers: authHeader() },
        );
        if (!r.ok) return;
        const json = await r.json();
        const list: FloorTableState[] = json.tables || [];
        const extras: FloorTableState[] = (json.unmatched_sessions || []).map(
            (bill: FloorBill, idx: number) => ({
                id: `session-${bill.session?.id || idx}`,
                table_number: bill.session?.table_number || `Open ${idx + 1}`,
                capacity: 0,
                location: null,
                notes: "Opened from QR / staff order",
                is_active: true,
                occupied: true,
                sessions: [bill],
            }),
        );
        const tableKey = (value?: string | null) =>
            String(value || "")
                .trim()
                .toLowerCase()
                .replace(/^table[\s._-]*/i, "")
                .trim();
        const merged = [...list];
        for (const extra of extras) {
            const match = merged.find(
                (t) =>
                    tableKey(t.table_number) === tableKey(extra.table_number),
            );
            if (match) {
                match.occupied = true;
                match.sessions = [
                    ...(match.sessions || []),
                    ...(extra.sessions || []),
                ];
            } else {
                merged.push(extra);
            }
        }
        setFloorTables(merged);
    }, [restaurantId]);

    const loadReservations = useCallback(async () => {
        if (!restaurantId) return;
        setLoading(true);
        const url = `${API}/restaurants/${restaurantId}/reservations`;
        const r = await fetch(url, { headers: authHeader() });
        if (r.ok) setReservations((await r.json()).reservations || []);
        setLoading(false);
    }, [restaurantId]);

    useEffect(() => {
        loadTables();
    }, [loadTables]);
    useEffect(() => {
        loadFloorTables();
    }, [loadFloorTables]);
    useEffect(() => {
        if (!restaurantId) return;
        const timer = setInterval(() => {
            void loadFloorTables();
        }, 8000);
        return () => clearInterval(timer);
    }, [restaurantId, loadFloorTables]);
    useEffect(() => {
        loadReservations();
    }, [loadReservations]);

    // ── Table CRUD ─────────────────────────────────────────
    const openAddTable = () => {
        setEditingTable(null);
        setTableForm({
            table_number: "",
            capacity: "4",
            location: "",
            notes: "",
        });
        setTableDialogOpen(true);
    };

    const openEditTable = (t: RestaurantTable) => {
        setEditingTable(t);
        setTableForm({
            table_number: t.table_number,
            capacity: String(t.capacity),
            location: t.location || "",
            notes: t.notes || "",
        });
        setTableDialogOpen(true);
    };

    const saveTable = async () => {
        if (!tableForm.table_number.trim()) {
            toast.error("Table number is required");
            return;
        }
        if (Number(tableForm.capacity) < 1) {
            toast.error("Capacity must be at least 1");
            return;
        }
        try {
            let r;
            if (editingTable) {
                r = await fetch(`${API}/tables/${editingTable.id}`, {
                    method: "PATCH",
                    headers: authHeader(),
                    body: JSON.stringify({
                        ...tableForm,
                        capacity: Number(tableForm.capacity),
                    }),
                });
            } else {
                r = await fetch(`${API}/restaurants/${restaurantId}/tables`, {
                    method: "POST",
                    headers: authHeader(),
                    body: JSON.stringify({
                        ...tableForm,
                        capacity: Number(tableForm.capacity),
                    }),
                });
            }
            if (!r.ok) {
                const d = await r.json();
                toast.error(d.error || "Failed to save table");
                return;
            }
            toast.success(editingTable ? "Table updated" : "Table added");
            setTableDialogOpen(false);
            loadTables();
            loadFloorTables();
        } catch {
            toast.error("Network error");
        }
    };

    const confirmDeleteTable = async () => {
        if (!deleteTableId) return;
        const r = await fetch(`${API}/tables/${deleteTableId}`, {
            method: "DELETE",
            headers: authHeader(),
        });
        if (r.ok) {
            toast.success("Table deactivated");
            loadTables();
            loadFloorTables();
        } else toast.error("Failed to deactivate table");
        setDeleteTableId(null);
    };

    // ── Reservation CRUD ───────────────────────────────────
    const openAddReservation = () => {
        setEditingReservation(null);
        setReservationForm({
            table_id: "",
            customer_name: "",
            customer_phone: "",
            customer_email: "",
            party_size: "2",
            reservation_date: format(new Date(), "yyyy-MM-dd"),
            start_time: "19:00",
            slot_duration_hours: "1",
            notes: "",
            status: "confirmed",
        });
        setReservationDialogOpen(true);
    };

    const openEditReservation = (r: Reservation) => {
        setEditingReservation(r);
        setReservationForm({
            table_id: r.table_id || "",
            customer_name: r.customer_name,
            customer_phone: r.customer_phone || "",
            customer_email: r.customer_email || "",
            party_size: String(r.party_size),
            reservation_date: r.reservation_date,
            start_time: r.start_time.slice(0, 5),
            slot_duration_hours: String(r.slot_duration_hours),
            notes: r.notes || "",
            status: r.status,
        });
        setReservationDialogOpen(true);
    };

    const saveReservation = async () => {
        if (!reservationForm.customer_name.trim()) {
            toast.error("Customer name is required");
            return;
        }
        if (!reservationForm.reservation_date) {
            toast.error("Date is required");
            return;
        }
        if (!reservationForm.start_time) {
            toast.error("Time is required");
            return;
        }
        try {
            let r;
            const payload = {
                ...reservationForm,
                party_size: Number(reservationForm.party_size),
                slot_duration_hours: Number(
                    reservationForm.slot_duration_hours,
                ),
                table_id: reservationForm.table_id || undefined,
            };
            if (editingReservation) {
                r = await fetch(
                    `${API}/reservations/${editingReservation.id}`,
                    {
                        method: "PATCH",
                        headers: authHeader(),
                        body: JSON.stringify(payload),
                    },
                );
            } else {
                r = await fetch(
                    `${API}/restaurants/${restaurantId}/reservations`,
                    {
                        method: "POST",
                        headers: authHeader(),
                        body: JSON.stringify(payload),
                    },
                );
            }
            if (!r.ok) {
                const d = await r.json();
                toast.error(d.error || "Failed to save reservation");
                return;
            }
            toast.success(
                editingReservation
                    ? "Reservation updated"
                    : "Reservation created",
            );
            setReservationDialogOpen(false);
            loadReservations();
        } catch {
            toast.error("Network error");
        }
    };

    const quickStatus = async (id: string, status: string) => {
        const r = await fetch(`${API}/reservations/${id}`, {
            method: "PATCH",
            headers: authHeader(),
            body: JSON.stringify({ status }),
        });
        if (r.ok) {
            loadReservations();
            toast.success(`Marked as ${STATUS_LABELS[status]}`);
        } else toast.error("Update failed");
    };

    const handleCustomerArrived = async (res: Reservation) => {
        if (!res.table_id && !res.table_number) {
            toast.warning("Table assignment required", {
                description: `Please assign a table for customer ${res.customer_name} first.`,
            });
            openEditReservation(res);
            return;
        }

        try {
            const r = await fetch(`${API}/reservations/${res.id}`, {
                method: "PATCH",
                headers: authHeader(),
                body: JSON.stringify({ status: "seated" }),
            });
            if (r.ok) {
                await loadReservations();
                const tblName =
                    displayTableNumber(res.table_number) ||
                    "their assigned table";
                toast.success(`🎉 Customer Arrived: ${res.customer_name}`, {
                    description: `Booking confirmed! Guest is checked in and proceeding to ${tblName}.`,
                    duration: 6000,
                });
            } else {
                const d = await r.json().catch(() => ({}));
                toast.error(d.error || "Failed to confirm arrival");
            }
        } catch {
            toast.error("Network error while confirming arrival");
        }
    };

    const confirmDeleteReservation = async () => {
        if (!deleteReservationId) return;
        const r = await fetch(`${API}/reservations/${deleteReservationId}`, {
            method: "DELETE",
            headers: authHeader(),
        });
        if (r.ok) {
            toast.success("Reservation cancelled");
            loadReservations();
        } else toast.error("Failed to cancel");
        setDeleteReservationId(null);
    };

    const todayStr = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

    const getReservationDateOnly = useCallback((dateVal?: string | null) => {
        if (!dateVal) return "";
        return String(dateVal).trim().split("T")[0].split(" ")[0];
    }, []);

    // ── Date scope counts ──────────────────────────────────
    const dateCounts = useMemo(() => {
        let today = 0;
        let upcoming = 0;
        let past = 0;
        for (const r of reservations) {
            const d = getReservationDateOnly(r.reservation_date);
            if (!d) continue;
            if (d === todayStr) {
                today++;
                upcoming++;
            } else if (d > todayStr) {
                upcoming++;
            } else if (d < todayStr) {
                past++;
            }
        }
        return {
            today,
            upcoming,
            past,
            all: reservations.length,
        };
    }, [reservations, todayStr, getReservationDateOnly]);

    // ── Date-scoped reservations ────────────────────────────
    const dateScopedReservations = useMemo(() => {
        return reservations.filter((r) => {
            const d = getReservationDateOnly(r.reservation_date);
            if (dateFilterMode === "today") return d === todayStr;
            if (dateFilterMode === "current") return !d || d >= todayStr;
            if (dateFilterMode === "past") return Boolean(d && d < todayStr);
            if (dateFilterMode === "custom" && customDate)
                return d === customDate;
            return true; // "all"
        });
    }, [
        reservations,
        dateFilterMode,
        customDate,
        todayStr,
        getReservationDateOnly,
    ]);

    // ── Status counts for the active date scope ─────────────
    const statusCounts = useMemo(() => {
        return {
            all: dateScopedReservations.length,
            confirmed: dateScopedReservations.filter(
                (r) => r.status === "confirmed",
            ).length,
            seated: dateScopedReservations.filter((r) => r.status === "seated")
                .length,
            pending: dateScopedReservations.filter(
                (r) => r.status === "pending",
            ).length,
            completed: dateScopedReservations.filter(
                (r) => r.status === "completed",
            ).length,
            cancelled: dateScopedReservations.filter((r) =>
                ["cancelled", "no_show"].includes(r.status),
            ).length,
        };
    }, [dateScopedReservations]);

    const filtered = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return dateScopedReservations
            .filter((r) => {
                const matchSearch =
                    !q ||
                    r.customer_name.toLowerCase().includes(q) ||
                    (r.customer_phone || "").includes(q) ||
                    (r.customer_email || "").toLowerCase().includes(q) ||
                    (r.table_number || "").toLowerCase().includes(q);

                const matchStatus =
                    statusFilter === "all"
                        ? true
                        : statusFilter === "cancelled"
                          ? ["cancelled", "no_show"].includes(r.status)
                          : r.status === statusFilter;

                return matchSearch && matchStatus;
            })
            .sort((a, b) => {
                const da = getReservationDateOnly(a.reservation_date);
                const db = getReservationDateOnly(b.reservation_date);
                const ta = a.start_time || "";
                const tb = b.start_time || "";
                if (dateFilterMode === "past") {
                    // Show most recent past reservation first
                    if (da !== db) return db.localeCompare(da);
                    return tb.localeCompare(ta);
                }
                // Show earliest upcoming reservation first
                if (da !== db) return da.localeCompare(db);
                return ta.localeCompare(tb);
            });
    }, [
        dateScopedReservations,
        searchTerm,
        statusFilter,
        dateFilterMode,
        getReservationDateOnly,
    ]);

    const floorById = useMemo(() => {
        const map = new Map<string, FloorTableState>();
        for (const t of floorTables) map.set(t.id, t);
        return map;
    }, [floorTables]);

    const displayTables = useMemo(() => {
        const catalogIds = new Set(tables.map((t) => t.id));
        const extras = floorTables.filter(
            (t) => !catalogIds.has(t.id) && t.occupied,
        );
        return [...tables, ...extras];
    }, [tables, floorTables]);

    const activeTables = tables.filter((t) => t.is_active);
    const totalCapacity = activeTables.reduce((s, t) => s + t.capacity, 0);
    const todayRes = useMemo(() => {
        return reservations.filter(
            (r) =>
                ["confirmed", "pending", "seated"].includes(r.status) &&
                (!r.reservation_date ||
                    r.reservation_date.startsWith(todayStr)),
        ).length;
    }, [reservations, todayStr]);

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-border/40">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">
                            Front Desk & Floor Operations
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">
                            {activeRestaurant?.name || "Restaurant"}
                        </span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
                        <CalendarDays className="h-7 w-7 text-primary" />
                        Table Reservations
                    </h1>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                        Manage live guest bookings, arrivals, table allocation,
                        and dining status.
                    </p>
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                    <Button
                        id="btn-add-reservation"
                        onClick={openAddReservation}
                        className="gradient-primary text-primary-foreground font-semibold shadow-md gap-2 h-10 px-5 rounded-xl flex-1 sm:flex-initial"
                    >
                        <Plus className="h-4 w-4" /> New Reservation
                    </Button>
                </div>
            </div>

            {/* KPI Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    {
                        label: "Today's Bookings",
                        value: todayRes,
                        desc: `${statusCounts.confirmed} confirmed · ${statusCounts.seated} seated`,
                        icon: CalendarDays,
                        color: "text-emerald-600 dark:text-emerald-400",
                        bg: "bg-emerald-500/10 border-emerald-500/20",
                    },
                    {
                        label: "Awaiting Arrival",
                        value: statusCounts.confirmed,
                        desc: "Ready for check-in",
                        icon: Clock,
                        color: "text-amber-600 dark:text-amber-400",
                        bg: "bg-amber-500/10 border-amber-500/20",
                    },
                    {
                        label: "Currently Seated",
                        value: statusCounts.seated,
                        desc: "Guests dining right now",
                        icon: UtensilsCrossed,
                        color: "text-blue-600 dark:text-blue-400",
                        bg: "bg-blue-500/10 border-blue-500/20",
                    },
                    {
                        label: "Floor Capacity",
                        value: `${activeTables.length} Tables`,
                        desc: `${totalCapacity} seats total capacity`,
                        icon: TableProperties,
                        color: "text-violet-600 dark:text-violet-400",
                        bg: "bg-violet-500/10 border-violet-500/20",
                    },
                ].map((s) => (
                    <div
                        key={s.label}
                        className="bg-card border border-border/70 rounded-2xl p-4 sm:p-5 shadow-2xs hover:shadow-xs transition-all flex items-center justify-between gap-3"
                    >
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                {s.label}
                            </p>
                            <p className="text-2xl font-black text-foreground mt-1 tracking-tight">
                                {s.value}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {s.desc}
                            </p>
                        </div>
                        <div
                            className={cn(
                                "w-11 h-11 rounded-2xl flex items-center justify-center border shrink-0",
                                s.bg,
                            )}
                        >
                            <s.icon className={cn("h-5 w-5", s.color)} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Main Tabs */}
            <Tabs
                value={mainTab}
                onValueChange={(v) => {
                    const next = new URLSearchParams(searchParams);
                    if (v === "tables") next.set("tab", "tables");
                    else next.delete("tab");
                    setSearchParams(next, { replace: true });
                }}
                className="space-y-4"
            >
                <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-1">
                    <TabsList className="bg-muted/60 p-1 rounded-xl">
                        <TabsTrigger
                            value="reservations"
                            id="tab-reservations"
                            className="rounded-lg text-xs font-semibold px-4 py-2 gap-2"
                        >
                            <CalendarDays className="h-4 w-4" /> Bookings (
                            {reservations.length})
                        </TabsTrigger>
                        <TabsTrigger
                            value="tables"
                            id="tab-tables"
                            className="rounded-lg text-xs font-semibold px-4 py-2 gap-2"
                        >
                            <TableProperties className="h-4 w-4" /> Tables &
                            Floor ({tables.length})
                        </TabsTrigger>
                    </TabsList>
                </div>

                {/* ─── RESERVATIONS TAB ─────────────────────── */}
                <TabsContent value="reservations" className="space-y-4 pt-1">
                    {/* ─── Unified Modern Control & Filter Bar ─── */}
                    <div className="bg-card border border-border/80 rounded-2xl p-4 sm:p-4.5 shadow-2xs space-y-3.5">
                        {/* Top Row: Date Scope Segmented Bar + View Switcher + Search & Refresh */}
                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                            {/* Left: Date Scope Filter Controls */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 xl:pb-0 scrollbar-none flex-nowrap shrink-0">
                                {/* Segmented Control */}
                                <div className="inline-flex flex-nowrap items-center p-1 bg-muted/60 dark:bg-muted/30 rounded-xl border border-border/60 shadow-2xs shrink-0 gap-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDateFilterMode("current");
                                            setCustomDate("");
                                        }}
                                        className={cn(
                                            "h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0",
                                            dateFilterMode === "current"
                                                ? "bg-background text-foreground shadow-xs font-bold border border-border/70"
                                                : "text-muted-foreground hover:text-foreground hover:bg-background/40",
                                        )}
                                    >
                                        <CalendarDays className="h-3.5 w-3.5 text-primary" />
                                        <span>Today & Upcoming</span>
                                        <span
                                            className={cn(
                                                "px-2 py-0.5 rounded-full text-[10px] font-bold leading-none tracking-tight",
                                                dateFilterMode === "current"
                                                    ? "bg-primary/15 text-primary"
                                                    : "bg-background/80 dark:bg-muted/80 text-muted-foreground border border-border/40",
                                            )}
                                        >
                                            {dateCounts.upcoming}
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDateFilterMode("today");
                                            setCustomDate("");
                                        }}
                                        className={cn(
                                            "h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0",
                                            dateFilterMode === "today"
                                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shadow-xs font-bold border border-emerald-500/30"
                                                : "text-muted-foreground hover:text-foreground hover:bg-background/40",
                                        )}
                                    >
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                        </span>
                                        <span>Today</span>
                                        <span
                                            className={cn(
                                                "px-2 py-0.5 rounded-full text-[10px] font-bold leading-none tracking-tight",
                                                dateFilterMode === "today"
                                                    ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-black"
                                                    : "bg-background/80 dark:bg-muted/80 text-muted-foreground border border-border/40",
                                            )}
                                        >
                                            {dateCounts.today}
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDateFilterMode("past");
                                            setCustomDate("");
                                        }}
                                        className={cn(
                                            "h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0",
                                            dateFilterMode === "past"
                                                ? "bg-amber-500/10 text-amber-800 dark:text-amber-300 shadow-xs font-bold border border-amber-500/30"
                                                : "text-muted-foreground hover:text-foreground hover:bg-background/40",
                                        )}
                                    >
                                        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                        <span>Past</span>
                                        <span
                                            className={cn(
                                                "px-2 py-0.5 rounded-full text-[10px] font-bold leading-none tracking-tight",
                                                dateFilterMode === "past"
                                                    ? "bg-amber-500/25 text-amber-900 dark:text-amber-200 font-black"
                                                    : "bg-background/80 dark:bg-muted/80 text-muted-foreground border border-border/40",
                                            )}
                                        >
                                            {dateCounts.past}
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDateFilterMode("all");
                                            setCustomDate("");
                                        }}
                                        className={cn(
                                            "h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0",
                                            dateFilterMode === "all"
                                                ? "bg-background text-foreground shadow-xs font-bold border border-border/70"
                                                : "text-muted-foreground hover:text-foreground hover:bg-background/40",
                                        )}
                                    >
                                        <span>All</span>
                                        <span
                                            className={cn(
                                                "px-2 py-0.5 rounded-full text-[10px] font-bold leading-none tracking-tight",
                                                dateFilterMode === "all"
                                                    ? "bg-primary/15 text-primary"
                                                    : "bg-background/80 dark:bg-muted/80 text-muted-foreground border border-border/40",
                                            )}
                                        >
                                            {dateCounts.all}
                                        </span>
                                    </button>
                                </div>

                                {/* Specific Date Picker */}
                                <div
                                    className={cn(
                                        "inline-flex items-center gap-1.5 px-3 h-8 rounded-xl border text-xs transition-all shrink-0 font-medium",
                                        dateFilterMode === "custom" &&
                                            customDate
                                            ? "bg-primary/10 border-primary/40 text-primary shadow-xs font-bold"
                                            : "bg-muted/40 hover:bg-muted/70 border-border/60 text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    <CalendarDays
                                        className={cn(
                                            "h-3.5 w-3.5 shrink-0",
                                            dateFilterMode === "custom" &&
                                                customDate
                                                ? "text-primary"
                                                : "text-muted-foreground",
                                        )}
                                    />
                                    <input
                                        type="date"
                                        value={customDate}
                                        onChange={(e) => {
                                            setCustomDate(e.target.value);
                                            if (e.target.value)
                                                setDateFilterMode("custom");
                                        }}
                                        className="bg-transparent text-xs text-foreground font-medium focus:outline-none cursor-pointer"
                                        title="Filter by specific date"
                                    />
                                    {customDate && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCustomDate("");
                                                setDateFilterMode("current");
                                            }}
                                            className="text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10 p-0.5 rounded-full transition-colors ml-1"
                                            title="Clear date"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Right: Search, Refresh & View Mode Switcher */}
                            <div className="flex items-center gap-2 w-full xl:w-auto">
                                <div className="relative flex-1 xl:w-64">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                        placeholder="Search guest, phone, table..."
                                        className="pl-8 pr-7 h-8.5 text-xs rounded-xl bg-background border-border/70 focus-visible:ring-primary/20 shadow-2xs"
                                        value={searchTerm}
                                        onChange={(e) =>
                                            setSearchTerm(e.target.value)
                                        }
                                    />
                                    {searchTerm && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchTerm("")}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>

                                {/* View Mode Switcher */}
                                <div className="inline-flex items-center p-0.5 bg-muted/50 dark:bg-muted/30 rounded-xl border border-border/60 shrink-0 gap-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setViewMode("table")}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 h-7.5 rounded-lg text-xs font-semibold transition-all",
                                            viewMode === "table"
                                                ? "bg-background text-foreground shadow-xs font-bold border border-border/70"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                        title="Table View"
                                    >
                                        <TableProperties className="h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">
                                            Table
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setViewMode("cards")}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 h-7.5 rounded-lg text-xs font-semibold transition-all",
                                            viewMode === "cards"
                                                ? "bg-background text-foreground shadow-xs font-bold border border-border/70"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                        title="Cards View"
                                    >
                                        <LayoutGrid className="h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">
                                            Cards
                                        </span>
                                    </button>
                                </div>

                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8.5 w-8.5 rounded-xl shrink-0 border-border/70 hover:bg-muted shadow-2xs"
                                    onClick={loadReservations}
                                    title="Refresh reservations"
                                >
                                    <RefreshCw
                                        className={cn(
                                            "h-3.5 w-3.5",
                                            loading && "animate-spin",
                                        )}
                                    />
                                </Button>
                            </div>
                        </div>

                        {/* Bottom Row: Status Filter Tabs Strip */}
                        <div className="pt-2.5 border-t border-border/50 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none w-full sm:w-auto">
                                {[
                                    {
                                        id: "all",
                                        label: "All Bookings",
                                        count: statusCounts.all,
                                        dot: null,
                                    },
                                    {
                                        id: "confirmed",
                                        label: "Confirmed",
                                        count: statusCounts.confirmed,
                                        dot: "bg-emerald-500",
                                    },
                                    {
                                        id: "seated",
                                        label: "Arrived & Seated",
                                        count: statusCounts.seated,
                                        dot: "bg-blue-500",
                                    },
                                    {
                                        id: "pending",
                                        label: "Pending",
                                        count: statusCounts.pending,
                                        dot: "bg-amber-500",
                                    },
                                    {
                                        id: "completed",
                                        label: "Completed",
                                        count: statusCounts.completed,
                                        dot: "bg-slate-400",
                                    },
                                    {
                                        id: "cancelled",
                                        label: "Cancelled / No-Show",
                                        count: statusCounts.cancelled,
                                        dot: "bg-rose-500",
                                    },
                                ].map((tab) => {
                                    const isActive = statusFilter === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() =>
                                                setStatusFilter(tab.id)
                                            }
                                            className={cn(
                                                "flex items-center gap-1.5 px-2.5 h-7.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0",
                                                isActive
                                                    ? "bg-primary text-primary-foreground shadow-xs font-bold"
                                                    : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70 border border-border/40",
                                            )}
                                        >
                                            {tab.dot && (
                                                <span
                                                    className={cn(
                                                        "w-1.5 h-1.5 rounded-full shrink-0",
                                                        tab.dot,
                                                        isActive &&
                                                            "ring-2 ring-white/50",
                                                    )}
                                                />
                                            )}
                                            <span>{tab.label}</span>
                                            <span
                                                className={cn(
                                                    "px-1.5 py-0.2 rounded-full text-[10px] font-bold leading-none",
                                                    isActive
                                                        ? "bg-primary-foreground/20 text-primary-foreground"
                                                        : "bg-background/80 dark:bg-muted/80 text-muted-foreground border border-border/40",
                                                )}
                                            >
                                                {tab.count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Status summary pill */}
                            <div className="text-xs text-muted-foreground font-medium hidden sm:block">
                                Showing{" "}
                                <span className="font-bold text-foreground">
                                    {filtered.length}
                                </span>{" "}
                                {filtered.length === 1 ? "booking" : "bookings"}
                            </div>
                        </div>
                    </div>

                    {/* Active Filter Scope Callout Banner */}
                    {dateFilterMode === "past" && (
                        <div className="flex items-center justify-between gap-3 p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-xs text-amber-800 dark:text-amber-300">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span className="truncate">
                                    Showing{" "}
                                    <strong>past reservations</strong> (
                                    {filtered.length}) whose scheduled date has
                                    already passed.
                                </span>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setDateFilterMode("current");
                                    setCustomDate("");
                                }}
                                className="text-xs h-7 px-2.5 font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-500/20 shrink-0"
                            >
                                Back to Today & Upcoming
                            </Button>
                        </div>
                    )}

                    {dateFilterMode === "custom" && customDate && (
                        <div className="flex items-center justify-between gap-3 p-3.5 bg-primary/10 border border-primary/25 rounded-2xl text-xs text-primary">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <CalendarDays className="h-4 w-4 shrink-0" />
                                <span className="truncate">
                                    Filtered by specific date:{" "}
                                    <strong>{customDate}</strong> (
                                    {filtered.length}{" "}
                                    {filtered.length === 1
                                        ? "booking"
                                        : "bookings"}
                                    ).
                                </span>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setCustomDate("");
                                    setDateFilterMode("current");
                                }}
                                className="text-xs h-7 px-2.5 font-semibold hover:bg-primary/20 shrink-0"
                            >
                                Clear Date Filter
                            </Button>
                        </div>
                    )}

                    {/* Reservation List: Table View or Cards Grid */}
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                            <RefreshCw className="h-5 w-5 animate-spin" />{" "}
                            Loading…
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center bg-card border border-border/70 rounded-2xl p-8 space-y-3">
                            <div className="w-12 h-12 rounded-2xl bg-muted/80 flex items-center justify-center">
                                <CalendarDays className="h-6 w-6 text-muted-foreground/60" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-base font-bold text-foreground">
                                    {dateFilterMode === "current"
                                        ? "No upcoming or today's reservations"
                                        : dateFilterMode === "today"
                                          ? "No reservations scheduled for today"
                                          : dateFilterMode === "past"
                                            ? "No past reservations found"
                                            : "No reservations found"}
                                </p>
                                <p className="text-xs text-muted-foreground max-w-md">
                                    {dateFilterMode === "current" &&
                                    dateCounts.past > 0
                                        ? `You have ${dateCounts.past} past reservation${dateCounts.past > 1 ? "s" : ""} recorded in history from earlier dates.`
                                        : searchTerm
                                          ? `No bookings match your search "${searchTerm}". Try adjusting your keywords.`
                                          : "Try selecting a different date range or add a new table reservation."}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 pt-2 flex-wrap justify-center">
                                {dateFilterMode !== "past" &&
                                    dateCounts.past > 0 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setDateFilterMode("past");
                                                setCustomDate("");
                                            }}
                                            className="text-xs h-8 gap-1.5 rounded-xl border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                        >
                                            <Clock className="h-3.5 w-3.5" />
                                            View Past Reservations (
                                            {dateCounts.past})
                                        </Button>
                                    )}
                                {dateFilterMode !== "current" && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setDateFilterMode("current");
                                            setCustomDate("");
                                        }}
                                        className="text-xs h-8 rounded-xl"
                                    >
                                        Today & Upcoming ({dateCounts.upcoming})
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    onClick={openAddReservation}
                                    className="text-xs h-8 gap-1.5 rounded-xl gradient-primary text-primary-foreground"
                                >
                                    <Plus className="h-3.5 w-3.5" /> New
                                    Reservation
                                </Button>
                            </div>
                        </div>
                    ) : viewMode === "table" ? (
                        <div className="bg-card border border-border/80 rounded-2xl shadow-2xs overflow-hidden">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-muted/40 border-b border-border/70">
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="py-3.5 pl-4 sm:pl-5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Customer / Guest
                                            </TableHead>
                                            <TableHead className="py-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Contact
                                            </TableHead>
                                            <TableHead className="py-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Date & Schedule
                                            </TableHead>
                                            <TableHead className="py-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Party
                                            </TableHead>
                                            <TableHead className="py-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Assigned Table
                                            </TableHead>
                                            <TableHead className="py-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Status
                                            </TableHead>
                                            <TableHead className="py-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Source
                                            </TableHead>
                                            <TableHead className="py-3.5 pr-4 sm:pr-5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Actions
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody className="divide-y divide-border/40">
                                        {filtered.map((res) => (
                                            <TableRow
                                                key={res.id}
                                                className="hover:bg-muted/40 transition-colors group cursor-pointer"
                                                onClick={(e) => {
                                                    const target =
                                                        e.target as HTMLElement;
                                                    if (
                                                        target.closest(
                                                            "button",
                                                        ) ||
                                                        target.closest("a")
                                                    )
                                                        return;
                                                    openDetailReservation(res);
                                                }}
                                            >
                                                {/* Customer / Guest */}
                                                <TableCell className="py-3.5 pl-4 sm:pl-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 border border-primary/25 flex items-center justify-center font-bold text-xs text-primary shadow-2xs shrink-0 tracking-wider">
                                                            {getInitials(
                                                                res.customer_name,
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 max-w-[200px]">
                                                            <p className="font-bold text-sm text-foreground truncate group-hover:text-primary transition-colors leading-tight">
                                                                {
                                                                    res.customer_name
                                                                }
                                                            </p>
                                                            {(() => {
                                                                const note =
                                                                    getDisplayNotes(
                                                                        res.notes,
                                                                    );
                                                                if (!note)
                                                                    return null;
                                                                return (
                                                                    <p
                                                                        className="text-[11px] text-muted-foreground italic truncate flex items-center gap-1 mt-0.5"
                                                                        title={
                                                                            note
                                                                        }
                                                                    >
                                                                        <MessageSquare className="h-2.5 w-2.5 shrink-0 text-primary/70" />
                                                                        <span className="truncate">
                                                                            "
                                                                            {
                                                                                note
                                                                            }
                                                                            "
                                                                        </span>
                                                                    </p>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </TableCell>

                                                {/* Contact */}
                                                <TableCell className="py-3.5 text-xs">
                                                    <div className="space-y-0.5">
                                                        {res.customer_phone ? (
                                                            <a
                                                                href={`tel:${res.customer_phone}`}
                                                                className="inline-flex items-center gap-1.5 text-foreground hover:text-primary transition-colors font-medium truncate max-w-[160px]"
                                                                onClick={(e) =>
                                                                    e.stopPropagation()
                                                                }
                                                            >
                                                                <Phone className="h-3 w-3 shrink-0 text-primary/70" />
                                                                <span className="truncate">
                                                                    {
                                                                        res.customer_phone
                                                                    }
                                                                </span>
                                                            </a>
                                                        ) : (
                                                            <span className="text-muted-foreground/60 italic text-[11px]">
                                                                No phone
                                                            </span>
                                                        )}
                                                        {res.customer_email && (
                                                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate max-w-[160px]">
                                                                <Mail className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                                                                <span className="truncate">
                                                                    {
                                                                        res.customer_email
                                                                    }
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>

                                                {/* Date & Schedule */}
                                                <TableCell className="py-3.5 text-xs whitespace-nowrap">
                                                    <div className="space-y-0.5">
                                                        <div className="flex items-center gap-1.5 font-bold text-foreground">
                                                            <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
                                                            <span>
                                                                {formatSafeDate(
                                                                    res.reservation_date,
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                                                            <Clock className="h-3 w-3 shrink-0" />
                                                            <span>
                                                                {res.start_time.slice(
                                                                    0,
                                                                    5,
                                                                )}{" "}
                                                                ·{" "}
                                                                {
                                                                    res.slot_duration_hours
                                                                }
                                                                h duration
                                                            </span>
                                                        </div>
                                                    </div>
                                                </TableCell>

                                                {/* Party Size */}
                                                <TableCell className="py-3.5 text-xs whitespace-nowrap">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 border border-border/60 font-semibold text-foreground">
                                                        <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                                                        <span>
                                                            {res.party_size}{" "}
                                                            {res.party_size > 1
                                                                ? "Guests"
                                                                : "Guest"}
                                                        </span>
                                                    </span>
                                                </TableCell>

                                                {/* Table Assignment */}
                                                <TableCell className="py-3.5 text-xs whitespace-nowrap">
                                                    {res.table_number ? (
                                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-300 font-bold">
                                                            <TableProperties className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                                            <span>
                                                                {displayTableNumber(
                                                                    res.table_number,
                                                                )}
                                                            </span>
                                                            {res.table_location && (
                                                                <span className="text-[10px] font-normal opacity-75">
                                                                    ·{" "}
                                                                    {
                                                                        res.table_location
                                                                    }
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="h-7 text-[11px] px-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/30 font-semibold gap-1 rounded-lg shadow-2xs"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openEditReservation(
                                                                    res,
                                                                );
                                                            }}
                                                        >
                                                            <AlertCircle className="h-3 w-3 text-amber-600" />
                                                            <span>
                                                                Assign Table
                                                            </span>
                                                        </Button>
                                                    )}
                                                </TableCell>

                                                {/* Status */}
                                                <TableCell className="py-3.5 text-xs whitespace-nowrap">
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-xs px-2.5 py-0.5 font-semibold border gap-1.5 shadow-2xs ${STATUS_COLORS[res.status] || ""}`}
                                                    >
                                                        <span
                                                            className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_COLORS[res.status] || "bg-muted-foreground"} ${
                                                                res.status ===
                                                                "confirmed"
                                                                    ? "animate-pulse"
                                                                    : ""
                                                            }`}
                                                        />
                                                        {STATUS_LABELS[
                                                            res.status
                                                        ] || res.status}
                                                    </Badge>
                                                </TableCell>

                                                {/* Source */}
                                                <TableCell className="py-3.5 text-xs whitespace-nowrap">
                                                    {res.source === "phone" ? (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[10px] gap-1 px-2 py-0.5 font-medium text-violet-600 dark:text-violet-400 border-violet-500/25 bg-violet-500/10"
                                                        >
                                                            <PhoneCall className="h-2.5 w-2.5" />{" "}
                                                            Voice AI
                                                        </Badge>
                                                    ) : (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[10px] px-2 py-0.5 font-medium text-sky-600 dark:text-sky-400 border-sky-500/25 bg-sky-500/10"
                                                        >
                                                            Online
                                                        </Badge>
                                                    )}
                                                </TableCell>

                                                {/* Actions */}
                                                <TableCell
                                                    className="py-3.5 pr-4 sm:pr-5 text-right whitespace-nowrap"
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                >
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        {res.status ===
                                                            "confirmed" && (
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs hover:shadow-md transition-all"
                                                                onClick={() =>
                                                                    handleCustomerArrived(
                                                                        res,
                                                                    )
                                                                }
                                                            >
                                                                <UserCheck className="h-3.5 w-3.5" />
                                                                <span>
                                                                    Seat Guest
                                                                </span>
                                                            </Button>
                                                        )}
                                                        {res.status ===
                                                            "pending" && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 text-xs font-semibold gap-1 border-emerald-600/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-xl"
                                                                onClick={() =>
                                                                    quickStatus(
                                                                        res.id,
                                                                        "confirmed",
                                                                    )
                                                                }
                                                            >
                                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                                                <span>
                                                                    Confirm
                                                                </span>
                                                            </Button>
                                                        )}
                                                        {res.status ===
                                                            "seated" && (
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-xs font-semibold gap-1 bg-slate-900 hover:bg-black text-white dark:bg-slate-100 dark:text-slate-900 rounded-xl shadow-xs"
                                                                onClick={() =>
                                                                    quickStatus(
                                                                        res.id,
                                                                        "completed",
                                                                    )
                                                                }
                                                            >
                                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                                                <span>
                                                                    Complete
                                                                </span>
                                                            </Button>
                                                        )}

                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
                                                            onClick={() =>
                                                                openDetailReservation(
                                                                    res,
                                                                )
                                                            }
                                                            title="View full booking details"
                                                        >
                                                            <Eye className="h-3.5 w-3.5" />
                                                        </Button>

                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger
                                                                asChild
                                                            >
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
                                                                >
                                                                    <MoreHorizontal className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent
                                                                align="end"
                                                                className="w-44 rounded-xl shadow-md"
                                                            >
                                                                <DropdownMenuItem
                                                                    onClick={() =>
                                                                        openDetailReservation(
                                                                            res,
                                                                        )
                                                                    }
                                                                    className="gap-2 text-xs"
                                                                >
                                                                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                                                    <span>
                                                                        View
                                                                        Details
                                                                    </span>
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    onClick={() =>
                                                                        openEditReservation(
                                                                            res,
                                                                        )
                                                                    }
                                                                    className="gap-2 text-xs"
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                                                    <span>
                                                                        Edit
                                                                        Booking
                                                                    </span>
                                                                </DropdownMenuItem>
                                                                {[
                                                                    "pending",
                                                                    "confirmed",
                                                                ].includes(
                                                                    res.status,
                                                                ) && (
                                                                    <DropdownMenuItem
                                                                        onClick={() =>
                                                                            quickStatus(
                                                                                res.id,
                                                                                "no_show",
                                                                            )
                                                                        }
                                                                        className="gap-2 text-xs text-amber-700 dark:text-amber-400"
                                                                    >
                                                                        <XCircle className="h-3.5 w-3.5" />
                                                                        <span>
                                                                            Mark
                                                                            as
                                                                            No-Show
                                                                        </span>
                                                                    </DropdownMenuItem>
                                                                )}
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    onClick={() =>
                                                                        setDeleteReservationId(
                                                                            res.id,
                                                                        )
                                                                    }
                                                                    className="gap-2 text-xs text-destructive focus:text-destructive"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                    <span>
                                                                        Delete
                                                                        Booking
                                                                    </span>
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {filtered.map((res) => (
                                <div
                                    key={res.id}
                                    className={`bg-card border border-border/70 hover:border-primary/50 rounded-2xl p-5 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.05)] hover:shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between gap-3.5 group overflow-hidden relative ${STATUS_CARD_ACCENTS[res.status] || ""}`}
                                >
                                    {/* Top: Customer Avatar, Name, Phone & Status Badge */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 border border-primary/25 flex items-center justify-center font-bold text-sm text-primary shadow-xs shrink-0 tracking-wider">
                                                {getInitials(res.customer_name)}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-foreground text-[15px] truncate leading-tight">
                                                    {res.customer_name}
                                                </p>
                                                {res.customer_phone ? (
                                                    <a
                                                        href={`tel:${res.customer_phone}`}
                                                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors font-medium mt-1"
                                                    >
                                                        <Phone className="h-3 w-3 shrink-0 text-primary/70" />
                                                        <span className="truncate">
                                                            {res.customer_phone}
                                                        </span>
                                                    </a>
                                                ) : (
                                                    <p className="text-xs text-muted-foreground/60 italic mt-1">
                                                        No phone
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                                            <Badge
                                                variant="outline"
                                                className={`text-xs px-2.5 py-0.5 font-semibold border gap-1.5 shadow-2xs ${STATUS_COLORS[res.status] || ""}`}
                                            >
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_COLORS[res.status] || "bg-muted-foreground"} ${res.status === "confirmed" ? "animate-pulse" : ""}`}
                                                />
                                                {STATUS_LABELS[res.status] ||
                                                    res.status}
                                            </Badge>
                                            {res.source === "phone" ? (
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] gap-1 px-1.5 py-0 font-medium text-violet-600 dark:text-violet-400 border-violet-500/25 bg-violet-500/10"
                                                >
                                                    <PhoneCall className="h-2.5 w-2.5" />{" "}
                                                    Voice AI
                                                </Badge>
                                            ) : (
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] px-1.5 py-0 font-medium text-sky-600 dark:text-sky-400 border-sky-500/25 bg-sky-500/10"
                                                >
                                                    Online
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    {/* Middle: Schedule & Table details */}
                                    <div className="space-y-2.5">
                                        {/* Booking Date Indicator (when viewing all dates or search) */}
                                        {(dateFilterMode === "all" ||
                                            searchTerm.trim() !== "") && (
                                            <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[11px] font-semibold">
                                                <span className="flex items-center gap-1.5">
                                                    <CalendarDays className="h-3.5 w-3.5" />{" "}
                                                    Booking Date:
                                                </span>
                                                <span>
                                                    {formatSafeDate(
                                                        res.reservation_date,
                                                    )}
                                                </span>
                                            </div>
                                        )}

                                        {/* Schedule & Guest Ribbon */}
                                        <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-muted/40 border border-border/50 text-xs">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="w-7 h-7 rounded-lg bg-background border border-border/60 flex items-center justify-center text-primary shrink-0 shadow-2xs">
                                                    <Clock className="h-3.5 w-3.5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-foreground truncate text-xs">
                                                        {res.start_time.slice(
                                                            0,
                                                            5,
                                                        )}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground truncate">
                                                        {
                                                            res.slot_duration_hours
                                                        }
                                                        h duration
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 min-w-0 border-l border-border/40 pl-2">
                                                <div className="w-7 h-7 rounded-lg bg-background border border-border/60 flex items-center justify-center text-primary shrink-0 shadow-2xs">
                                                    <Users className="h-3.5 w-3.5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-foreground truncate text-xs">
                                                        {res.party_size}{" "}
                                                        {res.party_size > 1
                                                            ? "Guests"
                                                            : "Guest"}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground truncate">
                                                        Party size
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Table Assignment Box */}
                                        {res.table_number ? (
                                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 text-xs">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0">
                                                        <TableProperties className="h-3.5 w-3.5" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-emerald-950 dark:text-emerald-100 truncate text-xs">
                                                            {displayTableNumber(
                                                                res.table_number,
                                                            )}
                                                        </p>
                                                        <p className="text-[10px] text-emerald-700 dark:text-emerald-300 truncate">
                                                            {res.table_location ||
                                                                "Standard Area"}{" "}
                                                            · Max{" "}
                                                            {res.table_capacity ||
                                                                4}{" "}
                                                            seats
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border border-emerald-500/30 shrink-0">
                                                    Assigned
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs">
                                                <div className="flex items-center gap-2 min-w-0 text-amber-800 dark:text-amber-200">
                                                    <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-700 dark:text-amber-300 shrink-0">
                                                        <AlertCircle className="h-3.5 w-3.5" />
                                                    </div>
                                                    <span className="font-medium truncate text-xs">
                                                        No table assigned
                                                    </span>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-6.5 text-[11px] px-2.5 bg-background hover:bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/40 font-semibold shrink-0 shadow-2xs"
                                                    onClick={() =>
                                                        openEditReservation(res)
                                                    }
                                                >
                                                    Assign Table →
                                                </Button>
                                            </div>
                                        )}

                                        {/* Customer special requests if any */}
                                        {(() => {
                                            const note = getDisplayNotes(
                                                res.notes,
                                            );
                                            if (!note) return null;
                                            return (
                                                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/40 text-xs text-muted-foreground">
                                                    <MessageSquare className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                                    <span className="italic leading-relaxed truncate">
                                                        "{note}"
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {/* Actions Footer */}
                                    <div className="pt-3 border-t border-border/50 flex flex-col gap-2">
                                        {/* Primary Operational Action */}
                                        {res.status === "confirmed" && (
                                            <Button
                                                size="sm"
                                                className="w-full h-9 text-xs font-semibold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs hover:shadow-md hover:brightness-105 active:scale-[0.99] transition-all"
                                                onClick={() =>
                                                    handleCustomerArrived(res)
                                                }
                                            >
                                                <UserCheck className="h-4 w-4" />
                                                {res.table_number
                                                    ? `✓ Customer Arrived · Seat at ${displayTableNumber(res.table_number)}`
                                                    : "✓ Customer Arrived (Assign & Seat)"}
                                            </Button>
                                        )}
                                        {res.status === "pending" && (
                                            <div className="grid grid-cols-2 gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-9 text-xs font-semibold gap-1.5 border-emerald-600/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-xl"
                                                    onClick={() =>
                                                        quickStatus(
                                                            res.id,
                                                            "confirmed",
                                                        )
                                                    }
                                                >
                                                    <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                                                    Confirm
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    className="h-9 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs hover:shadow-md"
                                                    onClick={() =>
                                                        handleCustomerArrived(
                                                            res,
                                                        )
                                                    }
                                                >
                                                    <UserCheck className="h-3.5 w-3.5" />{" "}
                                                    Arrived & Seat
                                                </Button>
                                            </div>
                                        )}
                                        {res.status === "seated" && (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                                                    <span className="flex items-center gap-1.5">
                                                        <UtensilsCrossed className="h-3.5 w-3.5 text-blue-500" />{" "}
                                                        Customer Arrived &
                                                        Seated
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/40 text-[10px] font-bold"
                                                    >
                                                        {displayTableNumber(
                                                            res.table_number,
                                                        )}
                                                    </Badge>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    className="w-full h-8 text-xs font-semibold gap-1.5 bg-slate-900 hover:bg-black text-white dark:bg-slate-100 dark:text-slate-900 rounded-xl shadow-xs hover:shadow-md active:scale-[0.99] transition-all"
                                                    onClick={() =>
                                                        quickStatus(
                                                            res.id,
                                                            "completed",
                                                        )
                                                    }
                                                >
                                                    <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                                                    Complete Dining (Free Table)
                                                </Button>
                                            </div>
                                        )}

                                        {/* Secondary Controls Toolbar */}
                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 flex-1 text-xs gap-1.5 rounded-xl bg-background hover:bg-muted font-medium text-foreground border-border/70 shadow-2xs transition-colors"
                                                onClick={() =>
                                                    openDetailReservation(res)
                                                }
                                                title="View full booking details"
                                            >
                                                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span>Details</span>
                                            </Button>

                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 px-3 text-xs gap-1.5 rounded-xl bg-background hover:bg-muted font-medium text-foreground border-border/70 shadow-2xs transition-colors"
                                                onClick={() =>
                                                    openEditReservation(res)
                                                }
                                                title="Edit reservation"
                                            >
                                                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span>Edit</span>
                                            </Button>

                                            {["pending", "confirmed"].includes(
                                                res.status,
                                            ) && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 px-2.5 text-xs gap-1 rounded-xl text-muted-foreground hover:text-amber-700 hover:bg-amber-500/10 font-medium transition-colors"
                                                    onClick={() =>
                                                        quickStatus(
                                                            res.id,
                                                            "no_show",
                                                        )
                                                    }
                                                    title="Mark as No-Show"
                                                >
                                                    <XCircle className="h-3.5 w-3.5" />
                                                    <span>No-show</span>
                                                </Button>
                                            )}

                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 transition-colors"
                                                onClick={() =>
                                                    setDeleteReservationId(
                                                        res.id,
                                                    )
                                                }
                                                title="Delete reservation"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ─── TABLES TAB ───────────────────────────── */}
                <TabsContent value="tables" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                            {activeTables.length} active tables ·{" "}
                            {totalCapacity} total seats
                        </p>
                        <Button
                            id="btn-add-table"
                            onClick={openAddTable}
                            size="sm"
                            className="gradient-primary gap-1.5"
                        >
                            <Plus className="h-3.5 w-3.5" /> Add Table
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {displayTables.map((t) => {
                            const floor =
                                floorById.get(t.id) || (t as FloorTableState);
                            const bills = floor.sessions || [];
                            const occupied = Boolean(
                                floor.occupied || bills.length,
                            );
                            const guest = bills[0]?.session?.customer_name;
                            const orderCount = bills.reduce(
                                (n, b) =>
                                    n +
                                    (b.orders?.length ||
                                        b.totals?.order_count ||
                                        0),
                                0,
                            );
                            const billTotal = bills.reduce(
                                (n, b) =>
                                    n + Number(b.totals?.total_amount || 0),
                                0,
                            );
                            const isCatalog = tables.some((c) => c.id === t.id);
                            return (
                                <div
                                    key={t.id}
                                    className={`border rounded-xl p-4 shadow-sm transition-all ${
                                        occupied
                                            ? "bg-amber-500/5 border-amber-500/30"
                                            : t.is_active
                                              ? "bg-card border-border"
                                              : "bg-muted/40 border-border/50 opacity-60"
                                    }`}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                <TableProperties className="h-5 w-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-foreground">
                                                    {displayTableNumber(
                                                        t.table_number,
                                                    )}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {t.location ||
                                                        "No location"}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge
                                            variant={
                                                occupied
                                                    ? "outline"
                                                    : t.is_active
                                                      ? "default"
                                                      : "secondary"
                                            }
                                            className={cn(
                                                "text-xs",
                                                occupied &&
                                                    "bg-amber-500/15 text-amber-800 border-amber-500/30",
                                            )}
                                        >
                                            {occupied
                                                ? "Occupied"
                                                : t.is_active
                                                  ? "Active"
                                                  : "Inactive"}
                                        </Badge>
                                    </div>

                                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
                                        <Users className="h-3.5 w-3.5 text-primary/70" />
                                        {t.capacity > 0
                                            ? `Up to ${t.capacity} guests`
                                            : "Walk-in / QR sitting"}
                                    </div>

                                    {occupied && (
                                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 mb-3">
                                            <p className="text-sm font-bold text-foreground">
                                                {guest || "Guest"}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {orderCount} order
                                                {orderCount === 1 ? "" : "s"}
                                                {billTotal
                                                    ? ` · ${formatCurrency(billTotal)}`
                                                    : ""}
                                            </p>
                                        </div>
                                    )}

                                    {t.notes && (
                                        <p className="text-xs text-muted-foreground italic mb-3">
                                            "{t.notes}"
                                        </p>
                                    )}

                                    {isCatalog && (
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="flex-1 h-8 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10 border-primary/30"
                                                onClick={() => setQrTable(t)}
                                            >
                                                <QrCode className="h-3.5 w-3.5" />{" "}
                                                Table QR
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs gap-1"
                                                onClick={() => openEditTable(t)}
                                            >
                                                <Pencil className="h-3 w-3" />{" "}
                                                Edit
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs gap-1 text-destructive hover:text-destructive"
                                                onClick={() =>
                                                    setDeleteTableId(t.id)
                                                }
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {displayTables.length === 0 && (
                            <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                                <TableProperties className="h-10 w-10 text-muted-foreground/30 mb-3" />
                                <p className="text-muted-foreground font-medium">
                                    No tables configured
                                </p>
                                <p className="text-sm text-muted-foreground/60 mt-1">
                                    Add tables so AI can auto-assign
                                    reservations
                                </p>
                            </div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            {/* ─── TABLE DIALOG ─────────────────────────── */}
            <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingTable ? "Edit Table" : "Add New Table"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <Label htmlFor="tbl-number">
                                Table Number / Name *
                            </Label>
                            <Input
                                id="tbl-number"
                                placeholder="e.g. T1, Table 5, Rooftop A"
                                value={tableForm.table_number}
                                onChange={(e) =>
                                    setTableForm((f) => ({
                                        ...f,
                                        table_number: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="tbl-capacity">
                                Capacity (persons) *
                            </Label>
                            <Input
                                id="tbl-capacity"
                                type="number"
                                min={1}
                                max={50}
                                value={tableForm.capacity}
                                onChange={(e) =>
                                    setTableForm((f) => ({
                                        ...f,
                                        capacity: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="tbl-location">
                                Location / Zone
                            </Label>
                            <Input
                                id="tbl-location"
                                placeholder="e.g. Indoor, Outdoor, Rooftop"
                                value={tableForm.location}
                                onChange={(e) =>
                                    setTableForm((f) => ({
                                        ...f,
                                        location: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="tbl-notes">Notes</Label>
                            <Textarea
                                id="tbl-notes"
                                placeholder="Any special info about this table"
                                rows={2}
                                value={tableForm.notes}
                                onChange={(e) =>
                                    setTableForm((f) => ({
                                        ...f,
                                        notes: e.target.value,
                                    }))
                                }
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setTableDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={saveTable}
                            className="gradient-primary"
                        >
                            {editingTable ? "Update" : "Add Table"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── RESERVATION DIALOG ───────────────────── */}
            <Dialog
                open={reservationDialogOpen}
                onOpenChange={setReservationDialogOpen}
            >
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingReservation
                                ? "Edit Reservation"
                                : "New Reservation"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-2">
                        <div className="col-span-2">
                            <Label htmlFor="res-customer">
                                Customer Name *
                            </Label>
                            <Input
                                id="res-customer"
                                placeholder="Full name"
                                value={reservationForm.customer_name}
                                onChange={(e) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        customer_name: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="res-phone">Phone</Label>
                            <Input
                                id="res-phone"
                                placeholder="+1 555 000 0000"
                                value={reservationForm.customer_phone}
                                onChange={(e) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        customer_phone: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="res-email">Email</Label>
                            <Input
                                id="res-email"
                                type="email"
                                placeholder="guest@email.com"
                                value={reservationForm.customer_email}
                                onChange={(e) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        customer_email: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="res-date">Date *</Label>
                            <Input
                                id="res-date"
                                type="date"
                                value={reservationForm.reservation_date}
                                onChange={(e) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        reservation_date: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="res-time">Start Time *</Label>
                            <Input
                                id="res-time"
                                type="time"
                                value={reservationForm.start_time}
                                onChange={(e) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        start_time: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="res-party">Guests *</Label>
                            <Input
                                id="res-party"
                                type="number"
                                min={1}
                                max={50}
                                value={reservationForm.party_size}
                                onChange={(e) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        party_size: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <Label htmlFor="res-slot">Slot Duration</Label>
                            <Select
                                value={reservationForm.slot_duration_hours}
                                onValueChange={(v) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        slot_duration_hours: v,
                                    }))
                                }
                            >
                                <SelectTrigger id="res-slot">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {SLOTS.map((s) => (
                                        <SelectItem key={s} value={s}>
                                            {s} hour{s !== "1" ? "s" : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label htmlFor="res-table">Assign Table</Label>
                            <Select
                                value={reservationForm.table_id || "__none"}
                                onValueChange={(v) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        table_id: v === "__none" ? "" : v,
                                    }))
                                }
                            >
                                <SelectTrigger id="res-table">
                                    <SelectValue placeholder="Auto-assign" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none">
                                        Auto-assign
                                    </SelectItem>
                                    {activeTables.map((t) => (
                                        <SelectItem key={t.id} value={t.id}>
                                            {t.table_number} (seats {t.capacity}
                                            )
                                            {t.location
                                                ? ` · ${t.location}`
                                                : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label htmlFor="res-status">Status</Label>
                            <Select
                                value={reservationForm.status}
                                onValueChange={(v) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        status: v,
                                    }))
                                }
                            >
                                <SelectTrigger id="res-status">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(STATUS_LABELS).map(
                                        ([k, v]) => (
                                            <SelectItem key={k} value={k}>
                                                {v}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="col-span-2">
                            <Label htmlFor="res-notes">Notes</Label>
                            <Textarea
                                id="res-notes"
                                placeholder="Special requests, dietary notes…"
                                rows={2}
                                value={reservationForm.notes}
                                onChange={(e) =>
                                    setReservationForm((f) => ({
                                        ...f,
                                        notes: e.target.value,
                                    }))
                                }
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setReservationDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={saveReservation}
                            className="gradient-primary"
                        >
                            {editingReservation
                                ? "Update Reservation"
                                : "Create Reservation"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── RESERVATION DETAILS DIALOG ───────────── */}
            {/* ─── RESERVATION DETAILS DIALOG ───────────── */}
            <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    {detailReservation && (
                        <div className="space-y-5">
                            <DialogHeader>
                                <div className="flex items-start justify-between gap-3 pt-1">
                                    <div>
                                        <DialogTitle className="text-xl flex items-center gap-2">
                                            <span>Booking Details</span>
                                        </DialogTitle>
                                        <DialogDescription className="text-xs text-muted-foreground mt-1">
                                            ID:{" "}
                                            <span className="font-mono text-[11px]">
                                                {detailReservation.id}
                                            </span>
                                        </DialogDescription>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <Badge
                                            className={`text-xs px-2.5 py-0.5 font-medium border ${STATUS_COLORS[detailReservation.status] || ""}`}
                                        >
                                            {STATUS_LABELS[
                                                detailReservation.status
                                            ] || detailReservation.status}
                                        </Badge>
                                        {detailReservation.source ===
                                        "phone" ? (
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] gap-1 px-1.5 py-0 font-normal text-violet-600 dark:text-violet-400 border-violet-500/20 bg-violet-500/5"
                                            >
                                                <PhoneCall className="h-2.5 w-2.5" />{" "}
                                                Voice AI Booking
                                            </Badge>
                                        ) : (
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] gap-1 px-1.5 py-0 font-normal text-sky-600 dark:text-sky-400 border-sky-500/20 bg-sky-500/5"
                                            >
                                                Online Booking
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </DialogHeader>

                            {/* Customer Info Card */}
                            <div className="bg-muted/40 rounded-xl p-4 border border-border/60 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center font-bold text-base text-primary shadow-sm shrink-0">
                                        {getInitials(
                                            detailReservation.customer_name,
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="font-bold text-base text-foreground truncate">
                                            {detailReservation.customer_name}
                                        </h4>
                                        <p className="text-xs text-muted-foreground">
                                            Guest Contact Information
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/40 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Phone className="h-4 w-4 text-primary shrink-0" />
                                        {detailReservation.customer_phone ? (
                                            <a
                                                href={`tel:${detailReservation.customer_phone}`}
                                                className="text-foreground hover:text-primary transition-colors font-medium"
                                            >
                                                {
                                                    detailReservation.customer_phone
                                                }
                                            </a>
                                        ) : (
                                            <span className="text-muted-foreground italic">
                                                No phone provided
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Mail className="h-4 w-4 text-primary shrink-0" />
                                        {detailReservation.customer_email ? (
                                            <a
                                                href={`mailto:${detailReservation.customer_email}`}
                                                className="text-foreground hover:text-primary transition-colors truncate"
                                            >
                                                {
                                                    detailReservation.customer_email
                                                }
                                            </a>
                                        ) : (
                                            <span className="text-muted-foreground italic">
                                                No email
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Booking Schedule & Party Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="bg-card border border-border/70 rounded-xl p-3 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                        <CalendarDays className="h-3.5 w-3.5 text-primary" />{" "}
                                        Date
                                    </div>
                                    <p className="font-semibold text-sm text-foreground">
                                        {formatSafeDate(
                                            detailReservation.reservation_date,
                                        )}
                                    </p>
                                </div>

                                <div className="bg-card border border-border/70 rounded-xl p-3 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                        <Clock className="h-3.5 w-3.5 text-primary" />{" "}
                                        Time & Duration
                                    </div>
                                    <p className="font-semibold text-sm text-foreground">
                                        {(
                                            detailReservation.start_time ||
                                            "19:00"
                                        ).slice(0, 5)}{" "}
                                        (
                                        {detailReservation.slot_duration_hours ||
                                            1}
                                        h slot)
                                    </p>
                                </div>

                                <div className="bg-card border border-border/70 rounded-xl p-3 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                        <Users className="h-3.5 w-3.5 text-primary" />{" "}
                                        Party Size
                                    </div>
                                    <p className="font-semibold text-sm text-foreground">
                                        {detailReservation.party_size}{" "}
                                        {detailReservation.party_size > 1
                                            ? "Guests"
                                            : "Guest"}
                                    </p>
                                </div>
                            </div>

                            {/* Table Assignment */}
                            <div className="bg-card border border-border/70 rounded-xl p-4 shadow-xs">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        <TableProperties className="h-4 w-4 text-primary" />{" "}
                                        Table Assignment
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs gap-1"
                                        onClick={() => {
                                            setDetailDialogOpen(false);
                                            openEditReservation(
                                                detailReservation,
                                            );
                                        }}
                                    >
                                        <Pencil className="h-3 w-3" /> Change
                                        Table
                                    </Button>
                                </div>

                                {detailReservation.table_number ? (
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
                                        <div>
                                            <p className="font-bold text-emerald-950 dark:text-emerald-100">
                                                {displayTableNumber(
                                                    detailReservation.table_number,
                                                )}
                                            </p>
                                            <p className="text-xs text-emerald-700 dark:text-emerald-300">
                                                {detailReservation.table_location ||
                                                    "Standard Area"}{" "}
                                                · Capacity{" "}
                                                {detailReservation.table_capacity ||
                                                    4}{" "}
                                                guests
                                            </p>
                                        </div>
                                        <Badge
                                            variant="outline"
                                            className="text-xs border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
                                        >
                                            Assigned
                                        </Badge>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-sm text-amber-800 dark:text-amber-200">
                                        <div className="flex items-center gap-2">
                                            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                                            <span>
                                                No table currently assigned to
                                                this reservation
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Notes / Special Requests */}
                            {(() => {
                                const note = getDisplayNotes(
                                    detailReservation.notes,
                                );
                                if (!note) return null;
                                return (
                                    <div className="bg-card border border-border/70 rounded-xl p-4 shadow-xs space-y-1.5">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                            <MessageSquare className="h-3.5 w-3.5 text-primary" />{" "}
                                            Special Requests & Notes
                                        </p>
                                        <p className="text-sm text-foreground italic bg-muted/40 p-3 rounded-lg border border-border/40">
                                            "{note}"
                                        </p>
                                    </div>
                                );
                            })()}

                            {/* ─── AI Voice Call Recording & Full Transcript (Same as Order Details) ─── */}
                            <div className="pt-2">
                                <OrderCallRecording
                                    call={call}
                                    conversations={conversations}
                                    orderSource={detailReservation.source}
                                    aiExtractedData={
                                        detailReservation.ai_extracted_data
                                    }
                                    loading={callLoading}
                                    onRefresh={() =>
                                        detailReservation &&
                                        loadReservationCall(detailReservation)
                                    }
                                />
                            </div>

                            {/* Action Buttons in Modal */}
                            <div className="pt-3 border-t border-border/60 flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                    {detailReservation.status === "pending" && (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="text-emerald-700 dark:text-emerald-400 border-emerald-600/50 hover:bg-emerald-500/10 font-medium gap-1.5"
                                                onClick={() => {
                                                    quickStatus(
                                                        detailReservation.id,
                                                        "confirmed",
                                                    );
                                                    setDetailReservation((r) =>
                                                        r
                                                            ? {
                                                                  ...r,
                                                                  status: "confirmed",
                                                              }
                                                            : null,
                                                    );
                                                }}
                                            >
                                                <CheckCircle2 className="h-4 w-4" />{" "}
                                                Confirm Booking
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-sm"
                                                onClick={() => {
                                                    handleCustomerArrived(
                                                        detailReservation,
                                                    );
                                                    setDetailReservation((r) =>
                                                        r
                                                            ? {
                                                                  ...r,
                                                                  status: "seated",
                                                              }
                                                            : null,
                                                    );
                                                }}
                                            >
                                                <UserCheck className="h-4 w-4" />{" "}
                                                Arrived & Seat
                                            </Button>
                                        </div>
                                    )}
                                    {detailReservation.status ===
                                        "confirmed" && (
                                        <Button
                                            size="sm"
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-sm hover:brightness-105"
                                            onClick={() => {
                                                handleCustomerArrived(
                                                    detailReservation,
                                                );
                                                setDetailReservation((r) =>
                                                    r
                                                        ? {
                                                              ...r,
                                                              status: "seated",
                                                          }
                                                        : null,
                                                );
                                            }}
                                        >
                                            <UserCheck className="h-4 w-4" />
                                            {detailReservation.table_number
                                                ? `✓ Customer Arrived · Seat at ${displayTableNumber(detailReservation.table_number)}`
                                                : "✓ Customer Arrived (Assign & Seat)"}
                                        </Button>
                                    )}
                                    {detailReservation.status === "seated" && (
                                        <Button
                                            size="sm"
                                            className="bg-slate-900 hover:bg-black text-white font-medium gap-1.5 shadow-sm"
                                            onClick={() => {
                                                quickStatus(
                                                    detailReservation.id,
                                                    "completed",
                                                );
                                                setDetailReservation((r) =>
                                                    r
                                                        ? {
                                                              ...r,
                                                              status: "completed",
                                                          }
                                                        : null,
                                                );
                                            }}
                                        >
                                            <CheckCircle2 className="h-4 w-4" />{" "}
                                            Complete Dining (Free Table)
                                        </Button>
                                    )}
                                    {["pending", "confirmed"].includes(
                                        detailReservation.status,
                                    ) && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-muted-foreground hover:text-destructive gap-1"
                                            onClick={() => {
                                                quickStatus(
                                                    detailReservation.id,
                                                    "no_show",
                                                );
                                                setDetailReservation((r) =>
                                                    r
                                                        ? {
                                                              ...r,
                                                              status: "no_show",
                                                          }
                                                        : null,
                                                );
                                            }}
                                        >
                                            <XCircle className="h-3.5 w-3.5" />{" "}
                                            No-Show
                                        </Button>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1.5"
                                        onClick={() => {
                                            setDetailDialogOpen(false);
                                            openEditReservation(
                                                detailReservation,
                                            );
                                        }}
                                    >
                                        <Pencil className="h-3.5 w-3.5" /> Edit
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-destructive hover:bg-destructive/10 hover:border-destructive/30 gap-1.5"
                                        onClick={() => {
                                            setDetailDialogOpen(false);
                                            setDeleteReservationId(
                                                detailReservation.id,
                                            );
                                        }}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />{" "}
                                        Delete
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            setDetailDialogOpen(false)
                                        }
                                    >
                                        Close
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* ─── CONFIRM DELETE RESERVATION ───────────── */}
            <AlertDialog
                open={!!deleteReservationId}
                onOpenChange={(o) => !o && setDeleteReservationId(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Reservation?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will mark the reservation as cancelled.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDeleteReservation}
                            className="bg-destructive text-destructive-foreground"
                        >
                            Cancel Reservation
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ─── CONFIRM DEACTIVATE TABLE ─────────────── */}
            <AlertDialog
                open={!!deleteTableId}
                onOpenChange={(o) => !o && setDeleteTableId(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Deactivate Table?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The table will be hidden from availability checks
                            but existing reservations are kept.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDeleteTable}
                            className="bg-destructive text-destructive-foreground"
                        >
                            Deactivate
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {/* ─── TABLE QR CODE DIALOG ─────────────────────── */}
            <Dialog
                open={!!qrTable}
                onOpenChange={(open) => !open && setQrTable(null)}
            >
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            <QrCode className="h-5 w-5 text-primary" />
                            Table QR Scanner Stand
                        </DialogTitle>
                        <DialogDescription>
                            Guests scan this QR code with their mobile phone to
                            check in as Seated and browse your live updated
                            menu.
                        </DialogDescription>
                    </DialogHeader>

                    {qrTable && (
                        <div className="space-y-4 py-2">
                            {/* Stand Preview Card (Printable) */}
                            <div
                                id="printable-qr-stand"
                                className="bg-card border-2 border-primary/30 rounded-2xl p-6 text-center shadow-md flex flex-col items-center justify-center space-y-3 bg-gradient-to-b from-primary/5 via-card to-card"
                            >
                                <div className="space-y-1">
                                    <p className="text-xs uppercase tracking-widest font-extrabold text-primary">
                                        {activeRestaurant?.name || "Restaurant"}
                                    </p>
                                    <h3 className="text-2xl font-black text-foreground tracking-tight">
                                        {displayTableNumber(
                                            qrTable.table_number,
                                        )}
                                    </h3>
                                    {qrTable.location && (
                                        <p className="text-xs text-muted-foreground font-medium">
                                            {qrTable.location} · Up to{" "}
                                            {qrTable.capacity} Guests
                                        </p>
                                    )}
                                </div>

                                <div className="p-3 bg-white rounded-2xl shadow-inner border border-border">
                                    <QRCodeSVG
                                        value={getTableMenuUrl(qrTable)}
                                        size={190}
                                        level="H"
                                        includeMargin
                                    />
                                </div>

                                <div className="space-y-1">
                                    <p className="text-sm font-bold text-foreground">
                                        Scan to Check In & Order Menu
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Point your camera to view today's live
                                        menu directly at this table
                                    </p>
                                </div>
                            </div>

                            {/* URL Display & Copy */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground">
                                    Menu & Check-In URL
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        readOnly
                                        value={getTableMenuUrl(qrTable)}
                                        className="font-mono text-xs h-9 bg-muted/60"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-9 px-3 shrink-0 gap-1 text-xs"
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                getTableMenuUrl(qrTable),
                                            );
                                            toast.success(
                                                "Table menu link copied!",
                                            );
                                        }}
                                    >
                                        <Copy className="h-3.5 w-3.5" /> Copy
                                    </Button>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-2 border-t">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5 text-xs"
                                    onClick={() =>
                                        window.open(
                                            getTableMenuUrl(qrTable),
                                            "_blank",
                                        )
                                    }
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />{" "}
                                    Test Menu
                                </Button>
                                <Button
                                    type="button"
                                    className="gap-1.5 text-xs gradient-primary"
                                    onClick={() => {
                                        const printContents =
                                            document.getElementById(
                                                "printable-qr-stand",
                                            )?.innerHTML;
                                        if (!printContents) return;
                                        const printWindow = window.open(
                                            "",
                                            "_blank",
                                        );
                                        if (!printWindow) return;
                                        printWindow.document.write(`
                      <html>
                        <head>
                          <title>Table ${qrTable.table_number} QR - ${activeRestaurant?.name || "Restaurant"}</title>
                          <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                            .print-card { text-align: center; border: 2px solid #e2e8f0; border-radius: 16px; padding: 32px; max-width: 320px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
                            h3 { margin: 0 0 4px; font-size: 24px; }
                            p { margin: 4px 0; color: #64748b; font-size: 13px; }
                          </style>
                        </head>
                        <body>
                          <div class="print-card">${printContents}</div>
                        </body>
                      </html>
                    `);
                                        printWindow.document.close();
                                        printWindow.focus();
                                        setTimeout(() => {
                                            printWindow.print();
                                            printWindow.close();
                                        }, 250);
                                    }}
                                >
                                    <Printer className="h-3.5 w-3.5" /> Print
                                    Stand Card
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
