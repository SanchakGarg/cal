// Tiny history-API router: no dependency, path patterns with :params.
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface RouterValue {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  back: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPopState = (): void => {
      setLocation({ path: window.location.pathname, search: window.location.search });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    const url = new URL(to, window.location.origin);
    if (options.replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setLocation({ path: url.pathname, search: url.search });
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo<RouterValue>(
    () => ({
      path: location.path,
      search: new URLSearchParams(location.search),
      navigate,
      back: () => window.history.back(),
    }),
    [location, navigate]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used inside RouterProvider");
  return context;
}

export interface RouteMatch {
  params: Record<string, string>;
}

/** `/event-types/:id` style matcher. `*` matches the rest of the path. */
export function matchPath(pattern: string, path: string): RouteMatch | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  const params: Record<string, string> = {};

  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    if (patternPart === "*") {
      params["*"] = pathParts.slice(index).join("/");
      return { params };
    }
    const pathPart = pathParts[index];
    if (pathPart === undefined) return null;
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  if (pathParts.length !== patternParts.length) return null;
  return { params };
}

export function Link({
  to,
  children,
  className,
  onClick,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
