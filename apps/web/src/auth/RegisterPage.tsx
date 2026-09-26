import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Chip,
  Group,
  PasswordInput,
  PinInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  OTP_LENGTH,
  mobileSchema,
  registerSchema,
  registerVerifyResponseSchema,
  requestCodeResponseSchema,
  signInResultSchema,
} from '@kidzonia/shared';
import {
  IconAlertCircle,
  IconBuilding,
  IconCheck,
  IconPlus,
  IconSchool,
  IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../ui/errors';
import { useSession } from './session';
import { ApiError } from '../api/client';

type SetupType = 'single_school' | 'head_office';
type SchoolModel = 'coco' | 'franchise' | 'both';
interface SchoolRow {
  name: string;
  city: string;
  type: 'coco' | 'franchise';
  ownerName: string;
  ownerMobile: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const blankSchool = (): SchoolRow => ({
  name: '',
  city: '',
  type: 'coco',
  ownerName: '',
  ownerMobile: '',
});

/** Organisation sign-up (brief 8.1), laid out like the demo. */
export function RegisterPage() {
  const { state, completeSignIn } = useSession();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Step 1
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Step 2
  const [setupType, setSetupType] = useState<SetupType>('head_office');
  const [schoolModel, setSchoolModel] = useState<SchoolModel>('both');
  // Step 3
  const [orgName, setOrgName] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [days, setDays] = useState(['1', '2', '3', '4', '5', '6']);
  const [opensAt, setOpensAt] = useState('08:00');
  const [closesAt, setClosesAt] = useState('16:00');
  // Step 4
  const [schools, setSchools] = useState<SchoolRow[]>([blankSchool()]);

  if (state === 'signed_in') return <Navigate to="/" replace />;

  const isHO = setupType === 'head_office';
  const steps = [
    'About you',
    'What you are setting up',
    isHO ? 'Your organisation' : 'Your school',
    ...(isHO ? ['Your schools'] : []),
  ];
  const last = step === steps.length;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () => {
    const m = mobileSchema.safeParse(mobile);
    if (!m.success) {
      setFields({ mobile: 'Enter a valid mobile number' });
      return;
    }
    void run(async () => {
      const res = await api('/register/request-code', requestCodeResponseSchema, {
        method: 'POST',
        body: { mobile },
        noRefresh: true,
      });
      setChallengeId(res.challengeId);
      setCode('');
    });
  };
  const verify = () => {
    void run(async () => {
      const res = await api('/register/verify-code', registerVerifyResponseSchema, {
        method: 'POST',
        body: { challengeId, code },
        noRefresh: true,
      });
      setToken(res.registrationToken);
    });
  };

  const body = () => ({
    registrationToken: token ?? '',
    fullName,
    email: email || null,
    password,
    setupType,
    schoolModel: isHO ? schoolModel : 'coco',
    organisation: {
      name: orgName,
      city,
      state: stateName || null,
      workingDays: days.map(Number),
      opensAt,
      closesAt,
    },
    schools: isHO
      ? schools
          .filter((s) => s.name.trim())
          .map((s) => ({
            name: s.name,
            city: s.city || city,
            type: s.type,
            owner:
              s.type === 'franchise' && s.ownerName && s.ownerMobile
                ? { fullName: s.ownerName, mobile: s.ownerMobile }
                : null,
          }))
      : [],
  });

  /** The first problem on the current step, if any. */
  const stepProblem = (): { error?: string; fields?: Record<string, string> } | null => {
    if (step === 1) {
      if (!token) return { error: 'Verify your mobile number first.' };
      if (!fullName.trim()) return { fields: { fullName: 'Enter your full name' } };
      if (password.length < 8) return { fields: { password: 'Use at least 8 characters' } };
    }
    if (step === 3) {
      if (!orgName.trim()) {
        return {
          fields: {
            'organisation.name': `Enter a name for your ${isHO ? 'organisation' : 'school'}`,
          },
        };
      }
      if (!city.trim()) return { fields: { 'organisation.city': 'Enter the city' } };
    }
    return null;
  };

  const next = (skipSchools = false) => {
    setError(null);
    const problem = stepProblem();
    if (problem) {
      setError(problem.error ?? null);
      setFields(problem.fields ?? {});
      return;
    }
    if (!last) {
      setStep(step + 1);
      return;
    }
    if (skipSchools) setSchools([]);
    const input = skipSchools ? { ...body(), schools: [] } : body();
    // The same schema the server uses, so mistakes show before sending.
    const check = registerSchema.safeParse(input);
    if (!check.success) {
      setFields(Object.fromEntries(check.error.issues.map((i) => [i.path.join('.'), i.message])));
      setError(check.error.issues[0]?.message ?? 'Please check the details.');
      return;
    }
    void run(async () => {
      const res = await api('/register', signInResultSchema, {
        method: 'POST',
        body: input,
        noRefresh: true,
      });
      if (res.status === 'signed_in') completeSignIn(res.accessToken);
    });
  };

  const setSchool = (i: number, patch: Partial<SchoolRow>) => {
    setSchools(schools.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };

  return (
    <div className="signin">
      <section className="signin-art">
        <div className="signin-logo" aria-hidden="true">
          <span className="mark">K</span>
          <span>Kidzonia 360</span>
        </div>
        <div>
          <h2>Run every school from one place.</h2>
          <p>
            Set up your schools, add your people, decide who sees what, and start handing out tasks.
          </p>
          <ol className="steps" aria-label="Sign-up steps">
            {steps.map((s, i) => (
              <li
                key={s}
                className={`${i + 1 === step ? 'on' : ''} ${i + 1 < step ? 'done' : ''}`}
                aria-current={i + 1 === step ? 'step' : undefined}
              >
                <i aria-hidden="true">{i + 1 < step ? <IconCheck size={14} /> : i + 1}</i>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <p className="small step-count">
          Step {step} of {steps.length}
        </p>
      </section>

      <main className="signin-form">
        <Stack gap="md">
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={18} />} role="alert">
              {error}
            </Alert>
          )}

          {step === 1 && (
            <>
              <div>
                <Title order={1} className="signin-title">
                  Create your account
                </Title>
                <Text c="dimmed">
                  You’ll be the owner, with full access. You can add more admins later.
                </Text>
              </div>
              <TextInput
                label="Full name"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.currentTarget.value);
                }}
                error={fields.fullName}
                required
              />
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  label="Mobile number"
                  inputMode="tel"
                  className="grow"
                  value={mobile}
                  onChange={(e) => {
                    setMobile(e.currentTarget.value);
                    setToken(null);
                    setChallengeId(null);
                  }}
                  error={fields.mobile}
                  disabled={token !== null}
                  required
                />
                {!token && (
                  <Button variant="default" onClick={sendCode} loading={busy && !challengeId}>
                    {challengeId ? 'Send again' : 'Send code'}
                  </Button>
                )}
              </Group>
              {challengeId && !token && (
                <Group align="flex-end">
                  <div>
                    <Text component="label" htmlFor="reg-otp" size="sm" fw={600}>
                      6-digit code
                    </Text>
                    <PinInput
                      id="reg-otp"
                      length={OTP_LENGTH}
                      type="number"
                      oneTimeCode
                      value={code}
                      onChange={setCode}
                      aria-label="6-digit code"
                      mt={6}
                      error={Boolean(fields.code)}
                    />
                  </div>
                  <Button onClick={verify} disabled={code.length !== OTP_LENGTH} loading={busy}>
                    Verify
                  </Button>
                </Group>
              )}
              {token && (
                <Text c="green" size="sm">
                  Mobile number verified.
                </Text>
              )}
              <TextInput
                label="Email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.currentTarget.value);
                }}
                error={fields.email}
              />
              <PasswordInput
                label="Password"
                autoComplete="new-password"
                description="At least 8 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.currentTarget.value);
                }}
                error={fields.password}
                required
              />
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <Title order={1} className="signin-title">
                  What are you setting up?
                </Title>
                <Text c="dimmed">
                  You can grow from one school to a group later without starting over.
                </Text>
              </div>
              <div className="choice" role="radiogroup" aria-label="What are you setting up">
                <UnstyledButton
                  role="radio"
                  aria-checked={!isHO}
                  onClick={() => {
                    setSetupType('single_school');
                  }}
                >
                  <IconSchool size={22} aria-hidden="true" />
                  <b>A single school</b>
                  <span>One school, run by you</span>
                </UnstyledButton>
                <UnstyledButton
                  role="radio"
                  aria-checked={isHO}
                  onClick={() => {
                    setSetupType('head_office');
                  }}
                >
                  <IconBuilding size={22} aria-hidden="true" />
                  <b>A head office</b>
                  <span>A group that runs several schools</span>
                </UnstyledButton>
              </div>
              {isHO && (
                <div>
                  <Text size="sm" fw={600} mb={6}>
                    Your schools are
                  </Text>
                  <SegmentedControl
                    value={schoolModel}
                    onChange={(v) => {
                      setSchoolModel(v);
                    }}
                    data={[
                      { value: 'coco', label: 'COCO only' },
                      { value: 'franchise', label: 'Franchise only' },
                      { value: 'both', label: 'Both' },
                    ]}
                  />
                  <Text size="sm" c="dimmed" mt="xs">
                    COCO schools are company-owned and run. Franchise schools are run by their
                    owners.
                  </Text>
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <Title order={1} className="signin-title">
                  {isHO ? 'Your organisation' : 'Your school'}
                </Title>
                <Text c="dimmed">This is used across the app. You can change it any time.</Text>
              </div>
              <TextInput
                label={isHO ? 'Organisation name' : 'School name'}
                placeholder={isHO ? 'Kidzonia Pre-schools' : 'Kidzonia Jubilee Hills'}
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.currentTarget.value);
                }}
                error={fields['organisation.name']}
                required
              />
              <div className="two">
                <TextInput
                  label="City"
                  value={city}
                  onChange={(e) => {
                    setCity(e.currentTarget.value);
                  }}
                  error={fields['organisation.city']}
                  required
                />
                <TextInput
                  label="State"
                  value={stateName}
                  onChange={(e) => {
                    setStateName(e.currentTarget.value);
                  }}
                />
              </div>
              <div>
                <Text size="sm" fw={600} mb={6} id="reg-days">
                  Working days
                </Text>
                <Chip.Group multiple value={days} onChange={setDays}>
                  <Group gap="xs" role="group" aria-labelledby="reg-days">
                    {DAYS.map((d, i) => (
                      <Chip key={d} value={String(i)}>
                        {d}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
                {fields['organisation.workingDays'] && (
                  <Text c="red" size="sm">
                    {fields['organisation.workingDays']}
                  </Text>
                )}
              </div>
              <div className="two">
                <TextInput
                  type="time"
                  label="School opens"
                  value={opensAt}
                  onChange={(e) => {
                    setOpensAt(e.currentTarget.value);
                  }}
                />
                <TextInput
                  type="time"
                  label="School closes"
                  value={closesAt}
                  onChange={(e) => {
                    setClosesAt(e.currentTarget.value);
                  }}
                  error={fields['organisation.closesAt']}
                />
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div>
                <Title order={1} className="signin-title">
                  Add your schools
                </Title>
                <Text c="dimmed">Add them now or skip and do it later from Settings.</Text>
              </div>
              {schools.map((s, i) => (
                <div key={i} className="school-card">
                  <Group align="flex-end" wrap="wrap" gap="xs">
                    <TextInput
                      label="School name"
                      value={s.name}
                      onChange={(e) => {
                        setSchool(i, { name: e.currentTarget.value });
                      }}
                      className="grow"
                      error={fields[`schools.${i}.name`]}
                    />
                    <TextInput
                      label="City"
                      value={s.city}
                      placeholder={city}
                      onChange={(e) => {
                        setSchool(i, { city: e.currentTarget.value });
                      }}
                    />
                    <SegmentedControl
                      value={s.type}
                      onChange={(v) => {
                        setSchool(i, { type: v });
                      }}
                      data={[
                        { value: 'coco', label: 'COCO' },
                        { value: 'franchise', label: 'Franchise' },
                      ]}
                      aria-label={`School ${i + 1} type`}
                    />
                    <ActionIcon
                      variant="subtle"
                      size="lg"
                      aria-label="Remove school"
                      onClick={() => {
                        setSchools(
                          schools.length > 1 ? schools.filter((_, j) => j !== i) : [blankSchool()],
                        );
                      }}
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  </Group>
                  {s.type === 'franchise' && (
                    <div className="two" style={{ marginTop: 8 }}>
                      <TextInput
                        label="Owner’s name (optional)"
                        value={s.ownerName}
                        onChange={(e) => {
                          setSchool(i, { ownerName: e.currentTarget.value });
                        }}
                      />
                      <TextInput
                        label="Owner’s mobile"
                        inputMode="tel"
                        value={s.ownerMobile}
                        onChange={(e) => {
                          setSchool(i, { ownerMobile: e.currentTarget.value });
                        }}
                        error={fields[`schools.${i}.owner.mobile`]}
                      />
                    </div>
                  )}
                </div>
              ))}
              <Group>
                <Button
                  variant="default"
                  leftSection={<IconPlus size={16} />}
                  onClick={() => {
                    setSchools([...schools, blankSchool()]);
                  }}
                >
                  Add another school
                </Button>
              </Group>
            </>
          )}

          <Group mt="md">
            {step > 1 && (
              <Button
                variant="default"
                onClick={() => {
                  setStep(step - 1);
                }}
              >
                Back
              </Button>
            )}
            <span className="grow" />
            {step === 4 && (
              <Button
                variant="subtle"
                onClick={() => {
                  next(true);
                }}
              >
                Skip for now
              </Button>
            )}
            <Button
              onClick={() => {
                next();
              }}
              loading={busy && last}
            >
              {last ? 'Create organisation' : 'Continue'}
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Already using Kidzonia 360?{' '}
            <Anchor component={Link} to="/login" underline="always">
              Sign in
            </Anchor>
          </Text>
        </Stack>
      </main>
    </div>
  );
}
