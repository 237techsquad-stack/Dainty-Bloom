import Image from 'next/image';

import type { PublicAboutMedia } from '@/lib/api/types';
import type { PublicResult } from '@/lib/api/server';

export async function AboutMediaGallery({
  resultPromise,
}: {
  resultPromise: Promise<PublicResult<PublicAboutMedia[]>>;
}) {
  const result = await resultPromise;
  if (result.unavailable || !result.data) {
    return (
      <p className="about-data-note" role="status">
        The photo and video collection is temporarily unavailable.
      </p>
    );
  }
  if (!result.data.length) return null;

  return (
    <section className="about-media" aria-labelledby="about-media-title">
      <header className="about-section-heading">
        <span className="eyebrow">Inside Dainty Bloom</span>
        <h2 id="about-media-title">Making, creating, and personalising</h2>
        <p>
          A look at the creative work and finished pieces behind the
          collections.
        </p>
      </header>
      <ul className="about-media__grid">
        {result.data.map((item) => (
          <li className="about-media__item" key={item.id}>
            <figure>
              <div className="about-media__visual">
                {item.type === 'image' ? (
                  <Image
                    src={item.url}
                    alt={
                      item.altText?.trim() ||
                      item.title?.trim() ||
                      'A Dainty Bloom creative project'
                    }
                    fill
                    sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw"
                    style={{ objectFit: 'contain' }}
                  />
                ) : (
                  <video
                    controls
                    preload="metadata"
                    poster={item.thumbnailUrl}
                    aria-label={
                      item.title?.trim()
                        ? `Video: ${item.title.trim()}`
                        : 'Dainty Bloom studio video'
                    }
                  >
                    <source src={item.url} />
                    Your browser does not support video playback.
                  </video>
                )}
              </div>
              {item.title || item.description ? (
                <figcaption className="about-media__caption">
                  {item.title ? <h3>{item.title}</h3> : null}
                  {item.description ? <p>{item.description}</p> : null}
                </figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
