import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

const NotFound = () => {
  const { t } = useTranslation(["auth", "common"]);
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4 sm:px-6 py-6">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-8 shadow-xs text-center space-y-4">
        <h1 className="text-5xl font-extrabold text-foreground">404</h1>
        <p className="text-xl font-semibold text-foreground">{t("auth:pageNotFound", "Page Not Found")}</p>
        <p className="text-sm text-muted-foreground">
          {t("auth:pageNotFoundDesc", "The page you are looking for does not exist or has been moved.")}
        </p>
        <div className="pt-2">
          <Link to="/" className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90">
            {t("auth:returnToDashboard", "Return to Dashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;

