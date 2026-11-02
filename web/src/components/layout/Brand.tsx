'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';

export function Brand({ footer = false }: { footer?: boolean }) {
  const [imageAvailable, setImageAvailable] = useState(true);
  return (
    <Link
      className={clsx('brand', footer && 'footer-wordmark')}
      href="/"
      aria-label="Dainty Bloom home"
    >
      {imageAvailable ? (
        <Image
          src="/images/dainty-bloom-logo.png"
          width={36}
          height={36}
          alt=""
          onError={() => setImageAvailable(false)}
          priority={!footer}
        />
      ) : null}
      <span>Dainty Bloom</span>
    </Link>
  );
}
