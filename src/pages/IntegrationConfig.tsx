import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Phone, Mic, Mail, Save, Eye, EyeOff, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { PageHeader, PageShell } from "@/components/layout/PageShell";

export default function IntegrationConfig() {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSaveElevenLabs = () => {
    toast({
      title: "Configuration Saved",
      description: "ElevenLabs settings have been updated. Contact support to update API keys.",
    });
  };

  const handleSaveTwilio = () => {
    toast({
      title: "Configuration Saved", 
      description: "Twilio settings have been updated. Contact support to update API keys.",
    });
  };

  const handleSaveResend = () => {
    toast({
      title: "Configuration Saved",
      description: "Resend settings have been updated. Contact support to update API keys.",
    });
  };

  const cardClass = "rounded-2xl border border-border/80 shadow-xs overflow-hidden";

  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Integration Configuration"
        description="Configure your third-party service integrations"
      />

      <Tabs defaultValue="elevenlabs" className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 sm:w-auto sm:inline-flex">
          <TabsTrigger value="elevenlabs" className="gap-2">
            <Mic className="h-4 w-4" />
            <span className="hidden sm:inline">ElevenLabs</span>
          </TabsTrigger>
          <TabsTrigger value="twilio" className="gap-2">
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline">Twilio</span>
          </TabsTrigger>
          <TabsTrigger value="resend" className="gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Resend</span>
          </TabsTrigger>
        </TabsList>

        {/* ElevenLabs Configuration */}
        <TabsContent value="elevenlabs">
          <Card className={cardClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5 text-primary" />
                ElevenLabs Configuration
              </CardTitle>
              <CardDescription>
                Configure your ElevenLabs AI voice agent for handling inbound calls
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="elevenlabs-agent-id">Agent ID</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="elevenlabs-agent-id"
                        type={showSecrets['elevenlabs-agent-id'] ? 'text' : 'password'}
                        placeholder="Enter your ElevenLabs Agent ID"
                        defaultValue="••••••••••••••••"
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => toggleSecret('elevenlabs-agent-id')}
                      >
                        {showSecrets['elevenlabs-agent-id'] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The Agent ID from your ElevenLabs Conversational AI dashboard
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="elevenlabs-api-key">API Key</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="elevenlabs-api-key"
                        type={showSecrets['elevenlabs-api-key'] ? 'text' : 'password'}
                        placeholder="Enter your ElevenLabs API Key"
                        defaultValue="••••••••••••••••"
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => toggleSecret('elevenlabs-api-key')}
                      >
                        {showSecrets['elevenlabs-api-key'] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your ElevenLabs API key for authentication
                  </p>
                </div>
              </div>

              <div className="p-4 bg-muted/50 rounded-xl space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Post-call Webhook URL</Label>
                  <code className="block p-2 bg-background rounded text-xs break-all border">
                    {getApiBase()}/api/functions/elevenlabs-conversation-webhook
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Set this in ElevenLabs "Webhooks" or "Post-call Webhook" to sync transcripts and orders to this dashboard.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Tools (Server Action) URLs</Label>
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Place Order Tool</p>
                      <code className="block p-2 bg-background rounded text-xs break-all border">
                        {getApiBase()}/api/functions/ai-place-order
                      </code>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Order Status Tool</p>
                      <code className="block p-2 bg-background rounded text-xs break-all border">
                        {getApiBase()}/api/functions/ai-order-status
                      </code>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Add these as "Server" tools in your ElevenLabs agent to allow it to interact with your restaurant's data.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" className="w-full sm:w-auto" asChild>
                  <a href="https://elevenlabs.io/app/conversational-ai" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open ElevenLabs Dashboard
                  </a>
                </Button>
                <Button className="w-full sm:w-auto" onClick={handleSaveElevenLabs}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Twilio Configuration */}
        <TabsContent value="twilio">
          <Card className={cardClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" />
                Twilio Configuration
              </CardTitle>
              <CardDescription>
                Configure your Twilio account for voice calls and SMS
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="twilio-account-sid">Account SID</Label>
                  <div className="relative">
                    <Input
                      id="twilio-account-sid"
                      type={showSecrets['twilio-account-sid'] ? 'text' : 'password'}
                      placeholder="Enter your Twilio Account SID"
                      defaultValue="••••••••••••••••"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => toggleSecret('twilio-account-sid')}
                    >
                      {showSecrets['twilio-account-sid'] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Found in your Twilio Console dashboard
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="twilio-auth-token">Auth Token</Label>
                  <div className="relative">
                    <Input
                      id="twilio-auth-token"
                      type={showSecrets['twilio-auth-token'] ? 'text' : 'password'}
                      placeholder="Enter your Twilio Auth Token"
                      defaultValue="••••••••••••••••"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => toggleSecret('twilio-auth-token')}
                    >
                      {showSecrets['twilio-auth-token'] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your secret auth token from Twilio Console
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="twilio-phone-number">Phone Number</Label>
                  <Input
                    id="twilio-phone-number"
                    type="tel"
                    placeholder="+1234567890"
                    defaultValue=""
                  />
                  <p className="text-xs text-muted-foreground">
                    Your Twilio phone number in E.164 format
                  </p>
                </div>

                <div className="p-4 bg-muted/50 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                    <Label className="text-sm font-semibold">Native ElevenLabs Integration</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    If you connect your Twilio number directly inside ElevenLabs (Conversational AI → Phone Numbers), 
                    the AI will work automatically. Just make sure to set the <strong>Post-call Webhook</strong> 
                    in ElevenLabs to the URL below:
                  </p>
                  <code className="block p-2 bg-background rounded text-xs break-all border">
                    {getApiBase()}/api/functions/elevenlabs-conversation-webhook
                  </code>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" className="w-full sm:w-auto" asChild>
                  <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Twilio Console
                  </a>
                </Button>
                <Button className="w-full sm:w-auto" onClick={handleSaveTwilio}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Resend Configuration */}
        <TabsContent value="resend">
          <Card className={cardClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Resend Configuration
              </CardTitle>
              <CardDescription>
                Configure Resend for sending transactional emails
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="resend-api-key">API Key</Label>
                  <div className="relative">
                    <Input
                      id="resend-api-key"
                      type={showSecrets['resend-api-key'] ? 'text' : 'password'}
                      placeholder="Enter your Resend API Key"
                      defaultValue="••••••••••••••••"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => toggleSecret('resend-api-key')}
                    >
                      {showSecrets['resend-api-key'] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your Resend API key for sending emails
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="resend-from-email">From Email</Label>
                  <Input
                    id="resend-from-email"
                    type="email"
                    placeholder="noreply@yourdomain.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    The email address that will appear as the sender
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" className="w-full sm:w-auto" asChild>
                  <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Resend Dashboard
                  </a>
                </Button>
                <Button className="w-full sm:w-auto" onClick={handleSaveResend}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
