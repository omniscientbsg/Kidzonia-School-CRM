import {
  Alert,
  Anchor,
  Button,
  Group,
  PasswordInput,
  PinInput,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  OTP_LENGTH,
  formatMobile,
  mobileSchema,
  requestCodeResponseSchema,
  signInResultSchema,
} from '@kidzonia/shared';
import type { SignInResult } from '@kidzonia/shared';
import { IconAlertCircle } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ApiError, api } from '../api/client';
import { LAST_ORGANISATION_KEY, readLocal, writeLocal } from '../lib/storage';
import { useSession } from './session';

type Step =
  | { kind: 'mobile' }
  | { kind: 'code'; mobile: string; challengeId: string; resendAt: number }
  | { kind: 'password' }
  | {
      kind: 'organisation';
      selectionToken: string;
      organisations: { id: string; name: string }[];
    };

function messageOf(err: unknown): { message: string; fields: Record<string, string> } {
  if (err instanceof ApiError) return { message: err.message, fields: err.fields };
  return {
    message: 'We couldn’t reach Kidzonia 360. Check your connection and try again.',
    fields: {},
  };
}

/** Only same-app paths are allowed after sign-in, never another site. */
function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const { state, completeSignIn } = useSession();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: 'mobile' });
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (step.kind !== 'code') return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [step.kind]);

  if (state === 'signed_in') return <Navigate to={safeNext(params.get('next'))} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (err) {
      const { message, fields } = messageOf(err);
      setError(message);
      setFieldErrors(fields);
    } finally {
      setBusy(false);
    }
  };

  const finish = (result: SignInResult) => {
    if (result.status === 'signed_in') {
      completeSignIn(result.accessToken);
      return;
    }
    const last = readLocal(LAST_ORGANISATION_KEY);
    setOrganisationId(result.organisations.some((o) => o.id === last) ? last : null);
    setStep({
      kind: 'organisation',
      selectionToken: result.selectionToken,
      organisations: result.organisations,
    });
  };

  const checkMobile = (): string | null => {
    const parsed = mobileSchema.safeParse(mobile);
    if (parsed.success) return parsed.data;
    setFieldErrors({ mobile: parsed.error.issues[0]?.message ?? 'Enter a valid mobile number' });
    return null;
  };

  const sendCode = (e?: SubmitEvent) => {
    e?.preventDefault();
    const m = checkMobile();
    if (!m) return;
    void run(async () => {
      const res = await api('/auth/request-code', requestCodeResponseSchema, {
        method: 'POST',
        body: { mobile: m },
        noRefresh: true,
      });
      setCode('');
      setStep({
        kind: 'code',
        mobile: m,
        challengeId: res.challengeId,
        resendAt: Date.now() + res.resendIn * 1000,
      });
    });
  };

  const verify = (e?: SubmitEvent) => {
    e?.preventDefault();
    if (step.kind !== 'code') return;
    if (code.length !== OTP_LENGTH) {
      setFieldErrors({ code: `Enter the ${OTP_LENGTH}-digit code` });
      return;
    }
    void run(async () => {
      finish(
        await api('/auth/verify-code', signInResultSchema, {
          method: 'POST',
          body: { challengeId: step.challengeId, code },
          noRefresh: true,
        }),
      );
    });
  };

  const passwordLogin = (e: SubmitEvent) => {
    e.preventDefault();
    const m = checkMobile();
    if (!m) return;
    void run(async () => {
      finish(
        await api('/auth/login', signInResultSchema, {
          method: 'POST',
          body: { mobile: m, password },
          noRefresh: true,
        }),
      );
    });
  };

  const choose = (e: SubmitEvent) => {
    e.preventDefault();
    if (step.kind !== 'organisation') return;
    if (!organisationId) {
      setFieldErrors({ organisation: 'Choose an organisation' });
      return;
    }
    void run(async () => {
      const result = await api('/auth/select-organisation', signInResultSchema, {
        method: 'POST',
        body: { selectionToken: step.selectionToken, organisationId },
        noRefresh: true,
      });
      writeLocal(LAST_ORGANISATION_KEY, organisationId);
      finish(result);
    });
  };

  const alert = error ? (
    <Alert color="red" icon={<IconAlertCircle size={18} />} role="alert">
      {error}
    </Alert>
  ) : null;

  const resendIn = step.kind === 'code' ? Math.max(0, Math.ceil((step.resendAt - now) / 1000)) : 0;

  return (
    <div className="signin">
      <section className="signin-art" aria-hidden="true">
        <div className="signin-logo">
          <span className="mark">K</span>
          <span>Kidzonia 360</span>
        </div>
        <div>
          <h2>Everything your schools run on, in one place.</h2>
          <p>
            Tasks, people and permissions today. HRMS, admissions and fees next, all with the same
            login.
          </p>
        </div>
      </section>

      <main className="signin-form">
        {step.kind === 'mobile' && (
          <form onSubmit={sendCode} noValidate>
            <Stack gap="md">
              <div>
                <Title order={1} className="signin-title">
                  Sign in
                </Title>
                <Text c="dimmed">We’ll text a 6-digit code to your mobile.</Text>
              </div>
              {alert}
              <TextInput
                label="Mobile number"
                placeholder="98480 11201"
                inputMode="tel"
                autoComplete="tel"
                size="md"
                value={mobile}
                onChange={(e) => {
                  setMobile(e.currentTarget.value);
                }}
                error={fieldErrors.mobile}
                required
                data-autofocus
              />
              <Button type="submit" size="md" loading={busy}>
                Send code
              </Button>
              <Anchor
                component="button"
                type="button"
                onClick={() => {
                  setError(null);
                  setFieldErrors({});
                  setStep({ kind: 'password' });
                }}
              >
                Sign in with a password instead
              </Anchor>
              <Text size="sm" c="dimmed">
                New to Kidzonia 360?{' '}
                <Anchor component={Link} to="/register" underline="always">
                  Set up your school
                </Anchor>
              </Text>
            </Stack>
          </form>
        )}

        {step.kind === 'code' && (
          <form onSubmit={verify} noValidate>
            <Stack gap="md">
              <div>
                <Title order={1} className="signin-title">
                  Enter your code
                </Title>
                <Text c="dimmed">We sent a code to {formatMobile(step.mobile)}.</Text>
              </div>
              {alert}
              <div>
                <Text component="label" htmlFor="otp" fw={600} size="sm">
                  6-digit code
                </Text>
                <PinInput
                  id="otp"
                  length={OTP_LENGTH}
                  type="number"
                  oneTimeCode
                  size="lg"
                  value={code}
                  onChange={setCode}
                  onComplete={(v) => {
                    setCode(v);
                  }}
                  error={Boolean(fieldErrors.code)}
                  aria-label="6-digit code"
                  mt={6}
                />
                {fieldErrors.code && (
                  <Text c="red" size="sm" mt={4}>
                    {fieldErrors.code}
                  </Text>
                )}
              </div>
              <Button type="submit" size="md" loading={busy}>
                Sign in
              </Button>
              <Group justify="space-between">
                <Anchor
                  component="button"
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep({ kind: 'mobile' });
                  }}
                >
                  Change number
                </Anchor>
                <Anchor
                  component="button"
                  type="button"
                  disabled={resendIn > 0 || busy}
                  onClick={() => {
                    sendCode();
                  }}
                >
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </Anchor>
              </Group>
            </Stack>
          </form>
        )}

        {step.kind === 'password' && (
          <form onSubmit={passwordLogin} noValidate>
            <Stack gap="md">
              <div>
                <Title order={1} className="signin-title">
                  Sign in with a password
                </Title>
                <Text c="dimmed">Only if you have set one up.</Text>
              </div>
              {alert}
              <TextInput
                label="Mobile number"
                inputMode="tel"
                autoComplete="username"
                size="md"
                value={mobile}
                onChange={(e) => {
                  setMobile(e.currentTarget.value);
                }}
                error={fieldErrors.mobile}
                required
              />
              <PasswordInput
                label="Password"
                autoComplete="current-password"
                size="md"
                value={password}
                onChange={(e) => {
                  setPassword(e.currentTarget.value);
                }}
                error={fieldErrors.password}
                required
              />
              <Button type="submit" size="md" loading={busy}>
                Sign in
              </Button>
              <Anchor
                component="button"
                type="button"
                onClick={() => {
                  setError(null);
                  setStep({ kind: 'mobile' });
                }}
              >
                Use a code instead
              </Anchor>
            </Stack>
          </form>
        )}

        {step.kind === 'organisation' && (
          <form onSubmit={choose} noValidate>
            <Stack gap="md">
              <div>
                <Title order={1} className="signin-title">
                  Choose an organisation
                </Title>
                <Text c="dimmed">
                  Your number is used in more than one. Which one do you want to open?
                </Text>
              </div>
              {alert}
              <Radio.Group
                value={organisationId}
                onChange={setOrganisationId}
                label="Organisation"
                error={fieldErrors.organisation}
              >
                <Stack gap="xs" mt="xs">
                  {step.organisations.map((o) => (
                    <Radio.Card key={o.id} value={o.id} className="org-card" radius="md">
                      <Group wrap="nowrap" gap="md">
                        <Radio.Indicator />
                        <Text fw={600}>{o.name}</Text>
                      </Group>
                    </Radio.Card>
                  ))}
                </Stack>
              </Radio.Group>
              <Button type="submit" size="md" loading={busy}>
                Continue
              </Button>
            </Stack>
          </form>
        )}
      </main>
    </div>
  );
}
