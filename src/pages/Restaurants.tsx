import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogBody } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store, Plus, Pencil, Trash2, Sparkles, Phone, Bot, Settings, Pause, Play, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBase, resolveMediaUrl } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Restaurant {
  id: string; name: string; slug: string; phone: string | null;
  contact_email: string | null; address: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  twilio_phone_number: string | null; elevenlabs_agent_id: string | null;
  is_active: boolean; created_at: string;
  agent_language?: string | null;
  agent_voice_id?: string | null;
  agent_first_message?: string | null;
  agent_system_prompt?: string | null;
  /** Filled in list view for super admin table */
  owner_login_email?: string;
  is_branch?: boolean;
  parent_restaurant_id?: string | null;
  commission_rate: number;
  allows_delivery: boolean;
  allows_pickup: boolean;
  cuisines?: string[];
}

type Mode = { kind: "create" } | { kind: "edit"; restaurant: Restaurant };

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "tr", label: "Turkish" },
  { code: "multi", label: "Multilingual (Auto-detect)" },
];

/** URL-safe slug for restaurant routing (also used on insert/update). */
function toRestaurantSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const emptyForm = {
  name: "",
  slug: "",
  phone: "",
  contact_email: "",
  address: "",
  owner_user_id: "",
  owner_email: "",
  /** Email loaded when edit dialog opened — used to detect owner email changes. */
  loaded_owner_email: "",
  owner_password: "",
  owner_full_name: "",
  twilio_phone_number: "",
  elevenlabs_agent_id: "",
  agent_language: "en",
  agent_voice_id: "",
  agent_first_message: "",
  agent_system_prompt: "",
  auto_create_agent: true,
  auto_attach_twilio: true,
  logo_url: "",
  cover_image_url: "",
  commission_rate: 10,
  allows_delivery: true,
  allows_pickup: true,
  cuisines: "",
};

function parseCuisineNames(input: string): string[] {
  const names = input
    .split(",")
    .map((n) => n.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

async function fetchOwnerForRestaurant(restaurantId: string): Promise<{
  owner_user_id: string;
  owner_email: string;
  owner_full_name: string;
}> {
  const empty = { owner_user_id: "", owner_email: "", owner_full_name: "" };
  const { data: members, error: mErr } = await supabase
    .from("restaurant_members")
    .select("user_id, member_role")
    .eq("restaurant_id", restaurantId);
  const memberList = (Array.isArray(members) ? members : []) as { user_id: string; member_role?: string }[];
  if (mErr || !memberList.length) return empty;
  const userIds = [...new Set(memberList.map((m) => m.user_id))];
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").in("id", userIds),
    supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
  ]);
  const plist = (profiles as { id: string; email: string; full_name: string | null }[]) ?? [];
  const rlist = (roles as { user_id: string; role: string }[]) ?? [];
  const mgmt = new Set(["super_admin", "admin", "manager"]);
  let picked = userIds[0];
  for (const uid of userIds) {
    const rs = rlist.filter((x) => x.user_id === uid).map((x) => x.role);
    if (rs.some((role) => mgmt.has(role))) {
      picked = uid;
      break;
    }
  }
  const p = plist.find((x) => x.id === picked) ?? plist[0];
  if (!p) return empty;
  return {
    owner_user_id: p.id,
    owner_email: p.email ?? "",
    owner_full_name: p.full_name ?? "",
  };
}

