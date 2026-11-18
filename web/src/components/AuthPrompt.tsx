import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Sheet } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import type { AuthConfig } from "@/lib/types";

/** Sign-in prompt for guests: Google right away, email sign-in or sign-up below. */
export function AuthPrompt({ reason, returnTo, onClose }: { reason: string | null; returnTo: () => string; onClose: () => void }) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  useEffect(() => {
    if (reason && !cfg) api.authConfig().then(setCfg).catch(() => {});
  }, [reason, cfg]);
  const ret = reason ? encodeURIComponent(returnTo()) : "";
  return (
    <Sheet open={!!reason} onOpenChange={(o) => !o && onClose()} title="Войдите в аккаунт" description={reason ?? ""}>
      <div className="flex flex-col gap-3">
        {cfg?.google ? (
          <a
            href={`/auth/google/start?return=${ret}`}
            className="flex h-12 items-center justify-center gap-3 rounded-2xl bg-accent text-[15px] font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            <span className="grid size-6 place-items-center rounded-full bg-white">
              <img src="/google.svg" alt="" className="size-4" />
            </span>
            Продолжить с Google
          </a>
        ) : null}
        <Link
          to={`/login?return=${ret}`}
          onClick={onClose}
          className="flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-surface-2 text-[15px] font-medium transition-colors hover:bg-line"
        >
          <Mail className="size-[18px]" /> Войти по почте
        </Link>
        <p className="mt-6 text-center text-[14px] leading-relaxed text-ink-2">
          Нет аккаунта?{" "}
          <Link to={`/register?return=${ret}`} onClick={onClose} className="font-medium text-accent hover:underline">
            Зарегистрироваться
          </Link>{" "}
          — без подтверждения почты
        </p>
      </div>
    </Sheet>
  );
}
