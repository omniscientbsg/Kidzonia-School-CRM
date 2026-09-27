import { Switch } from '@mantine/core';
import type { preferencesSchema } from '@kidzonia/shared';
import type { Channel } from '@kidzonia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';
import { homeKeys, useNotificationSettings } from '../home/api';
import { ErrorAlert } from '../ui/errors';

type Prefs = z.infer<typeof preferencesSchema>;

/**
 * Your notifications (brief 10.1): each kind in the app and, for the few that
 * can, by SMS/WhatsApp. SMS/WhatsApp never arrive between 9 pm and 7 am.
 */
export function NotificationSettingsPage() {
  const settings = useNotificationSettings();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: { event: string; channel: Channel; on: boolean }) =>
      api('/me/notification-settings', z.undefined(), { method: 'PUT', body, noPreview: true }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: homeKeys.settings });
      const before = qc.getQueryData<Prefs>(homeKeys.settings);
      qc.setQueryData<Prefs>(homeKeys.settings, (p) =>
        p
          ? {
              events: p.events.map((e) =>
                e.event === body.event
                  ? { ...e, ...(body.channel === 'in_app' ? { inApp: body.on } : { sms: body.on }) }
                  : e,
              ),
            }
          : p,
      );
      return { before };
    },
    onError: (_e, _b, ctx) => {
      qc.setQueryData(homeKeys.settings, ctx?.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: homeKeys.settings }),
  });

  return (
    <>
      <div className="pagehead">
        <h1>Notification settings</h1>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Choose what reaches you. SMS and WhatsApp messages are never sent between 9 pm and 7 am;
        they wait until the morning.
      </p>
      <ErrorAlert error={settings.error ?? save.error} />
      <section className="panel">
        <div className="tbl-wrap">
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">Notification</th>
                <th scope="col">In the app</th>
                <th scope="col">SMS / WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {settings.data?.events.map((e) => (
                <tr key={e.event}>
                  <td>{e.label}</td>
                  <td>
                    <Switch
                      aria-label={`${e.label}: in the app`}
                      checked={e.inApp}
                      onChange={(ev) => {
                        save.mutate({
                          event: e.event,
                          channel: 'in_app',
                          on: ev.currentTarget.checked,
                        });
                      }}
                    />
                  </td>
                  <td>
                    {e.sms === null ? (
                      <span className="muted small">Not available</span>
                    ) : (
                      <Switch
                        aria-label={`${e.label}: SMS or WhatsApp`}
                        checked={e.sms}
                        onChange={(ev) => {
                          save.mutate({
                            event: e.event,
                            channel: 'sms',
                            on: ev.currentTarget.checked,
                          });
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