export default function Restaurants() {
  const { t } = useTranslation(["superAdmin", "cuisines", "common"]);
  const { role } = useAuth();
  const { toast } = useToast();
  const [list, setList] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [cuisinesView, setCuisinesView] = useState<{ name: string; cuisines: string[] } | null>(null);
  /** In create flow: after user edits slug, stop overwriting from name. */
  const slugManualRef = useRef(false);

  const logoPreview = logoFile ? URL.createObjectURL(logoFile) : null;
  const coverPreview = coverFile ? URL.createObjectURL(coverFile) : null;
  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [logoPreview, coverPreview]);

  const displayLogoSrc = logoPreview ?? resolveMediaUrl(form.logo_url) ?? undefined;
  const displayCoverSrc = coverPreview ?? resolveMediaUrl(form.cover_image_url) ?? undefined;

  async function syncRestaurantCuisines(restaurantId: string, cuisineNames: string[]) {
    await supabase.from("restaurant_cuisines").delete().eq("restaurant_id", restaurantId);
    if (!cuisineNames.length) return;

    for (const name of cuisineNames) {
      const { error } = await supabase.from("cuisines").upsert({ name }, { onConflict: "name" });
      if (error) throw error;
    }

    const { data: rows, error: fetchErr } = await supabase
      .from("cuisines")
      .select("id,name")
      .in("name", cuisineNames);
    if (fetchErr) throw fetchErr;
    const cuisineRows = (rows as { id: string; name: string }[]) ?? [];
    if (!cuisineRows.length) return;

    const payload = cuisineRows.map((r) => ({ restaurant_id: restaurantId, cuisine_id: r.id }));
    const { error: linkErr } = await supabase.from("restaurant_cuisines").insert(payload);
    if (linkErr) throw linkErr;
  }

  async function uploadRestaurantImage(file: File): Promise<string> {
    const token = getToken();
    if (!token) throw new Error("Not signed in — sign in to upload images.");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${getApiBase()}/api/uploads/restaurant-branding-image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
    if (!j.url || typeof j.url !== "string") throw new Error("Invalid response from server.");
    return j.url;
  }

  const load = async () => {
    setLoading(true);
    try {
      const token = getToken();
      // Use dedicated backend endpoint — returns all restaurants with owner emails and cuisines
      const resp = await fetch(`${getApiBase()}/api/stats/all-restaurants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Failed to load", description: j.error || resp.statusText });
        return;
      }
      const j = await resp.json();
      setList((j.restaurants || []) as Restaurant[]);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (role !== "super_admin") {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold">Super admin only</h1>
        <p className="text-muted-foreground text-sm mt-2">You do not have permission to manage restaurants.</p>
      </div>
    );
  }

  const openCreate = () => {
    slugManualRef.current = false;
    setLogoFile(null);
    setCoverFile(null);
    setForm(emptyForm);
    setMode({ kind: "create" });
  };

  const openEdit = async (r: Restaurant) => {
    setLogoFile(null);
    setCoverFile(null);
    const owner = await fetchOwnerForRestaurant(r.id);
    setForm({
      name: r.name,
      slug: r.slug,
      phone: r.phone ?? "",
      contact_email: r.contact_email ?? "",
      address: r.address ?? "",
      logo_url: r.logo_url ?? "",
      cover_image_url: r.cover_image_url ?? "",
      ...owner,
      loaded_owner_email: owner.owner_email ?? "",
      owner_password: "",
      twilio_phone_number: r.twilio_phone_number ?? "",
      elevenlabs_agent_id: r.elevenlabs_agent_id ?? "",
      agent_language: r.agent_language ?? "en",
      agent_voice_id: r.agent_voice_id ?? "",
      agent_first_message: r.agent_first_message ?? "",
      agent_system_prompt: r.agent_system_prompt ?? "",
      auto_create_agent: !r.elevenlabs_agent_id,
      auto_attach_twilio: false,
      commission_rate: r.commission_rate ?? 10,
      allows_delivery: r.allows_delivery ?? true,
      allows_pickup: r.allows_pickup ?? true,
      cuisines: (r.cuisines ?? []).join(", "),
    });
    setMode({ kind: "edit", restaurant: r });
  };

  const closeDialog = () => {
    slugManualRef.current = false;
    setLogoFile(null);
    setCoverFile(null);
    setMode(null);
    setForm(emptyForm);
  };

  const submit = async () => {
    const slug =
      mode?.kind === "create"
        ? toRestaurantSlug(form.slug || form.name)
        : toRestaurantSlug(form.slug);
    if (!form.name?.trim()) {
      return toast({ variant: "destructive", title: "Name required" });
    }
    if (!slug) {
      return toast({
        variant: "destructive",
        title: "Slug required",
        description:
          mode?.kind === "create"
            ? "Use letters or numbers in the name (or set a custom slug)."
            : "Enter a valid slug.",
      });
    }

    const telephonyPayload = {
      twilio_phone_number: form.twilio_phone_number?.trim() || null,
      elevenlabs_agent_id: form.elevenlabs_agent_id?.trim() || null,
      agent_language: form.agent_language || "en",
      agent_voice_id: form.agent_voice_id?.trim() || null,
      agent_first_message: form.agent_first_message?.trim() || null,
      agent_system_prompt: form.agent_system_prompt?.trim() || null,
      commission_rate: Number(form.commission_rate) || 10,
      allows_delivery: form.allows_delivery,
      allows_pickup: form.allows_pickup,
    };

    /** Returns optional note text when EL is skipped (invalid key, etc.); throws on transport / Twilio failure. */
    const runAgentAndTwilio = async (restaurantId: string): Promise<string> => {
      let note = "";
      if (form.auto_create_agent) {
        const { data: agentRes, error: agentErr } = await supabase.functions.invoke("create-restaurant-agent", {
          body: { restaurant_id: restaurantId },
        });
        if (agentErr) throw new Error(`Agent: ${agentErr.message}`);
        if (agentRes && (agentRes as any).success === false) {
          throw new Error(`Agent: ${(agentRes as any).error}`);
        }
        const w = (agentRes as { warning?: string } | null)?.warning;
        if (w) note = w;
      }
      if (form.auto_attach_twilio && form.twilio_phone_number?.trim()) {
        const { data: twRes, error: twErr } = await supabase.functions.invoke("attach-twilio-to-agent", {
          body: { restaurant_id: restaurantId },
        });
        if (twErr) throw new Error(`Twilio: ${twErr.message}`);
        if (twRes && (twRes as any).success === false) {
          throw new Error(`Twilio: ${(twRes as any).error}`);
        }
      }
      return note;
    };

    if (mode?.kind === "create") {
      if (!form.owner_email || !form.owner_password) {
        return toast({ variant: "destructive", title: "Restaurant owner email and password required" });
      }
      if (form.owner_password.length < 6) {
        return toast({ variant: "destructive", title: "Password too short", description: "Use at least 6 characters." });
      }
      setSubmitting(true);
      let createdRestaurantId: string | null = null;
      try {
        const { data: existingSlug } = await supabase
          .from("restaurants")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();

        if (existingSlug) {
          setSubmitting(false);
          return toast({
            variant: "destructive",
            title: "Restaurant slug already exists",
            description: `A restaurant with the slug "${slug}" already exists. Please choose a different restaurant name or change the slug.`,
          });
        }

        const cuisineNames = parseCuisineNames(form.cuisines);
        let logo_url: string | null = (form.logo_url || "").trim() || null;
        let cover_image_url: string | null = (form.cover_image_url || "").trim() || null;
        if (logoFile) logo_url = await uploadRestaurantImage(logoFile);
        if (coverFile) cover_image_url = await uploadRestaurantImage(coverFile);

        const { data, error } = await supabase.from("restaurants").insert({
          name: form.name,
          slug,
          phone: form.phone || null,
          contact_email: form.contact_email || form.owner_email,
          address: form.address || null,
          logo_url,
          cover_image_url,
          ...telephonyPayload,
        }).select().single();
        if (error) throw error;
        const restaurantId = (data as any).id as string;
        createdRestaurantId = restaurantId;
        await syncRestaurantCuisines(restaurantId, cuisineNames);

        const { error: settingsErr } = await supabase.from("restaurant_settings").insert({
          restaurant_id: restaurantId,
          name: form.name,
        });
        if (settingsErr) throw settingsErr;

        const { data: userRes, error: userErr } = await supabase.functions.invoke("create-restaurant-user", {
          body: {
            email: form.owner_email,
            password: form.owner_password,
            full_name: form.owner_full_name || form.name,
            restaurant_id: restaurantId,
            member_role: "owner",
            app_role: "admin",
          },
        });
        if (userErr) throw userErr;
        if ((userRes as any)?.error) throw new Error((userRes as any).error);

        createdRestaurantId = null;

        let setupNote = "";
        try {
          setupNote = await runAgentAndTwilio(restaurantId);
        } catch (sub: unknown) {
          setupNote = sub instanceof Error ? sub.message : String(sub);
        }

        toast({
          title: "Restaurant created",
          description: setupNote
            ? `${form.owner_email} can sign in as the restaurant owner. ${setupNote}`
            : `${form.owner_email} can sign in as the restaurant owner.`,
        });
        closeDialog();
        load();
      } catch (e: any) {
        if (createdRestaurantId) {
          const { error: delErr } = await supabase.from("restaurants").delete().eq("id", createdRestaurantId);
          if (delErr) {
            console.error("Rollback: failed to delete partial restaurant", createdRestaurantId, delErr);
          }
        }
        const errMsg = e?.message ?? String(e);
        const description = errMsg.includes("restaurants_slug_key")
          ? `A restaurant with the slug "${slug}" already exists. Please customize the slug.`
          : errMsg;
        toast({ variant: "destructive", title: "Create failed", description });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode?.kind === "edit") {
      setSubmitting(true);
      try {
        const { data: existingSlug } = await supabase
          .from("restaurants")
          .select("id")
          .eq("slug", slug)
          .neq("id", mode.restaurant.id)
          .maybeSingle();

        if (existingSlug) {
          setSubmitting(false);
          return toast({
            variant: "destructive",
            title: "Restaurant slug already in use",
            description: `Another restaurant is already using the slug "${slug}". Please choose a different slug.`,
          });
        }

        const cuisineNames = parseCuisineNames(form.cuisines);
        let logo_url: string | null = (form.logo_url || "").trim() || null;
        let cover_image_url: string | null = (form.cover_image_url || "").trim() || null;
        if (logoFile) logo_url = await uploadRestaurantImage(logoFile);
        if (coverFile) cover_image_url = await uploadRestaurantImage(coverFile);

        const [restRes, settingsRes] = await Promise.all([
          supabase.from("restaurants").update({
            name: form.name,
            slug,
            phone: form.phone || null,
            contact_email: form.contact_email || null,
            address: form.address || null,
            logo_url,
            cover_image_url,
            ...telephonyPayload,
          }).eq("id", mode.restaurant.id),
          supabase.from("restaurant_settings").update({
            name: form.name,
          }).eq("restaurant_id", mode.restaurant.id)
        ]);
        if (restRes.error) throw restRes.error;
        if (settingsRes.error) console.error("Failed to sync settings name:", settingsRes.error);
        await syncRestaurantCuisines(mode.restaurant.id, cuisineNames);

        if (!form.owner_email?.trim()) {
          throw new Error("Restaurant owner email is required.");
        }
        if (!form.owner_user_id && (!form.owner_password || form.owner_password.length < 6)) {
          throw new Error("Enter a password for the new owner (at least 6 characters), or load an existing restaurant that already has an owner.");
        }
        const ownerEmail = form.owner_email.trim();
        const loadedOwnerEmail = String(form.loaded_owner_email || "").trim().toLowerCase();
        const emailUnchanged = loadedOwnerEmail !== "" && ownerEmail.toLowerCase() === loadedOwnerEmail;
        const ownerBody: Record<string, unknown> = {
          email: ownerEmail,
          full_name: (form.owner_full_name || form.name).trim(),
          restaurant_id: mode.restaurant.id,
          member_role: "owner",
          app_role: "admin",
        };
        // Pass user_id only when email is unchanged. If email switched to an existing
        // account (e.g. royal@gmail.com), API links that account as owner.
        if (form.owner_user_id && emailUnchanged) {
          ownerBody.user_id = form.owner_user_id;
        }
        if (form.owner_password.trim().length >= 6) {
          ownerBody.password = form.owner_password;
        }
        const { data: userRes, error: userErr } = await supabase.functions.invoke("create-restaurant-user", {
          body: ownerBody,
        });
        if (userErr) throw userErr;
        if ((userRes as any)?.error) throw new Error((userRes as any).error);

        let setupNote = "";
        try {
          setupNote = await runAgentAndTwilio(mode.restaurant.id);
        } catch (sub: unknown) {
          setupNote = sub instanceof Error ? sub.message : String(sub);
        }

        toast({
          title: "Restaurant updated",
          ...(setupNote ? { description: setupNote } : {}),
        });
        closeDialog();
        load();
      } catch (e: any) {
        const errMsg = e?.message ?? String(e);
        const description = errMsg.includes("restaurants_slug_key")
          ? `Another restaurant is already using the slug "${slug}". Please choose a different slug.`
          : errMsg;
        toast({ variant: "destructive", title: "Update failed", description });
      } finally {
        setSubmitting(false);
      }
    }
  };

  const toggleActive = async (r: Restaurant) => {
    await supabase.from("restaurants").update({ is_active: !r.is_active }).eq("id", r.id);
    load();
  };

  const removeRestaurant = async (r: Restaurant) => {
    if (!confirm(`Delete "${r.name}"? This cannot be undone and will remove all associated data.`)) return;
    const { error } = await supabase.from("restaurants").delete().eq("id", r.id);
    if (error) return toast({ variant: "destructive", title: "Delete failed", description: (error as any).message });
    toast({ title: "Restaurant deleted" });
    load();
  };

  const isEdit = mode?.kind === "edit";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Store className="h-6 w-6" />{t("superAdmin:restaurants", "Restaurants")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("superAdmin:restaurantsSubtitle", "Each restaurant has one dashboard owner. Provision tenants and manage their login here.")}
            {!loading ? ` · ${list.length} total` : ""}
          </p>
        </div>
        <Dialog open={!!mode} onOpenChange={(o) => { if (!o) closeDialog(); }}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />{t("superAdmin:newRestaurant", "New restaurant")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{isEdit ? t("superAdmin:editRestaurant", "Edit restaurant") : t("superAdmin:createRestaurant", "Create restaurant")}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {isEdit ? t("superAdmin:editRestaurantDesc", "Update restaurant configuration and details.") : t("superAdmin:createRestaurantDesc", "Add a new restaurant tenant and assign an owner account.")}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (mode?.kind === "create" && !slugManualRef.current) {
                      setForm({ ...form, name, slug: toRestaurantSlug(name) });
                    } else {
                      setForm({ ...form, name });
                    }
                  }}
                />
              </div>
              <div>
                <Label>Slug {!isEdit && <span className="text-muted-foreground font-normal">(from name)</span>}</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => {
                    if (mode?.kind === "create") slugManualRef.current = true;
                    setForm({ ...form, slug: e.target.value });
                  }}
                  placeholder="my-restaurant"
                />
                {!isEdit && (
                  <p className="text-xs text-muted-foreground mt-1">Updates as you type the name; edit here for a custom URL.</p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div>
                  <Label>Contact email</Label>
                  <Input
                    value={form.contact_email}
                    onChange={(e) => {
                      const contact_email = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        contact_email,
                        ...(mode?.kind === "create" && !prev.owner_email?.trim()
                          ? { owner_email: contact_email }
                          : {}),
                      }));
                    }}
                  />
                  {!isEdit && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Also used as the restaurant login email until you set a different one below.
                    </p>
                  )}
                </div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div>
                <Label>Cuisines</Label>
                <Input
                  value={form.cuisines}
                  onChange={(e) => setForm({ ...form, cuisines: e.target.value })}
                  placeholder="Italian, Chinese, Mexican"
                />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated cuisines linked to this restaurant.</p>
              </div>
              <div>
                <Label>Platform Commission (%)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.commission_rate}
                    onChange={(e) => setForm({ ...form, commission_rate: parseFloat(e.target.value) || 0 })}
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Percentage of total sales that the platform takes as fee.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-3 mt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="delivery"
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    checked={form.allows_delivery}
                    onChange={(e) => setForm({ ...form, allows_delivery: e.target.checked })}
                  />
                  <Label htmlFor="delivery" className="cursor-pointer text-sm font-medium">Allows Delivery</Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="pickup"
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    checked={form.allows_pickup}
                    onChange={(e) => setForm({ ...form, allows_pickup: e.target.checked })}
                  />
                  <Label htmlFor="pickup" className="cursor-pointer text-sm font-medium">Allows Self Pickup</Label>
                </div>
              </div>

              <div className="border-t pt-3 mt-2 space-y-3">
                <div>
                  <h3 className="font-semibold text-sm">
                    {isEdit ? "Restaurant owner (login)" : "Restaurant owner (login)"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {isEdit
                      ? "Each restaurant has a single owner account for the dashboard. Password is never shown—enter a new one only to reset it."
                      : "Creates the only owner account for this restaurant. Required when creating a new restaurant."}
                  </p>
                </div>
                <div>
                  <Label>Owner full name</Label>
                  <Input
                    value={form.owner_full_name}
                    onChange={(e) => setForm({ ...form, owner_full_name: e.target.value })}
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <Label>Owner email *</Label>
                  <Input
                    type="email"
                    value={form.owner_email}
                    onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                    placeholder="owner@restaurant.com"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    If this email already has an account, that account becomes the restaurant owner.
                  </p>
                </div>
                <div>
                  <Label>{isEdit ? "New password (optional)" : "Owner password *"}</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.owner_password}
                    onChange={(e) => setForm({ ...form, owner_password: e.target.value })}
                    placeholder={isEdit ? "Leave blank to keep current password" : "At least 6 characters"}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-3 mt-2">
                <div className="space-y-2">
                  <Label>Logo</Label>
                  {displayLogoSrc && (
                    <img src={displayLogoSrc} alt="" className="h-20 w-20 object-cover rounded-md border bg-muted" />
                  )}
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="cursor-pointer"
                    onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                  />
                  {(form.logo_url || logoFile) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLogoFile(null);
                        setForm((prev) => ({ ...prev, logo_url: "" }));
                      }}
                    >
                      Remove logo
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">Square image works best. JPEG, PNG, GIF, or WebP — up to 5MB.</p>
                </div>
                <div className="space-y-2">
                  <Label>Cover image</Label>
                  {displayCoverSrc && (
                    <img src={displayCoverSrc} alt="" className="h-20 w-full max-w-xs object-cover rounded-md border bg-muted" />
                  )}
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="cursor-pointer"
                    onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                  />
                  {(form.cover_image_url || coverFile) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCoverFile(null);
                        setForm((prev) => ({ ...prev, cover_image_url: "" }));
                      }}
                    >
                      Remove cover
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">Banner-style image. Same formats — up to 5MB.</p>
                </div>
              </div>

              <div className="border-t pt-3 mt-2 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Phone className="h-4 w-4" /> Twilio
                </h3>
                <div>
                  <Label>Twilio phone number (E.164)</Label>
                  <Input
                    value={form.twilio_phone_number}
                    onChange={(e) => setForm({ ...form, twilio_phone_number: e.target.value })}
                    placeholder="+15551234567"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The phone number customers will call to reach this restaurant.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.auto_attach_twilio}
                    onChange={(e) => setForm({ ...form, auto_attach_twilio: e.target.checked })}
                  />
                  Auto-attach this number to the ElevenLabs agent
                </label>
              </div>

              <div className="border-t pt-3 mt-2 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Bot className="h-4 w-4" /> AI agent
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Language</Label>
                    <Select
                      value={form.agent_language}
                      onValueChange={(v) => setForm({ ...form, agent_language: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Voice ID (optional)</Label>
                    <Input
                      value={form.agent_voice_id}
                      onChange={(e) => setForm({ ...form, agent_voice_id: e.target.value })}
                      placeholder="EXAVITQu4vr4xnSDxMaL"
                    />
                  </div>
                </div>

                <div>
                  <Label>First message (optional)</Label>
                  <Input
                    value={form.agent_first_message}
                    onChange={(e) => setForm({ ...form, agent_first_message: e.target.value })}
                    placeholder={`Hi, thanks for calling ${form.name || "us"}!`}
                  />
                </div>

                <div>
                  <Label>System prompt (optional)</Label>
                  <Textarea
                    rows={4}
                    value={form.agent_system_prompt}
                    onChange={(e) => setForm({ ...form, agent_system_prompt: e.target.value })}
                    placeholder="Leave blank for the sensible default."
                  />
                </div>

                <div>
                  <Label>ElevenLabs agent ID (optional override)</Label>
                  <Input
                    value={form.elevenlabs_agent_id}
                    onChange={(e) => setForm({ ...form, elevenlabs_agent_id: e.target.value })}
                    placeholder="agent_…"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave blank and we'll create a dedicated agent automatically.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.auto_create_agent}
                    onChange={(e) => setForm({ ...form, auto_create_agent: e.target.checked })}
                  />
                  <Sparkles className="h-3 w-3" />
                  {form.elevenlabs_agent_id
                    ? "Update the existing ElevenLabs agent with these settings"
                    : "Create a new ElevenLabs agent for this restaurant"}
                </label>
              </div>

            </DialogBody>
            <DialogFooter>
              <Button onClick={submit} className="w-full sm:w-auto" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save changes" : "Create restaurant"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">{t("common:loading", "Loading…")}</p>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{t("superAdmin:noRestaurants", "No restaurants yet")}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("superAdmin:colName", "Name")}</TableHead>
                    <TableHead>{t("common:status", "Status")}</TableHead>
                    <TableHead>{t("superAdmin:colOwnerLogin", "Owner login")}</TableHead>
                    <TableHead>{t("cuisines:title", "Cuisines")}</TableHead>
                    <TableHead className="text-right w-[168px]">{t("common:actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.name}</span>
                          {r.is_branch ? (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              Branch
                            </Badge>
                          ) : null}
                        </div>
                        <code className="text-xs text-muted-foreground">/{r.slug}</code>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.is_active ? "default" : "secondary"}
                          className={cn(r.is_active ? "bg-green-500/10 text-green-600 border-green-500/20" : "")}
                        >
                          {r.is_active ? t("common:active", "Active") : t("common:inactive", "Inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-muted-foreground text-xs" title={r.owner_login_email || undefined}>
                        {r.owner_login_email || "—"}
                      </TableCell>
                      <TableCell>
                        {r.cuisines?.length ? (
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs font-medium text-primary no-underline hover:no-underline"
                            onClick={() => setCuisinesView({ name: r.name, cuisines: r.cuisines ?? [] })}
                          >
                            {t("cuisines:viewCuisines", "View Cuisines")}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            asChild
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                            title={t("common:details", "Details")}
                          >
                            <Link to={`/restaurants/${r.id}/details`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button asChild size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary" title={t("common:configure", "Configure")}>
                            <Link to={`/restaurants/${r.id}/configuration`}>
                              <Settings className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary" onClick={() => openEdit(r)} title={t("common:edit", "Edit")}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-full"
                            onClick={() => toggleActive(r)}
                            title={r.is_active ? t("common:pause", "Pause") : t("common:resume", "Resume")}
                          >
                            {r.is_active ? <Pause className="h-4 w-4 text-orange-500" /> : <Play className="h-4 w-4 text-green-500" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10" onClick={() => removeRestaurant(r)} title={t("common:delete", "Delete")}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!cuisinesView} onOpenChange={(open) => { if (!open) setCuisinesView(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cuisines</DialogTitle>
            {cuisinesView?.name ? (
              <p className="text-sm text-muted-foreground pt-1">{cuisinesView.name}</p>
            ) : null}
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {cuisinesView?.cuisines.length ?? 0} cuisine{(cuisinesView?.cuisines.length ?? 0) === 1 ? "" : "s"} assigned
            </p>
            <div className="flex flex-wrap gap-2">
              {(cuisinesView?.cuisines ?? []).map((c) => (
                <Badge key={c} variant="secondary" className="text-sm font-medium">
                  {c}
                </Badge>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCuisinesView(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
