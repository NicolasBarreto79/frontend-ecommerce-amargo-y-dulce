"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Container } from "./Container";
import {
  Search,
  ShoppingCart,
  User,
  Menu,
  X,
  Package,
  LogOut,
} from "lucide-react";
import { LoginModal } from "@/components/auth/LoginModal";
import { CartBadge } from "@/components/cart/CartBadge";

type Suggestion = {
  id: string | number | null;
  title: string;
  price: number | null;
  slug: string | null;
};

type MeResponse = { user: any | null };

function formatARS(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function NavLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="text-[15px] font-medium text-neutral-800 hover:text-neutral-950 transition"
    >
      {children}
    </Link>
  );
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // ✅ auth
  const [meLoading, setMeLoading] = useState(true);
  const [me, setMe] = useState<any | null>(null);

  async function refreshMe() {
    setMeLoading(true);
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      const j: MeResponse = await r.json().catch(() => ({ user: null }));
      setMe(j.user ?? null);
    } catch {
      setMe(null);
    } finally {
      setMeLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      setLoginOpen(false);
    }
  }

  useEffect(() => {
    refreshMe();

    const onFocus = () => refreshMe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ✅ buscador (desktop + mobile comparten estado)
  const [query, setQuery] = useState("");

  // ✅ autocomplete state
  const [openSuggest, setOpenSuggest] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  // ✅ refs separados para evitar conflictos desktop vs mobile
  const suggestBoxRefDesktop = useRef<HTMLDivElement | null>(null);
  const suggestBoxRefMobile = useRef<HTMLDivElement | null>(null);

  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ESC cierra menú mobile, modal login y sugerencias
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        setLoginOpen(false);
        setOpenSuggest(false);
        setActiveIndex(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ✅ click afuera: cierra sugerencias (desktop + mobile)
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const elD = suggestBoxRefDesktop.current;
      const elM = suggestBoxRefMobile.current;

      const insideDesktop = elD?.contains(e.target as Node);
      const insideMobile = elM?.contains(e.target as Node);

      if (!insideDesktop && !insideMobile) {
        setOpenSuggest(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // ✅ si estoy en /productos, sincronizo el input con ?q=
  useEffect(() => {
    if (pathname === "/productos") {
      setQuery(sp.get("q") || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, sp]);

  function goSearch(raw: string) {
    const q = raw.trim();
    setMobileOpen(false);
    setOpenSuggest(false);
    setActiveIndex(-1);

    if (!q) {
      router.push("/productos");
      return;
    }

    router.push(`/productos?q=${encodeURIComponent(q)}`);
  }

  async function fetchSuggest(q: string) {
    const qq = q.trim();
    if (qq.length < 2) {
      setSuggestions([]);
      setLoadingSuggest(false);
      return;
    }

    setLoadingSuggest(true);
    try {
      const r = await fetch(`/api/search/suggest?q=${encodeURIComponent(qq)}`, {
        cache: "no-store",
      });
      const data = await r.json();
      const res = Array.isArray(data?.results) ? data.results.slice(0, 5) : [];
      setSuggestions(res);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggest(false);
    }
  }

  function onChangeQuery(next: string) {
    setQuery(next);
    setOpenSuggest(true);
    setActiveIndex(-1);

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetchSuggest(next);
    }, 250);
  }

  function onKeyDownSearch(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter siempre va a /productos?q=
    if (e.key === "Enter") {
      e.preventDefault();
      goSearch(query);
      return;
    }

    if (!openSuggest) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => {
        const max = suggestions.length - 1;
        const next = i + 1;
        return next > max ? max : next;
      });
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = i - 1;
        return next < -1 ? -1 : next;
      });
    }

    if (e.key === "Tab") {
      setOpenSuggest(false);
      setActiveIndex(-1);
    }
  }

  function pickSuggestion(s: Suggestion) {
    setQuery(s.title);
    setOpenSuggest(false);
    setActiveIndex(-1);

    const idNum = Number(s.id);
    if (Number.isFinite(idNum) && idNum > 0) {
      router.push(`/productos/${idNum}`);
      return;
    }

    goSearch(s.title);
  }

  function SearchBox({ variant }: { variant: "desktop" | "mobile" }) {
    const showDropdown = openSuggest && query.trim().length >= 2;

    const ref =
      variant === "desktop" ? suggestBoxRefDesktop : suggestBoxRefMobile;

    return (
      <div ref={ref} className="relative w-full">
        <form
          className={
            variant === "desktop" ? "relative w-full max-w-[760px]" : "relative"
          }
          onSubmit={(e) => {
            e.preventDefault();
            goSearch(query);
          }}
        >
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
            onFocus={() => {
              setOpenSuggest(true);
              if (query.trim().length >= 2) fetchSuggest(query);
            }}
            onKeyDown={onKeyDownSearch}
            placeholder="Buscá tu producto"
            className={
              variant === "desktop"
                ? "h-11 w-full rounded-full border border-neutral-300 bg-white pl-12 pr-4 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
                : "h-11 w-full rounded-full border border-neutral-300 bg-white pl-12 pr-4 text-[15px] focus:outline-none"
            }
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            aria-controls={
              variant === "desktop" ? "suggestions-desktop" : "suggestions-mobile"
            }
          />
        </form>

        {showDropdown && (
          <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
            <div className="px-4 py-2 text-xs text-neutral-500">
              {loadingSuggest
                ? "Buscando..."
                : suggestions.length
                ? "Sugerencias"
                : "Sin resultados"}
            </div>

            <ul
              id={variant === "desktop" ? "suggestions-desktop" : "suggestions-mobile"}
              role="listbox"
              className="max-h-80 overflow-auto"
            >
              {suggestions.map((s, idx) => (
                <li key={String(s.id ?? s.slug ?? s.title)}>
                  <button
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={[
                      "flex w-full items-center justify-between px-4 py-2 text-left text-sm",
                      idx === activeIndex ? "bg-neutral-50" : "bg-white",
                      "hover:bg-neutral-50",
                    ].join(" ")}
                  >
                    <span className="truncate">{s.title}</span>
                    {typeof s.price === "number" && (
                      <span className="ml-3 shrink-0 text-xs text-neutral-600">
                        {formatARS(s.price)}
                      </span>
                    )}
                  </button>
                </li>
              ))}

              <li className="border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => goSearch(query)}
                  className="w-full px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  Ver todos los resultados →
                </button>
              </li>
            </ul>
          </div>
        )}
      </div>
    );
  }

  const displayName =
    me?.username ||
    me?.name ||
    (typeof me?.email === "string" ? me.email.split("@")[0] : null) ||
    "Cuenta";

  return (
    <header
      className={[
        "sticky top-0 z-50 border-b bg-white/95 backdrop-blur transition-shadow",
        scrolled ? "shadow-sm" : "shadow-none",
      ].join(" ")}
    >
      <Container>
        <div className="grid h-[72px] grid-cols-[auto_1fr_auto] items-center gap-6">
          {/* IZQUIERDA */}
          <div className="flex items-center gap-6">
            <Link href="/" className="leading-none">
              <div className="text-[22px] font-extrabold tracking-tight text-neutral-900">
                Amargo
              </div>
              <div className="text-[22px] font-extrabold tracking-tight text-neutral-900">
                y Dulce
              </div>
            </Link>

            <nav className="hidden items-center gap-4 md:flex">
              <span className="text-neutral-300">|</span>
              <NavLink href="/productos">Productos</NavLink>
              <span className="text-neutral-300">|</span>
              <NavLink href="/promociones">Promociones</NavLink>
              <span className="text-neutral-300">|</span>
              <NavLink href="/sobre-nosotros">Sobre nosotros</NavLink>
            </nav>
          </div>

          {/* CENTRO */}
          <div className="hidden lg:flex justify-center">
            <div className="relative w-full max-w-[760px]">
              {SearchBox({ variant: "desktop" })}
            </div>
          </div>

          {/* DERECHA */}
          <div className="hidden items-center gap-4 md:flex">
            <div className="h-6 w-px bg-neutral-200" />

            <div className="relative">
              {!me && !meLoading ? (
                <>
                  <button
                    onClick={() => setLoginOpen((v) => !v)}
                    className="flex items-center gap-2 text-[15px] font-medium text-neutral-800 hover:text-neutral-950"
                    type="button"
                    aria-expanded={loginOpen}
                  >
                    <User className="h-5 w-5" />
                    Iniciar sesión
                  </button>

                  <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-[15px] font-medium text-neutral-800">
                    <User className="h-5 w-5" />
                    {meLoading ? "Cargando…" : `Hola, ${displayName}`}
                  </div>

                  {!meLoading && (
                    <button
                      onClick={logout}
                      className="inline-flex items-center gap-2 text-[13px] text-neutral-700 hover:text-neutral-900 underline"
                      type="button"
                    >
                      <LogOut className="h-4 w-4" />
                      Cerrar sesión
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="h-6 w-px bg-neutral-200" />

            {/* ✅ Mis pedidos SOLO si está logueado */}
            {me && !meLoading && (
              <>
                <Link
                  href="/mis-pedidos"
                  className="flex items-center gap-2 text-[15px] font-medium text-neutral-800 hover:text-neutral-950 transition"
                >
                  <Package className="h-5 w-5" />
                  Mis pedidos
                </Link>

                <div className="h-6 w-px bg-neutral-200" />
              </>
            )}

            <Link
              href="/carrito"
              className="relative flex items-center gap-2 text-[15px] font-medium text-neutral-800 hover:text-neutral-950"
            >
              <span className="relative inline-flex">
                <ShoppingCart className="h-5 w-5" />
                <CartBadge />
              </span>
              Carrito
            </Link>
          </div>

          {/* MOBILE */}
          <div className="flex items-center justify-end gap-2 md:hidden">
            <Link
              href="/carrito"
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 bg-white"
              aria-label="Carrito"
            >
              <ShoppingCart className="h-5 w-5" />
              <CartBadge />
            </Link>

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 bg-white"
              aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileOpen}
              type="button"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t bg-white md:hidden">
            <div className="py-4">
              {SearchBox({ variant: "mobile" })}

              <nav className="mt-4 flex flex-col gap-3">
                <NavLink href="/productos" onClick={() => setMobileOpen(false)}>
                  Productos
                </NavLink>
                <NavLink href="/promociones" onClick={() => setMobileOpen(false)}>
                  Promociones
                </NavLink>
                <NavLink href="/sobre-nosotros" onClick={() => setMobileOpen(false)}>
                  Sobre nosotros
                </NavLink>

                {/* ✅ Mis pedidos SOLO si está logueado */}
                {me && !meLoading && (
                  <NavLink href="/mis-pedidos" onClick={() => setMobileOpen(false)}>
                    Mis pedidos
                  </NavLink>
                )}
              </nav>

              <div className="mt-4 flex gap-3">
                {!me && !meLoading ? (
                  <button
                    onClick={() => {
                      setMobileOpen(false);
                      setLoginOpen(true);
                    }}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white text-[15px] font-medium"
                    type="button"
                  >
                    <User className="h-5 w-5" />
                    Iniciar sesión
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setMobileOpen(false);
                      logout();
                    }}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white text-[15px] font-medium"
                    type="button"
                    disabled={meLoading}
                  >
                    <LogOut className="h-5 w-5" />
                    {meLoading ? "Cargando…" : "Cerrar sesión"}
                  </button>
                )}

                <Link
                  href="/carrito"
                  onClick={() => setMobileOpen(false)}
                  className="relative flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white text-[15px] font-medium"
                >
                  <span className="relative inline-flex">
                    <ShoppingCart className="h-5 w-5" />
                    <CartBadge />
                  </span>
                  Carrito
                </Link>
              </div>
            </div>
          </div>
        )}
      </Container>
    </header>
  );
}
