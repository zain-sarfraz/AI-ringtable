import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { changeAppLanguage } from "@/i18n";
import { SUPPORTED_LANGUAGES, getActiveLanguage } from "@/i18n/formatters";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  className?: string;
  showLabel?: boolean;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default" | "lg" | "icon";
}

export function LanguageSwitcher({
  className,
  showLabel = true,
  variant = "ghost",
  size = "default",
}: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const currentLang = getActiveLanguage();
  const currentLangObj =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentLang) || SUPPORTED_LANGUAGES[0];

  const handleToggle = () => {
    const nextLang = currentLang === "fr" ? "en" : "fr";
    changeAppLanguage(nextLang);
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleToggle}
      className={cn(
        "flex h-9 w-9 shrink-0 cursor-pointer select-none items-center justify-center gap-0 rounded-lg border border-border/80 bg-card/80 px-0 text-sm font-medium shadow-xs transition-all hover:bg-muted/80 active:scale-95 sm:h-10 sm:w-auto sm:gap-2 sm:px-3",
        className
      )}
      title={`Current: ${currentLangObj.name}. Click to switch to ${currentLang === "fr" ? "English" : "Français"}`}
      aria-label="Toggle Language"
    >
      <Globe className="h-4 w-4 shrink-0 text-primary" />
      {showLabel ? (
        <span className="hidden font-semibold text-foreground text-xs sm:inline sm:text-sm">
          {currentLangObj.name}
        </span>
      ) : null}
    </Button>
  );
}
