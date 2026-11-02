import Image from 'next/image';

interface CollectionHeroProps {
  imageSrc: string;
  imageAlt: string;
  title: string;
  description: string;
}

export function CollectionHero({
  imageSrc,
  imageAlt,
  title,
  description,
}: CollectionHeroProps) {
  return (
    <section className="collection-hero" aria-label={title}>
      <div className="collection-hero__image">
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          className="collection-hero__photo"
          sizes="(max-width: 767px) calc(100vw - 4rem), (max-width: 1199px) 42vw, 460px"
          priority
        />
      </div>
      <div className="collection-hero__content">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}
