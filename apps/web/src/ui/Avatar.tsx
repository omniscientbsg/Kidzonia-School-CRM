import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchImage } from '../api/client';

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';

/**
 * A person's photo, or their initials when there is none (brief audit D2).
 * Photos need the access token, so they're fetched and shown as object URLs;
 * the URL carries a version, so one fetch per photo is cached for the session.
 * Decorative by default: the person's name is always shown or announced next to it.
 */
export function Avatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string;
  photoUrl?: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
}) {
  const photo = useQuery({
    queryKey: ['photo', photoUrl],
    queryFn: () => (photoUrl ? fetchImage(photoUrl) : Promise.resolve(null)),
    enabled: Boolean(photoUrl),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
  // A photo that fails to decode falls back to initials instead of a broken image.
  const [broken, setBroken] = useState<string | null>(null);
  const src = photoUrl && photo.data && photo.data !== broken ? photo.data : null;
  const cls = size === 'md' ? 'av' : `av ${size}`;
  return (
    <span className={cls} aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          onError={() => {
            setBroken(src);
          }}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
