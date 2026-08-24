import { useState } from "react";
import { Button } from "../ui/Button.tsx";
import { TextField } from "../ui/Field.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toast.tsx";
import { useAuth } from "../app/auth.tsx";
import { useRouter } from "../app/router.tsx";
import { browserTimeZone } from "../lib/time.ts";
import { errorMessage } from "../lib/api.ts";
import "./LoginPage.css";

export function LoginPage() {
  const { providers, loginAsGuest } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const oidcEnabled = providers?.oidc.enabled ?? false;
  const guestEnabled = providers?.guest.enabled ?? false;

  const onGuest = async (): Promise<void> => {
    setLoading(true);
    try {
      const me = await loginAsGuest({
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        timeZone: browserTimeZone(),
      });
      navigate(me.completedOnboarding ? "/event-types" : "/getting-started");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cal-auth">
      <div className="cal-auth__card cal-card">
        <div className="cal-auth__head">
          <span className="cal-auth__logo">Cal</span>
          <h1>Welcome back</h1>
          <p className="cal-muted">Sign in to manage your availability and bookings.</p>
        </div>

        {oidcEnabled ? (
          <a className="cal-auth__oidc" href={providers?.oidc.authorizeUrl}>
            <Icon name="globe" size={16} />
            Continue with {providers?.oidc.label ?? "SSO"}
          </a>
        ) : null}

        {oidcEnabled && guestEnabled ? (
          <div className="cal-auth__divider">
            <span>or</span>
          </div>
        ) : null}

        {guestEnabled ? (
          <form
            className="cal-auth__form"
            onSubmit={(event) => {
              event.preventDefault();
              void onGuest();
            }}
          >
            <TextField
              label="Name"
              placeholder="Ada Lovelace"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label="Email"
              type="email"
              placeholder="you@example.com (optional)"
              hint="Leave empty to get a throwaway guest account."
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" size="lg" loading={loading} className="cal-auth__submit">
              Continue as guest
            </Button>
          </form>
        ) : null}

        {!oidcEnabled && !guestEnabled ? (
          <p className="cal-auth__disabled">
            No login method is enabled. Set <code>AUTH_OIDC_ENABLED</code> or{" "}
            <code>AUTH_GUEST_ENABLED</code> in the API environment.
          </p>
        ) : null}
      </div>
    </div>
  );
}
