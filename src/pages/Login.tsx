import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  Shield,
  Store,
  ArrowLeft,
  KeyRound,
} from "lucide-react";
import { BRAND_ASSETS, PRODUCT_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";
import { cn } from "@/lib/utils";

const DEMO_CREDENTIALS = [
  {
    key: "superAdmin",
    email: "admin@admin.com",
    password: "11223344",
    icon: Shield,
  },
  {
    key: "royalAdmin",
    email: "royal@gmail.com",
    password: "11223344",
    icon: Store,
  },
] as const;

type AuthView = "login" | "forgot" | "reset";

export default function Login() {
  const { t } = useTranslation(["auth", "common"]);
  const { user, loading, signIn } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<AuthView>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const fillCredentials = (creds: (typeof DEMO_CREDENTIALS)[number]) => {
    setEmail(creds.email);
    setPassword(creds.password);
    setShowPassword(true);
    setView("login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <img src={BRAND_ASSETS.appIcon} alt={PRODUCT_NAME} className="h-12 w-12 rounded-2xl shadow-lg" />
          <span className="text-sm font-medium text-muted-foreground">{t("common:loading", "Loading…")}</span>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err) {
      // Error toast is handled inside signIn
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        debugOtp?: string;
      };

      if (!res.ok) {
        toast({
          title: t("common:error", "Failed to send reset code"),
          description: data?.error || "User not found or invalid email.",
          variant: "destructive",
        });
        return;
      }

      if (data?.debugOtp) {
        setOtp(data.debugOtp);
      }

      toast({
        title: "Demo OTP Generated",
        description: data?.debugOtp
          ? `Use code: ${data.debugOtp}`
          : "Check your email/SMS for code (using demo fallback if mail unconfigured).",
      });
      setView("reset");
    } catch {
      toast({
        title: t("common:error", "Error"),
        description: "Network error requesting password reset.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      toast({ title: "OTP required", description: "Please enter the OTP code", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        title: "Weak password",
        description: "Password should be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Password mismatch",
        description: "New password and confirmation do not match.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          otp: otp.trim(),
          newPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        toast({
          title: "Reset failed",
          description: data?.error || "Invalid or expired OTP.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: t("auth:passwordUpdated", "Password reset successful"),
        description: "You can now sign in with your new password.",
      });
      setPassword(newPassword);
      setView("login");
    } catch {
      toast({
        title: t("common:error", "Error"),
        description: "Network error resetting password.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const heading =
    view === "login"
      ? { title: t("auth:signIn", "Welcome back"), subtitle: t("auth:signInSubtitle", "Sign in to access your dashboard") }
      : view === "forgot"
        ? { title: t("auth:forgotPassword", "Forgot password"), subtitle: t("auth:forgotPasswordSubtitle", "Enter your account email to continue") }
        : { title: t("auth:changePassword", "Reset password"), subtitle: t("auth:resetPasswordSubtitle", "Enter the OTP and choose a new password") };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-10 xl:p-14 text-primary-foreground">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(145deg, hsl(var(--primary)) 0%, hsl(18 92% 42%) 48%, hsl(217 28% 17%) 100%)",
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, hsl(0 0% 100% / 0.35) 0%, transparent 42%), radial-gradient(circle at 85% 75%, hsl(32 96% 60% / 0.35) 0%, transparent 45%)",
          }}
          aria-hidden
        />
        <div
          className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary-foreground/10 blur-3xl animate-[pulse-subtle_6s_ease-in-out_infinite]"
          aria-hidden
        />
        <div
          className="absolute -left-16 bottom-20 h-64 w-64 rounded-full bg-primary/30 blur-3xl animate-[pulse-subtle_8s_ease-in-out_infinite]"
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(0 0% 100% / 0.9) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.9) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden
        />

        <div className="relative z-10 flex items-center gap-3">
          <img src={BRAND_ASSETS.logoHorizontalWhite} alt={PRODUCT_NAME} className="h-9 w-auto max-w-[200px]" />
        </div>

        <div className="relative z-10 max-w-md space-y-5">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-primary-foreground/80">
            <Sparkles className="h-4 w-4" aria-hidden />
            {t("auth:aiOrderingSystem", "AI Ordering System")}
          </p>
          <h1 className="text-4xl xl:text-5xl font-bold leading-[1.1] tracking-tight">
            {t("auth:heroTitle", "Run your kitchen from one calm dashboard.")}
          </h1>
          <p className="text-base xl:text-lg text-primary-foreground/75 leading-relaxed max-w-sm">
            {t("auth:heroSubtitle", "Orders, menu, fleet, and reports — signed in and ready when you are.")}
          </p>
        </div>

        <p className="relative z-10 text-sm text-primary-foreground/50">
          © {new Date().getFullYear()} {PRODUCT_NAME}
        </p>
      </aside>

      <main className="relative flex min-h-screen flex-col items-center justify-center p-6 sm:p-10">
        {/* Language switcher on sign-in side */}
        <div className="absolute top-5 right-5 sm:top-8 sm:right-8 z-20">
          <LanguageSwitcher />
        </div>

        <div
          className="pointer-events-none absolute inset-0 opacity-60 lg:opacity-100"
          style={{
            background:
              "radial-gradient(ellipse 70% 50% at 50% 0%, hsl(var(--primary) / 0.1), transparent 70%)",
          }}
          aria-hidden
        />

        <div className="relative w-full max-w-[400px] animate-fade-in my-auto">
          <div className="flex items-center gap-2 mb-6 lg:hidden">
            <img src={BRAND_ASSETS.logoHorizontal} alt={PRODUCT_NAME} className="h-8 w-auto max-w-[180px]" />
          </div>

          <div className="mb-8 space-y-2 text-center lg:text-left">
            {view !== "login" ? (
              <button
                type="button"
                onClick={() => setView(view === "reset" ? "forgot" : "login")}
                className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("common:back", "Back")}
              </button>
            ) : null}
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{heading.title}</h2>
            <p className="text-muted-foreground text-sm sm:text-base">{heading.subtitle}</p>
          </div>

          {view === "login" ? (
            <form
              onSubmit={handleLogin}
              className={cn(
                "rounded-3xl border border-border/60 bg-card/80 backdrop-blur-sm",
                "shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] p-6 sm:p-8 space-y-5",
              )}
            >
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground/80">
                  {t("auth:emailLabel", "Email")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("auth:emailPlaceholder", "admin@restaurant.com")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-12"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password" className="text-foreground/80">
                    {t("auth:passwordLabel", "Password")}
                  </Label>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline underline-offset-2"
                    onClick={() => setView("forgot")}
                  >
                    {t("auth:forgotPassword", "Forgot password?")}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("auth:passwordPlaceholder", "••••••••")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="h-12 pr-11"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg hover:bg-muted"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl text-base font-semibold shadow-md shadow-primary/25 gap-2 group"
              >
                {isSubmitting ? (
                  <span>{t("auth:signingIn", "Signing in...")}</span>
                ) : (
                  <>
                    <span>{t("auth:signIn", "Sign In")}</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </Button>
            </form>
          ) : null}

          {view === "forgot" ? (
            <form
              onSubmit={handleForgot}
              className={cn(
                "rounded-3xl border border-border/60 bg-card/80 backdrop-blur-sm",
                "shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] p-6 sm:p-8 space-y-5",
              )}
            >
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
                {t("auth:demoOtpNotice", "Demo mode: OTP for every account is")}{" "}
                <span className="font-mono font-semibold text-foreground">123456</span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">{t("auth:accountEmail", "Account email")}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-12"
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full h-12 rounded-xl gap-2">
                {isSubmitting ? t("auth:sending", "Sending…") : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    {t("auth:continueWithOtp", "Continue with OTP")}
                  </>
                )}
              </Button>
            </form>
          ) : null}

          {view === "reset" ? (
            <form
              onSubmit={handleResetPassword}
              className={cn(
                "rounded-3xl border border-border/60 bg-card/80 backdrop-blur-sm",
                "shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] p-6 sm:p-8 space-y-5",
              )}
            >
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
                {t("auth:demoOtpNotice", "Demo OTP:")} <span className="font-mono font-semibold text-foreground">123456</span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-email">{t("auth:accountEmail", "Email")}</Label>
                <Input id="reset-email" type="email" value={email} disabled className="h-12 bg-muted/40" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="otp">{t("auth:otpLabel", "OTP")}</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                  className="h-12 font-mono tracking-widest"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">{t("auth:newPassword", "New password")}</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="h-12 pr-11"
                    placeholder={t("auth:passwordMinLength", "At least 6 characters")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg"
                    onClick={() => setShowNewPassword((v) => !v)}
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t("auth:confirmPassword", "Confirm password")}</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="h-12"
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full h-12 rounded-xl">
                {isSubmitting ? t("auth:updating", "Updating…") : t("auth:resetPasswordBtn", "Reset password")}
              </Button>
            </form>
          ) : null}

          {view === "login" ? (
            <div className="mt-6 space-y-3">
              <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("auth:demoCredentialsTitle", "Demo login credentials")}
              </p>
              <div className="grid gap-2">
                {DEMO_CREDENTIALS.map((cred) => {
                  const Icon = cred.icon;
                  const label = cred.key === "superAdmin"
                    ? t("auth:superAdminRole", "Super Admin")
                    : "Royal Restaurant";
                  const description = cred.key === "superAdmin"
                    ? t("auth:superAdminDesc", "Full platform access")
                    : t("auth:restaurantAdminDesc", "Restaurant admin");

                  return (
                    <button
                      key={cred.email}
                      type="button"
                      onClick={() => fillCredentials(cred)}
                      className={cn(
                        "w-full rounded-xl border border-border/70 bg-card/90 px-4 py-3 text-left",
                        "hover:border-primary/40 hover:bg-accent/60 transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground">{label}</span>
                            <span className="text-[11px] text-muted-foreground">{t("auth:clickToFill", "Click to fill")}</span>
                          </span>
                          <span className="block text-xs text-muted-foreground">{description}</span>
                          <span className="block font-mono text-xs text-foreground/80 pt-1">
                            {cred.email}
                            <span className="text-muted-foreground"> · </span>
                            {cred.password}
                          </span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {view === "login" ? (
            <p className="text-center text-sm text-muted-foreground mt-6">
              New restaurant?{" "}
              <Link to="/#pricing" className="font-medium text-primary hover:underline">
                Choose a plan &amp; sign up
              </Link>
            </p>
          ) : null}

          <p className="text-center text-sm text-muted-foreground mt-8 lg:mt-10">
            {t("auth:poweredBy", "Powered by AI Ordering System")}
          </p>
        </div>
      </main>
    </div>
  );
}
