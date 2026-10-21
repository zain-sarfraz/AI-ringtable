import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Phone,
  Mail,
  Building2,
  Calendar,
  MessageSquare,
  User,
  Bot,
  Clock,
} from "lucide-react";
import { ClassifierAuditPanel } from "./ClassifierAuditPanel";
import { supabase } from "@/integrations/supabase/client";
import { cleanUrduText } from "@/lib/devanagariTransliterator";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type Lead = Tables<"leads">;
type Conversation = Tables<"conversations">;
type Call = Tables<"calls">;

interface LeadDetailDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500 text-white",
  contacted: "bg-yellow-500 text-white",
  qualified: "bg-green-500 text-white",
  proposal: "bg-purple-500 text-white",
  negotiation: "bg-orange-500 text-white",
  won: "bg-status-available text-white",
  lost: "bg-destructive text-white",
};

const sentimentColors: Record<string, string> = {
  positive: "text-green-500",
  neutral: "text-muted-foreground",
  negative: "text-destructive",
};

export function LeadDetailDialog({
  lead,
  open,
  onOpenChange,
}: LeadDetailDialogProps) {
  const { data: conversations = [] } = useQuery({
    queryKey: ["lead-conversations", lead?.id],
    queryFn: async () => {
      if (!lead?.id) return [];
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("lead_id", lead.id)
        .order("timestamp", { ascending: true });
      if (error) throw error;
      return data as Conversation[];
    },
    enabled: !!lead?.id,
  });

  const { data: calls = [] } = useQuery({
    queryKey: ["lead-calls", lead?.id, lead?.phone_number],
    queryFn: async () => {
      if (!lead?.id) return [];
      // Match by lead_id OR by phone_number — auto-dialer calls aren't always linked via lead_id
      const { data, error } = await supabase
        .from("calls")
        .select("*")
        .or(`lead_id.eq.${lead.id},phone_number.eq.${lead.phone_number}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Call[];
    },
    enabled: !!lead?.id,
    refetchInterval: 5000,
  });

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>{lead.full_name || "Unknown Lead"}</span>
            <Badge className={statusColors[lead.status || "new"]}>
              {lead.status?.replace("_", " ") || "New"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">Lead Info</TabsTrigger>
            <TabsTrigger value="conversations">
              Conversations ({conversations.length})
            </TabsTrigger>
            <TabsTrigger value="calls">Calls ({calls.length})</TabsTrigger>
            <TabsTrigger value="audit">Classifier Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{lead.phone_number}</span>
                  </div>
                  {lead.email && (
                    <div className="flex items-center gap-3">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{lead.email}</span>
                    </div>
                  )}
                  {lead.company && (
                    <div className="flex items-center gap-3">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>{lead.company}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Created:{" "}
                      {lead.created_at
                        ? format(new Date(lead.created_at), "PPP")
                        : "-"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Services Interested
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {lead.services_interested?.map((service) => (
                      <Badge key={service} variant="secondary">
                        {service}
                      </Badge>
                    ))}
                    {(!lead.services_interested ||
                      lead.services_interested.length === 0) && (
                      <span className="text-muted-foreground text-sm">
                        No services recorded
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    {lead.notes || "No notes available"}
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="conversations" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No conversation history found
                </div>
              ) : (
                <div className="space-y-4">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={cn(
                        "flex gap-3 p-3 rounded-lg",
                        conv.speaker === "agent" || conv.speaker === "ai"
                          ? "bg-primary/10 ml-8"
                          : "bg-muted mr-8"
                      )}
                    >
                      <div className="flex-shrink-0">
                        {conv.speaker === "ai" ? (
                          <Bot className="h-5 w-5 text-primary" />
                        ) : conv.speaker === "agent" ? (
                          <User className="h-5 w-5 text-primary" />
                        ) : (
                          <User className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium capitalize">
                            {conv.speaker}
                          </span>
                          {conv.sentiment && (
                            <span
                              className={cn(
                                "text-xs",
                                sentimentColors[conv.sentiment] ||
                                  sentimentColors.neutral
                              )}
                            >
                              ({conv.sentiment})
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {conv.timestamp
                              ? format(new Date(conv.timestamp), "p")
                              : ""}
                          </span>
                        </div>
                        <p className="text-sm">{conv.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="calls" className="mt-4">
            <ScrollArea className="h-[400px]">
              {calls.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No call history found
                </div>
              ) : (
                <div className="space-y-3">
                  {calls.map((call) => (
                    <Card key={call.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">
                                {call.direction === "inbound"
                                  ? "Inbound Call"
                                  : "Outbound Call"}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {call.phone_number}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline">{call.status}</Badge>
                            <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {call.duration_seconds
                                ? `${Math.floor(call.duration_seconds / 60)}:${String(
                                    call.duration_seconds % 60
                                  ).padStart(2, "0")}`
                                : "-"}
                            </div>
                          </div>
                        </div>
                        
                        {/* Transcript Section */}
                        {call.transcript && (
                          <div className="mt-4 pt-4 border-t">
                            <p className="text-sm font-medium mb-2 flex items-center gap-2">
                              <MessageSquare className="h-4 w-4" />
                              Transcript
                            </p>
                            <div className="bg-muted/50 rounded-lg p-3 max-h-[200px] overflow-y-auto">
                              <pre className="text-xs whitespace-pre-wrap font-sans">
                                {cleanUrduText(call.transcript)}
                              </pre>
                            </div>
                          </div>
                        )}
                        
                        {call.notes && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {cleanUrduText(call.notes)}
                          </p>
                        )}
                        {call.created_at && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {format(new Date(call.created_at), "PPP p")}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <ClassifierAuditPanel calls={calls} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
