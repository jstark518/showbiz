import type {
  AnySlide,
  MediaAsset,
  SignTheme,
  MediaSource,
  Playlist,
  Sign,
  SlideType,
} from '../../shared/types';
import { signPath } from './signs';
import { normalizeSlideConfig } from './slides/config';

export interface PlaylistRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  slide_count?: number;
}

export interface SlideRow {
  id: string;
  playlist_id: string;
  type: SlideType;
  title: string;
  position: number;
  duration_seconds: number;
  enabled: boolean;
  theme: SignTheme;
  starts_at: Date | null;
  ends_at: Date | null;
  config: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface MediaRow {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  kind: 'image' | 'video';
  size_bytes: number;
  created_at: Date;
  source: MediaSource | null;
}

export interface SignRow {
  id: string;
  name: string;
  token: string;
  playlist_id: string | null;
  last_seen_at: Date | null;
  last_seen_ip: string | null;
  created_at: Date;
  updated_at: Date;
  /** Joined in by the list query only. */
  playlist_name?: string | null;
}

export function toPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.slide_count !== undefined ? { slideCount: Number(row.slide_count) } : {}),
  };
}

export function toSlide(row: SlideRow): AnySlide {
  return {
    id: row.id,
    playlistId: row.playlist_id,
    type: row.type,
    title: row.title,
    position: row.position,
    durationSeconds: row.duration_seconds,
    enabled: row.enabled,
    // A row written before the column existed reads as null from postgres.js.
    theme: row.theme ?? 'dark',
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
    config: normalizeSlideConfig(row.type, row.config),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  } as AnySlide;
}

export function toMediaAsset(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    url: `/media/${row.filename}`,
    originalName: row.original_name,
    mimeType: row.mime_type,
    kind: row.kind,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
    source: row.source ?? null,
  };
}

export function toSign(row: SignRow, connected: boolean): Sign {
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    playlistId: row.playlist_id,
    playlistName: row.playlist_name ?? null,
    path: signPath(row.token),
    connected,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    lastSeenIp: row.last_seen_ip,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
