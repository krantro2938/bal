import { useEffect, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PixelSky } from "@/components/PixelSky";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AuthConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

const oauthErrors: Record<string, string> = {
  unavailable: "Этот способ входа на сервере пока не настроен. Попробуйте другой.",
  expired: "Вход занял слишком много времени. Попробуйте ещё раз.",
  denied: "Вход отменён.",
  state: "Ссылка для входа устарела. Попробуйте ещё раз.",
  google: "Google не подтвердил вход. Попробуйте ещё раз чуть позже.",
  server: "Не удалось сохранить вход. Попробуйте ещё раз.",
};

function safeReturn(p: string | null) {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/me";
}

function useAuthPage(title: string) {
  const [params] = useSearchParams();
  const ret = safeReturn(params.get("return"));
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  useEffect(() => {
    document.title = `${title} · Звёздная одиссея`;
    api.authConfig().then(setCfg).catch(() => setCfg({ google: false, password: true, dev: false }));
  }, [title]);
  useEffect(() => {
    if (user) navigate(ret, { replace: true });
  }, [user, ret, navigate]);
  return { ret, cfg, refresh, error: params.get("error") };
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid min-h-[calc(100dvh-72px)] overflow-hidden md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Art panel: the posters' night sky as pixel art, slanted on its right edge */}
      <div className="relative h-56 md:h-auto md:py-4">
        <div className="absolute inset-0 overflow-hidden rounded-b-[32px] md:inset-y-4 md:-left-24 md:right-6 md:-skew-x-[7deg] md:rounded-[40px]">
          <div className="absolute inset-0 md:-inset-x-16 md:skew-x-[7deg]">
            <PixelSky className="size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#05091a]/90 via-[#05091a]/10 to-[#05091a]/30" />
          </div>
        </div>
        <div className="relative flex h-full flex-col justify-between p-6 text-[#ece6d6] md:py-12 md:pr-24 md:pl-12">
          <span className="font-display text-[20px] font-semibold italic">Звёздная одиссея</span>
          <div className="hidden md:block">
            <p className="font-display text-[44px] leading-[1.05] font-semibold italic">«Всё начинается с&nbsp;мечты о&nbsp;звёздах»</p>
            <p className="mt-4 max-w-[36ch] text-[16px] text-[#ece6d6]/75">
              14-й Традиционный бал РТУ МИРЭА. Репетируйте дома: видео, схемы и ваши заметки — на всех устройствах.
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex justify-center px-6 py-10 sm:px-10 md:items-center md:py-12">
        <div className="w-full max-w-[420px]">
          <h1 className="font-title text-[36px] leading-tight sm:text-[44px]">{title}</h1>
          <p className="mt-2 text-[16px] text-ink-2">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </main>
  );
}

function ProviderButtons({ cfg, ret }: { cfg: AuthConfig | null; ret: string }) {
  if (!cfg) return <div className="h-[52px] rounded-2xl bg-surface-2" />;
  const providers = [
    cfg.google && { id: "google", label: "Продолжить с Google", icon: "/google.svg" },
  ].filter(Boolean) as { id: string; label: string; icon: string }[];
  if (!providers.length) return null;
  return (
    <>
      <div className="flex flex-col gap-2.5">
        {providers.map((p) => (
          <a
            key={p.id}
            href={`/auth/${p.id}/start?return=${encodeURIComponent(ret)}`}
            className="flex h-[52px] items-center justify-center gap-3 rounded-2xl border border-line-strong bg-bg text-[15px] font-medium transition-colors hover:bg-hover"
          >
            <img src={p.icon} alt="" className="size-5" />
            {p.label}
          </a>
        ))}
      </div>
      <div className="my-6 flex items-center gap-3 text-[13px] text-ink-3">
        <span className="h-px flex-1 bg-line" />
        или по почте
        <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

function Field({ label, error, hint, ...input }: { label: string; error?: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="mb-2 block text-[14px] font-medium text-ink-2">{label}</span>
      <input
        {...input}
        className={cn(
          "h-[52px] w-full rounded-2xl border bg-surface px-4 text-[16px] text-ink transition-colors placeholder:text-ink-3 focus:bg-bg focus:outline-none",
          error ? "border-danger" : "border-line focus:border-line-strong",
        )}
      />
      {error ? <span className="mt-1.5 block text-[13px] text-danger">{error}</span> : hint ? <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Login() {
  const { ret, cfg, refresh, error } = useAuthPage("Вход");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(error ? (oauthErrors[error] ?? oauthErrors.server) : null);
  const [devName, setDevName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.login({ email, password });
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="С возвращением" subtitle="Заметки, избранное и прогресс — на всех ваших устройствах.">
      <ProviderButtons cfg={cfg} ret={ret} />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Почта" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <Field label="Пароль" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {formError ? (
          <p role="alert" className="text-[14px] text-danger">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="!mt-6 h-[52px] w-full rounded-2xl text-base" disabled={busy}>
          Войти
        </Button>
      </form>
      <p className="mt-6 text-center text-[15px] text-ink-2">
        Нет аккаунта?{" "}
        <Link to={`/register?return=${encodeURIComponent(ret)}`} className="font-medium text-accent hover:underline">
          Зарегистрироваться
        </Link>
      </p>

      {cfg?.dev ? (
        <form
          className="mt-6 border-t border-dashed border-line-strong pt-5"
          onSubmit={async (e) => {
            e.preventDefault();
            await api.devLogin(devName);
            await refresh();
          }}
        >
          <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Локальная разработка</p>
          <div className="mt-2 flex gap-2">
            <Input value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="Имя тестового пользователя" className="rounded-2xl" />
            <Button type="submit" disabled={!devName.trim()}>
              Войти
            </Button>
          </div>
        </form>
      ) : null}

      <Link to={ret === "/me" ? "/" : ret} className="mt-6 block text-center text-[14px] text-ink-3 hover:text-ink">
        Продолжить без входа
      </Link>
    </AuthCard>
  );
}

export function Register() {
  const { ret, cfg, refresh } = useAuthPage("Регистрация");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.register({ name, email, password });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? { field: e.field, message: e.message } : { message: "Не удалось зарегистрироваться" });
    } finally {
      setBusy(false);
    }
  }

  const fieldErr = (f: string) => (err?.field === f ? err.message : undefined);
  return (
    <AuthCard title="Регистрация" subtitle="Без подтверждения почты — сразу после регистрации вы на сайте.">
      <ProviderButtons cfg={cfg} ret={ret} />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Имя" error={fieldErr("name")} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Как к вам обращаться" />
        <Field label="Почта" error={fieldErr("email")} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <Field label="Пароль" error={fieldErr("password")} hint="Не короче 8 символов" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && !err.field ? (
          <p role="alert" className="text-[14px] text-danger">
            {err.message}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="!mt-6 h-[52px] w-full rounded-2xl text-base" disabled={busy}>
          Создать аккаунт
        </Button>
      </form>
      <p className="mt-6 text-center text-[15px] text-ink-2">
        Уже есть аккаунт?{" "}
        <Link to={`/login?return=${encodeURIComponent(ret)}`} className="font-medium text-accent hover:underline">
          Войти
        </Link>
      </p>
    </AuthCard>
  );
}
