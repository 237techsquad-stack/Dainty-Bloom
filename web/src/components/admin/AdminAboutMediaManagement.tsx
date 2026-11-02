'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';

import { usePermissions } from '@/components/providers/AuthProvider';
import { PageHeader } from '@/components/admin';
import { Button, ErrorState } from '@/components/ui';
import { ApiError, api } from '@/lib/api/client';
import type { AdminAboutMedia } from '@/lib/api/types';

const ACCEPTED_MEDIA_TYPES =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'The request could not be completed.';
}

function displayTitle(media: AdminAboutMedia) {
  return (
    media.title?.trim() ||
    (media.type === 'image' ? 'Untitled image' : 'Untitled video')
  );
}

export function AdminAboutMediaManagement() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const previewUrlRef = useRef<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [altText, setAltText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({
    title: '',
    description: '',
    altText: '',
  });

  const mediaQuery = useQuery({
    queryKey: ['admin-about-media'],
    queryFn: api.adminAboutMedia,
    enabled: can('media:manage'),
    retry: false,
  });
  const media = mediaQuery.data ?? [];

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-about-media'] });

  const upload = useMutation({
    mutationFn: () => {
      if (!selectedFile) throw new Error('Choose an image or video to upload.');
      setUploadProgress(0);
      return api.uploadAdminAboutMedia(
        {
          file: selectedFile,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(altText.trim() ? { altText: altText.trim() } : {}),
        },
        setUploadProgress,
      );
    },
    onSuccess: async () => {
      setError('');
      setNotice('Media uploaded as a draft.');
      setSelectedFile(null);
      clearPreview();
      setTitle('');
      setDescription('');
      setAltText('');
      setUploadProgress(null);
      await refreshList();
    },
    onError: (reason) => {
      setNotice('');
      setError(errorMessage(reason));
      setUploadProgress(null);
    },
  });

  const update = useMutation({
    mutationFn: (input: {
      id: string;
      title?: string;
      description?: string;
      altText?: string;
      isPublished?: boolean;
    }) => {
      const { id, ...body } = input;
      return api.updateAdminAboutMedia(id, body);
    },
    onSuccess: async (_result, variables) => {
      setError('');
      setNotice(
        variables.isPublished === undefined
          ? 'Media details saved.'
          : variables.isPublished
            ? 'Media published.'
            : 'Media unpublished.',
      );
      setEditingId(null);
      await refreshList();
    },
    onError: (reason) => {
      setNotice('');
      setError(errorMessage(reason));
    },
  });

  const reorder = useMutation({
    mutationFn: (mediaIds: string[]) => api.reorderAdminAboutMedia(mediaIds),
    onSuccess: async () => {
      setError('');
      setNotice('Display order saved.');
      await refreshList();
    },
    onError: (reason) => {
      setNotice('');
      setError(errorMessage(reason));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAdminAboutMedia(id),
    onSuccess: async () => {
      setError('');
      setNotice('Media deleted.');
      await refreshList();
    },
    onError: async (reason) => {
      setNotice('');
      if (
        reason instanceof ApiError &&
        reason.code === 'ABOUT_MEDIA_DELETE_FAILED'
      ) {
        await refreshList();
        setError(
          'The media record was removed, but Cloudinary cleanup failed. The item has been refreshed out of this list; contact an administrator to review storage cleanup.',
        );
        return;
      }
      setError(errorMessage(reason));
      await refreshList();
    },
  });

  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    clearPreview();
    if (file) {
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }
    setSelectedFile(file);
    setError('');
    setNotice('');
    if (file?.type.startsWith('video/')) setAltText('');
  }

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl('');
  }

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    upload.mutate();
  }

  function startEditing(item: AdminAboutMedia) {
    setEditingId(item.id);
    setEditValues({
      title: item.title ?? '',
      description: item.description ?? '',
      altText: item.altText ?? '',
    });
    setError('');
    setNotice('');
  }

  function saveEdit(event: FormEvent<HTMLFormElement>, item: AdminAboutMedia) {
    event.preventDefault();
    update.mutate({
      id: item.id,
      title: editValues.title,
      description: editValues.description,
      altText: editValues.altText,
    });
  }

  function changeOrder(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= media.length) return;
    const mediaIds = media.map((item) => item.id);
    [mediaIds[index], mediaIds[destination]] = [
      mediaIds[destination],
      mediaIds[index],
    ];
    setError('');
    setNotice('');
    reorder.mutate(mediaIds);
  }

  function confirmDelete(item: AdminAboutMedia) {
    if (
      window.confirm(
        `Delete "${displayTitle(item)}"? This removes it from the gallery and attempts to delete its Cloudinary file.`,
      )
    ) {
      setError('');
      setNotice('');
      remove.mutate(item.id);
    }
  }

  if (!can('media:manage')) {
    return (
      <>
        <PageHeader title="About media" />
        <section className="admin-panel" role="alert">
          You do not have permission to manage About page media.
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="About media"
        description="Upload and arrange the photos and videos shown in the About page collection."
        actions={
          <Button
            variant="secondary"
            onClick={() => void mediaQuery.refetch()}
            aria-label="Refresh About media"
          >
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <p className="about-media-privacy-note">
        Publishing controls visibility in the site API. Cloudinary direct-link
        access may remain available for unpublished items.
      </p>

      {error ? (
        <p className="admin-operation-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="admin-operation-success" role="status">
          {notice}
        </p>
      ) : null}

      <section
        className="admin-panel about-media-upload"
        aria-labelledby="about-media-upload-title"
      >
        <div className="admin-panel-heading">
          <div>
            <h2 id="about-media-upload-title">Upload media</h2>
            <p>Images and videos are saved as unpublished drafts.</p>
          </div>
        </div>
        <form className="about-media-upload-form" onSubmit={submitUpload}>
          <label className="about-media-file-field">
            <span>Image or video file</span>
            <input
              type="file"
              accept={ACCEPTED_MEDIA_TYPES}
              onChange={chooseFile}
              required
              aria-describedby="about-media-file-help"
            />
            <small id="about-media-file-help">
              JPEG, PNG, WebP, GIF, MP4, WebM, or MOV. Server upload limit
              applies.
            </small>
          </label>
          {selectedFile ? (
            <div className="about-media-upload-preview">
              {previewUrl && selectedFile.type.startsWith('video/') ? (
                <video src={previewUrl} controls preload="metadata">
                  Your browser does not support video preview.
                </video>
              ) : previewUrl ? (
                <Image
                  src={previewUrl}
                  alt={`Preview of ${selectedFile.name}`}
                  width={640}
                  height={400}
                  unoptimized
                />
              ) : null}
            </div>
          ) : null}
          <div className="about-media-upload-fields">
            <label>
              Title (optional)
              <input
                className="input"
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </label>
            <label>
              Description (optional)
              <textarea
                className="textarea"
                maxLength={1000}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </label>
            {selectedFile?.type.startsWith('image/') ? (
              <label>
                Image alt text (optional)
                <input
                  className="input"
                  maxLength={300}
                  value={altText}
                  onChange={(event) => setAltText(event.currentTarget.value)}
                />
              </label>
            ) : null}
          </div>
          {upload.isPending ? (
            <div className="about-media-progress" role="status">
              <span>Uploading… {uploadProgress ?? 0}%</span>
              <progress max={100} value={uploadProgress ?? 0} />
            </div>
          ) : null}
          <Button type="submit" disabled={!selectedFile || upload.isPending}>
            {upload.isPending ? (
              <LoaderCircle size={16} aria-hidden="true" />
            ) : (
              <Upload size={16} aria-hidden="true" />
            )}
            {upload.isPending ? 'Uploading' : 'Upload draft'}
          </Button>
        </form>
      </section>

      <section
        className="admin-panel about-media-list"
        aria-labelledby="about-media-list-title"
      >
        <div className="admin-panel-heading">
          <div>
            <h2 id="about-media-list-title">Gallery media</h2>
            <p>
              {media.length} {media.length === 1 ? 'item' : 'items'}
            </p>
          </div>
        </div>
        {mediaQuery.isError ? (
          <div className="admin-about-media-error">
            <ErrorState title="About media could not be loaded">
              {errorMessage(mediaQuery.error)}
            </ErrorState>
            <Button
              variant="secondary"
              onClick={() => void mediaQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : mediaQuery.isPending ? (
          <p role="status">Loading About media…</p>
        ) : media.length === 0 ? (
          <p className="about-media-empty" role="status">
            No media yet. Upload an image or video to start the collection.
          </p>
        ) : (
          <div className="about-media-grid">
            {media.map((item, index) => (
              <article className="about-media-card" key={item.id}>
                <div className="about-media-card-preview">
                  {item.type === 'video' ? (
                    <video
                      src={item.url}
                      poster={item.thumbnailUrl}
                      controls
                      preload="metadata"
                      aria-label={`Preview: ${displayTitle(item)}`}
                    >
                      Your browser does not support video playback.
                    </video>
                  ) : (
                    <Image
                      src={item.url}
                      alt={item.altText || item.title || 'About page image'}
                      width={640}
                      height={400}
                      unoptimized
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="about-media-card-content">
                  <div className="about-media-card-heading">
                    <div>
                      <h3>{displayTitle(item)}</h3>
                      <p>
                        {item.type === 'image' ? (
                          <ImagePlus size={14} aria-hidden="true" />
                        ) : (
                          <Video size={14} aria-hidden="true" />
                        )}
                        {item.type} · Order {index + 1}
                      </p>
                    </div>
                    <span
                      className={`about-media-status${item.isPublished ? ' is-published' : ''}`}
                    >
                      {item.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  {item.description ? <p>{item.description}</p> : null}
                  {editingId === item.id ? (
                    <form
                      className="about-media-edit-form"
                      onSubmit={(event) => saveEdit(event, item)}
                    >
                      <label>
                        Title
                        <input
                          className="input"
                          maxLength={160}
                          value={editValues.title}
                          onChange={(event) =>
                            setEditValues((current) => ({
                              ...current,
                              title: event.currentTarget.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Description
                        <textarea
                          className="textarea"
                          maxLength={1000}
                          rows={3}
                          value={editValues.description}
                          onChange={(event) =>
                            setEditValues((current) => ({
                              ...current,
                              description: event.currentTarget.value,
                            }))
                          }
                        />
                      </label>
                      {item.type === 'image' ? (
                        <label>
                          Image alt text
                          <input
                            className="input"
                            maxLength={300}
                            value={editValues.altText}
                            onChange={(event) =>
                              setEditValues((current) => ({
                                ...current,
                                altText: event.currentTarget.value,
                              }))
                            }
                          />
                        </label>
                      ) : null}
                      <div className="about-media-actions">
                        <Button type="submit" loading={update.isPending}>
                          <Save size={15} aria-hidden="true" />
                          Save details
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="about-media-actions">
                      <Button
                        variant="secondary"
                        onClick={() => startEditing(item)}
                      >
                        Edit details
                      </Button>
                      <Button
                        variant={item.isPublished ? 'secondary' : 'primary'}
                        loading={
                          update.isPending && update.variables?.id === item.id
                        }
                        onClick={() =>
                          update.mutate({
                            id: item.id,
                            isPublished: !item.isPublished,
                          })
                        }
                      >
                        {item.isPublished ? 'Unpublish' : 'Publish'}
                      </Button>
                    </div>
                  )}
                  <div className="about-media-card-footer">
                    <div
                      className="about-media-order-controls"
                      aria-label="Change display order"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${displayTitle(item)} up`}
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => changeOrder(index, -1)}
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${displayTitle(item)} down`}
                        disabled={
                          index === media.length - 1 || reorder.isPending
                        }
                        onClick={() => changeOrder(index, 1)}
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                      </Button>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={remove.isPending && remove.variables === item.id}
                      onClick={() => confirmDelete(item)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
